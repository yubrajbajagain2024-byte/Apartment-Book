-- =============================================================================
-- CampConnect - migration 25: the semester rollover takes the day it runs for
--  * course_groups_rollover(p_today, p_term): the daily job still calls it bare
--    (today, every term); a manual or test run can name the day and one term, so
--    the week-before notice and the end-of-semester deletion can be exercised
--    without waiting for December, and only on the term asked for.
--  * the class triggers join in the BEFORE trigger and leave in an AFTER trigger:
--    changing a class's section used to delete the old chat while the row was
--    still being updated (its set-null cascade then hit the row mid-update), and
--    the BEFORE trigger used to put the old chat id back whenever the class itself
--    had not changed, which undid the foreign key's set-null when a chat was
--    deleted and left dangling ids. A null now stays null; a forged id is still
--    overwritten.
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Join before, leave after
-- -----------------------------------------------------------------------------
-- BEFORE insert or update: the row gets the chat for its (new) class. The chat's id is the trigger's to set: a forged
-- one is overwritten, a null one (the foreign key clearing it when its chat was deleted) is left alone.
create or replace function public.profile_classes_course_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.course_group_id := public.course_group_join(new.user_id, new.term, new.code, new.section);
    return new;
  end if;
  if new.term is distinct from old.term or new.code is distinct from old.code or new.section is distinct from old.section then
    new.course_group_id := public.course_group_join(new.user_id, new.term, new.code, new.section);
  elsif new.course_group_id is not null then
    new.course_group_id := old.course_group_id;
  end if;
  return new;
end;
$$;

-- AFTER update or delete: the student leaves the chat the row no longer points at (the old chat may be deleted when it
-- empties; by now the row itself is updated or gone, so the set-null that follows touches nothing mid-flight).
create or replace function public.profile_classes_course_group_after()
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
  if old.course_group_id is not null and old.course_group_id is distinct from new.course_group_id then
    perform public.course_group_leave(old.course_group_id, old.user_id);
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
  after update or delete on public.profile_classes
  for each row execute function public.profile_classes_course_group_after();

-- -----------------------------------------------------------------------------
-- 2. The rollover, for a given day and (optionally) one term
-- -----------------------------------------------------------------------------
drop function if exists public.course_groups_rollover();

-- Run once a day. A week before a semester ends, every member of each of its course chats is told once; the day
-- after it has ended, each member is told the chats are gone and the chats are deleted (members and messages with
-- them; the class rows keep their place on the profiles as the semester's history, with no chat attached, and the new
-- semester's list starts empty). `p_today` is the day the run is for and `p_term` narrows it to one semester.
create or replace function public.course_groups_rollover(p_today date default current_date, p_term text default null)
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
    where reminded_at is null
      and (p_term is null or term = p_term)
      and public.term_end(term) - p_today between 0 and 7
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
    select * from public.course_groups
    where (p_term is null or term = p_term)
      and public.term_end(term) < p_today
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

revoke all on function public.course_groups_rollover(date, text) from public, anon, authenticated;
