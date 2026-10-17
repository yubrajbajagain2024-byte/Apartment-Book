-- =============================================================================
-- CampConnect - migration: semester course group chats
--  * profile_classes: a section, the meeting days and times, and the room on each class
--  * course_groups: one group chat per university + semester + course + section. The
--    first student to list the section creates it, the next ones join it, a student
--    who removes the class leaves it, and a chat nobody is left in is deleted.
--  * a course chat is named after its class and fills itself from the class list:
--    no renaming, no hand-picked members (leaving is still allowed)
--  * course_groups_rollover(): a week before a semester ends every member is told;
--    once it has ended the chats are deleted, members and messages with them, and
--    the ended semester's classes stay on the profiles as history while the new
--    semester's list starts empty. Scheduled daily with pg_cron where available.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Section, meeting times and room on a class
-- -----------------------------------------------------------------------------
-- meetings: up to 8 of {"days": ["mon", "wed", "fri"], "start": "10:00", "end": "10:50"} (24-hour times, start before
-- end), the way packages/shared/src/profile.ts (ClassMeeting, meetingsProblem) checks them before sending.
create or replace function public.class_meetings_ok(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  m jsonb;
  d jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then
    return false;
  end if;
  for m in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(m) <> 'object' or jsonb_typeof(m -> 'days') <> 'array' then
      return false;
    end if;
    if jsonb_array_length(m -> 'days') not between 1 and 7 then
      return false;
    end if;
    if (m ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (m ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
    if (m ->> 'start') >= (m ->> 'end') then
      return false;
    end if;
    for d in select * from jsonb_array_elements(m -> 'days') loop
      if jsonb_typeof(d) <> 'string' or (d #>> '{}') not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table public.profile_classes add column if not exists section text;
alter table public.profile_classes add column if not exists meetings jsonb not null default '[]'::jsonb;
alter table public.profile_classes add column if not exists location text;
alter table public.profile_classes add column if not exists course_group_id uuid;
alter table public.profile_classes drop constraint if exists profile_classes_section_check;
alter table public.profile_classes add constraint profile_classes_section_check
  check (section is null or (char_length(section) between 1 and 10 and section ~ '^[A-Z0-9][A-Z0-9.-]*$'));
alter table public.profile_classes drop constraint if exists profile_classes_meetings_check;
alter table public.profile_classes add constraint profile_classes_meetings_check
  check (public.class_meetings_ok(meetings));
alter table public.profile_classes drop constraint if exists profile_classes_location_check;
alter table public.profile_classes add constraint profile_classes_location_check
  check (location is null or char_length(location) <= 80);

-- "cs3358 " becomes "CS 3358", " 001" becomes "001"; a blank title or room is none; a dozen classes per semester at most.
create or replace function public.profile_classes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(regexp_replace(btrim(new.code), '\s+', ' ', 'g'));
  new.code := regexp_replace(new.code, '^([A-Z&]+)([0-9])', '\1 \2');
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  new.section := nullif(upper(btrim(coalesce(new.section, ''))), '');
  new.location := nullif(regexp_replace(btrim(coalesce(new.location, '')), '\s+', ' ', 'g'), '');
  new.meetings := coalesce(new.meetings, '[]'::jsonb);
  if tg_op = 'INSERT' then
    new.created_at := now();
    if (select count(*) from public.profile_classes c where c.user_id = new.user_id and c.term = new.term) >= 12 then
      raise exception 'You can list up to 12 classes per semester.';
    end if;
    if exists (select 1 from public.profile_classes c where c.user_id = new.user_id and c.term = new.term and c.code = new.code) then
      raise exception '% is already on your % classes.', new.code, new.term using errcode = '23505';
    end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Semesters, as packages/shared/src/profile.ts counts them: January to May is
--    Spring, June and July Summer, August to December Fall.
-- -----------------------------------------------------------------------------
create or replace function public.term_end(p_term text)
returns date
language sql
immutable
as $$
  select case split_part(p_term, ' ', 1)
    when 'Spring' then make_date(split_part(p_term, ' ', 2)::int, 5, 31)
    when 'Summer' then make_date(split_part(p_term, ' ', 2)::int, 7, 31)
    else make_date(split_part(p_term, ' ', 2)::int, 12, 31)
  end;
$$;

create or replace function public.next_term(p_term text)
returns text
language sql
immutable
as $$
  select case split_part(p_term, ' ', 1)
    when 'Spring' then 'Summer ' || split_part(p_term, ' ', 2)
    when 'Summer' then 'Fall ' || split_part(p_term, ' ', 2)
    else 'Spring ' || (split_part(p_term, ' ', 2)::int + 1)
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Course groups: the chat of one section of one course, one semester, one campus
-- -----------------------------------------------------------------------------
create table if not exists public.course_groups (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null,
  term text not null,
  code text not null,
  section text not null,
  conversation_id uuid not null,
  /** When the members were told the semester is ending. */
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint course_groups_university_id_fkey foreign key (university_id) references public.universities (id) on delete cascade,
  constraint course_groups_conversation_id_fkey foreign key (conversation_id) references public.conversations (id) on delete cascade,
  constraint course_groups_term_check check (term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'),
  constraint course_groups_unique unique (university_id, term, code, section),
  constraint course_groups_conversation_unique unique (conversation_id)
);
create index if not exists course_groups_term_idx on public.course_groups (term);

alter table public.profile_classes drop constraint if exists profile_classes_course_group_id_fkey;
alter table public.profile_classes add constraint profile_classes_course_group_id_fkey
  foreign key (course_group_id) references public.course_groups (id) on delete set null;

alter table public.course_groups enable row level security;
drop policy if exists "course_groups_select_member" on public.course_groups;
create policy "course_groups_select_member" on public.course_groups
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
-- No insert, update or delete policies: only the functions below (security definer) manage the rows.

-- Is this conversation a course chat? (security definer, so policies and triggers can ask without recursing)
create or replace function public.is_course_chat(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.course_groups g where g.conversation_id = p_conversation_id);
$$;
grant execute on function public.is_course_chat(uuid) to authenticated;

-- The course chat for a student's class, found or created, with the student in it: its id, or null when there is
-- nothing to join (no section, no university on the profile, or a semester already over).
create or replace function public.course_group_join(p_user_id uuid, p_term text, p_code text, p_section text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_university uuid;
  v_group public.course_groups%rowtype;
  v_conversation uuid;
begin
  if p_user_id is null or p_term is null or p_code is null or p_section is null then
    return null;
  end if;
  if public.term_end(p_term) < current_date then
    return null;
  end if;
  select university_id into v_university from public.profiles where id = p_user_id;
  if v_university is null then
    return null;
  end if;
  select * into v_group from public.course_groups
  where university_id = v_university and term = p_term and code = p_code and section = p_section;
  if v_group.id is null then
    insert into public.conversations (type, name, created_by)
    values ('group', p_code || '-' || p_section || ' · ' || p_term, p_user_id)
    returning id into v_conversation;
    begin
      insert into public.course_groups (university_id, term, code, section, conversation_id)
      values (v_university, p_term, p_code, p_section, v_conversation)
      returning * into v_group;
    exception when unique_violation then
      -- Two classmates listed the section at the same moment: keep the first chat.
      delete from public.conversations where id = v_conversation;
      select * into v_group from public.course_groups
      where university_id = v_university and term = p_term and code = p_code and section = p_section;
    end;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  values (v_group.conversation_id, p_user_id)
  on conflict do nothing;
  perform public.notify(
    p_user_id, null, 'system',
    'You''re in the ' || p_code || '-' || p_section || ' chat',
    'Everyone taking ' || p_code || ' section ' || p_section || ' this ' || p_term || ' is in one group chat. Say hi.',
    '/messages/' || v_group.conversation_id,
    jsonb_build_object('course_group_id', v_group.id),
    'course_join:' || v_group.id
  );
  return v_group.id;
end;
$$;

-- A student leaves the chat of a class they no longer list; a chat nobody is left in goes too, its messages with it.
create or replace function public.course_group_leave(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
begin
  if p_group_id is null or p_user_id is null then
    return;
  end if;
  select conversation_id into v_conversation from public.course_groups where id = p_group_id;
  if v_conversation is null then
    return;
  end if;
  delete from public.conversation_members where conversation_id = v_conversation and user_id = p_user_id;
  if not exists (select 1 from public.conversation_members where conversation_id = v_conversation) then
    delete from public.conversations where id = v_conversation;
  end if;
end;
$$;

-- Adding a class joins (or creates) its chat; changing its semester, course or section moves the student over;
-- removing it leaves the chat. Runs after profile_classes_guard (trigger names fire in alphabetical order), so the
-- code and the section are already in their stored form. The chat's id is kept on the row, so a later change of
-- university still leaves the right chat.
create or replace function public.profile_classes_course_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.course_group_leave(old.course_group_id, old.user_id);
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.course_group_id := public.course_group_join(new.user_id, new.term, new.code, new.section);
    return new;
  end if;
  if new.term is distinct from old.term or new.code is distinct from old.code or new.section is distinct from old.section then
    perform public.course_group_leave(old.course_group_id, old.user_id);
    new.course_group_id := public.course_group_join(new.user_id, new.term, new.code, new.section);
  else
    new.course_group_id := old.course_group_id;
  end if;
  return new;
end;
$$;
drop trigger if exists profile_classes_join_course_group on public.profile_classes;
create trigger profile_classes_join_course_group
  before insert or update on public.profile_classes
  for each row execute function public.profile_classes_course_group();
drop trigger if exists profile_classes_leave_course_group on public.profile_classes;
create trigger profile_classes_leave_course_group
  after delete on public.profile_classes
  for each row execute function public.profile_classes_course_group();

-- Someone leaving a course chat by hand (its Leave group) leaves it empty: then it goes, like one left by removing
-- the class. Not during a cascade or from course_group_leave (they look after that themselves).
create or replace function public.course_chat_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if public.is_course_chat(old.conversation_id)
     and not exists (select 1 from public.conversation_members where conversation_id = old.conversation_id) then
    delete from public.conversations where id = old.conversation_id;
  end if;
  return old;
end;
$$;
drop trigger if exists conversation_members_course_chat_prune on public.conversation_members;
create trigger conversation_members_course_chat_prune
  after delete on public.conversation_members
  for each row execute function public.course_chat_prune();

-- A course chat is named after its class.
create or replace function public.course_chat_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name and public.is_course_chat(old.id) then
    raise exception 'Course chats are named after their class.';
  end if;
  return new;
end;
$$;
drop trigger if exists conversations_course_chat_guard on public.conversations;
create trigger conversations_course_chat_guard
  before update on public.conversations
  for each row execute function public.course_chat_guard();

-- Add members to a group you belong to; a course chat fills itself from the class list instead.
create or replace function public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_conversation_member(p_conversation_id, v_me) then
    raise exception 'Not a member of this conversation';
  end if;
  if (select type from public.conversations where id = p_conversation_id) <> 'group' then
    raise exception 'Can only add members to group conversations';
  end if;
  if public.is_course_chat(p_conversation_id) then
    raise exception 'Course chats fill themselves: classmates join by adding the class to their profile.';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation_id, p.id
  from public.profiles p
  where p.id = any (coalesce(p_member_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The end of a semester
-- -----------------------------------------------------------------------------
-- Run once a day. A week before a semester ends, every member of each of its course chats is told once; the day
-- after it has ended, each member is told the chats are gone and the chats are deleted (members and messages with
-- them; the class rows keep their place on the profiles as the semester's history, with no chat attached).
create or replace function public.course_groups_rollover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  m record;
  v_end date;
begin
  for g in
    select * from public.course_groups
    where reminded_at is null and public.term_end(term) - current_date between 0 and 7
  loop
    v_end := public.term_end(g.term);
    for m in select user_id from public.conversation_members where conversation_id = g.conversation_id loop
      perform public.notify(
        m.user_id, null, 'system',
        g.code || '-' || g.section || ' chat ends ' || to_char(v_end, 'FMMonth FMDD'),
        'The ' || g.term || ' semester is ending. This course chat and its messages will be deleted after '
          || to_char(v_end, 'FMMonth FMDD') || '. Save anything you want to keep.',
        '/messages/' || g.conversation_id,
        jsonb_build_object('course_group_id', g.id, 'ends', v_end),
        'course_end:' || g.id
      );
    end loop;
    update public.course_groups set reminded_at = now() where id = g.id;
  end loop;

  for g in
    select * from public.course_groups where public.term_end(term) < current_date
  loop
    for m in select user_id from public.conversation_members where conversation_id = g.conversation_id loop
      perform public.notify(
        m.user_id, null, 'system',
        g.term || ' course chats have ended',
        'Your ' || g.term || ' course chats were removed with the semester. Add your ' || public.next_term(g.term)
          || ' classes to your profile to join the new ones.',
        '/profile/' || m.user_id,
        jsonb_build_object('term', g.term),
        'course_term_over:' || g.term
      );
    end loop;
    delete from public.conversations where id = g.conversation_id;
  end loop;
end;
$$;

revoke all on function public.course_group_join(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.course_group_leave(uuid, uuid) from public, anon, authenticated;
revoke all on function public.course_groups_rollover() from public, anon, authenticated;

-- Daily at 09:15 UTC where pg_cron is installed (Supabase: Database → Extensions → pg_cron). Without it, run
-- `select public.course_groups_rollover()` once a day some other way.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available: schedule public.course_groups_rollover() daily another way (%).', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'course-groups-rollover';
    perform cron.schedule('course-groups-rollover', '15 9 * * *', 'select public.course_groups_rollover()');
  end if;
end $$;

-- Live badges and the chat list need to hear about course chats appearing and going.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'course_groups') then
    alter publication supabase_realtime add table public.course_groups;
  end if;
exception when others then
  raise notice 'course_groups not added to supabase_realtime (%).', sqlerrm;
end $$;
