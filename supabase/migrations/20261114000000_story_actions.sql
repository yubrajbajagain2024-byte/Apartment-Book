-- =============================================================================
-- UniBuzz - migration 62: what a viewer can do with a story
-- Follows 20261113000000_events.sql (migration 61) in file order, but needs nothing of it: it builds on migration 58's
-- stories and their audience rule (can_see_story_as), migration 9's blocks, migration 17's shared cards (the
-- messages_shared_post_check it widens), migration 30's message_preview() (snaps), migration 31's
-- message_reply_snapshot() and migration 41's Trust & Safety core (reports, ts_snapshot, ts_author_of,
-- ts_set_content_status), all on production. No pending migration (44, 46, 49 to 57, 61) defines anything this one
-- replaces, so it can go live on its own, ahead of them, as 58 to 60 did.
-- Rollback: supabase/rollbacks/20261114000000_story_actions.down.sql. Safe to run more than once.
--
-- Instagram's story viewer, with the database keeping each action to the story's audience:
--   * public.story_likes: a heart on someone else's story. Liked only on a story the person may see right now (the
--     stories table's own select policy decides, inside the insert policy); read by the person who liked it and by the
--     story's author (the list of views marks who liked it), nobody else. Goes with the story.
--   * public.story_mutes: "Mute <name>'s stories": the people whose stories someone has asked not to see in the tray.
--     A preference, not a block: the muted person is never told, and the rows are their owner's alone to read.
--   * Reports: 'story' joins the report types (the do-block pattern of migration 42, which keeps every type already
--     allowed). Trust & Safety reads a story as public content: its snapshot (the photo or the video, the audience),
--     its author, and removal (staff's Remove deletes the story, and migration 59 deletes its photo with it). It has no
--     hidden state, as other public content has none.
--   * Story cards in chats: a message may carry a story (shared_post with target_type 'story'), as a share ("Sent a
--     story") or as a reply to its author ("Replied to a story"). guard_message_story_card() refuses a story that is
--     gone, expired, or that the sender may not see; refuses a share into a chat with anyone who may not see it (the
--     rule campus posts follow, migration 45); sends a reply only into a chat with the author; and rewrites the card
--     from the story row itself (picture, author), so nobody can dress a card up as someone else's story.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Likes
-- -----------------------------------------------------------------------------
create table if not exists public.story_likes (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_likes_user_idx on public.story_likes (user_id);
alter table public.story_likes enable row level security;

revoke all on table public.story_likes from public, anon, authenticated;
grant select, delete on table public.story_likes to authenticated;
grant insert (story_id, user_id) on table public.story_likes to authenticated;

-- The person who liked it reads their own row (is the heart filled?); the author reads every like of their stories.
drop policy if exists "story_likes_select" on public.story_likes;
create policy "story_likes_select" on public.story_likes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.stories s where s.id = story_id and s.author_id = (select auth.uid()))
  );

-- Only as yourself, and only a story you may see right now that is not your own: the subquery reads stories through
-- their select policy (audience, expiry, blocks), so a hidden or expired story is simply not there.
drop policy if exists "story_likes_insert_own" on public.story_likes;
create policy "story_likes_insert_own" on public.story_likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.stories s where s.id = story_id and s.author_id <> (select auth.uid()))
  );

drop policy if exists "story_likes_delete_own" on public.story_likes;
create policy "story_likes_delete_own" on public.story_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 2. Mutes
-- -----------------------------------------------------------------------------
create table if not exists public.story_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, author_id),
  constraint story_mutes_not_self check (user_id <> author_id)
);
create index if not exists story_mutes_author_idx on public.story_mutes (author_id);
alter table public.story_mutes enable row level security;

revoke all on table public.story_mutes from public, anon, authenticated;
grant select, delete on table public.story_mutes to authenticated;
grant insert (user_id, author_id) on table public.story_mutes to authenticated;

-- Whose stories you have muted is yours alone: the muted person never learns of it.
drop policy if exists "story_mutes_select_own" on public.story_mutes;
create policy "story_mutes_select_own" on public.story_mutes
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "story_mutes_insert_own" on public.story_mutes;
create policy "story_mutes_insert_own" on public.story_mutes
  for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "story_mutes_delete_own" on public.story_mutes;
create policy "story_mutes_delete_own" on public.story_mutes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 3. Reports: 'story' joins the types (every type allowed today stays)
-- -----------------------------------------------------------------------------
do $$
declare
  v_have text[];
  v_all text[];
begin
  select array_agg(distinct m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.reports'::regclass and c.conname = 'reports_target_type_check';
  select array_agg(distinct t order by t) into v_all
  from unnest(coalesce(v_have, '{}'::text[]) || array['story']) as t;
  alter table public.reports drop constraint if exists reports_target_type_check;
  execute format('alter table public.reports add constraint reports_target_type_check check (target_type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- What a moderator sees of a reported story: its photo or video and who it was shared with. The website has no page
-- for a story, so the link is its author's profile. Even an expired story is shown while its row lasts (the sweep
-- deletes it within ten minutes of expiry, migration 59). Staff functions only: no API role may call it.
create or replace function public.ts_story_snapshot(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_story public.stories%rowtype;
  v_uni uuid;
  v_media jsonb := '[]'::jsonb;
  v_fields jsonb;
begin
  select * into v_story from public.stories s where s.id = p_id;
  if not found then
    return null;
  end if;
  if v_story.kind = 'photo' and coalesce(v_story.image_url, '') <> '' then
    v_media := jsonb_build_array(jsonb_build_object('url', v_story.image_url, 'kind', 'image'));
  elsif v_story.kind = 'video' and coalesce(v_story.video ->> 'playback_id', '') ~ '^[A-Za-z0-9]+$' then
    v_media := jsonb_build_array(jsonb_build_object('url', 'https://stream.mux.com/' || (v_story.video ->> 'playback_id') || '.m3u8', 'kind', 'video'));
  end if;
  v_fields := jsonb_build_array(
    jsonb_build_object('field', 'body', 'text', case when v_story.kind = 'video' then 'A video story' else 'A photo story' end),
    jsonb_build_object('field', 'audience', 'text', case v_story.audience when 'campus' then 'Campus only' when 'friends' then 'Friends only' when 'selected' then 'Selected people' else 'Everyone' end)
  );
  v_uni := coalesce(v_story.university_id, (select p.university_id from public.profiles p where p.id = v_story.author_id));
  return jsonb_build_object(
    'entityType', 'story', 'entityId', p_id, 'status', 'active', 'universityId', v_uni, 'surface', 'story', 'label', 'story',
    'autoHideImmune', false, 'createdAt', public.ts_ms(v_story.created_at), 'href', '/profile/' || v_story.author_id::text,
    'fields', v_fields, 'media', v_media, 'parent', null);
end;
$$;
revoke all on function public.ts_story_snapshot(uuid) from public, anon, authenticated;

-- Migration 41's ts_snapshot(), ts_author_of() and ts_set_content_status(), with a story read first; every other type
-- goes on exactly as before.
create or replace function public.ts_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
begin
  if p_id is null or p_type is null then
    return null;
  end if;
  if p_type = 'story' then
    return public.ts_story_snapshot(p_id);
  end if;
  if public.ts_is_anon(p_type) then
    begin
      s := public.buzz_v2_snapshot(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
    exception when undefined_function then
      return null;
    end;
    if s is null or jsonb_typeof(s) <> 'object' or s ->> 'entityId' is null then
      return null;
    end if;
    return s;
  end if;
  return public.ts_public_snapshot(p_type, p_id);
end;
$$;

create or replace function public.ts_author_of(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return null;
  end if;
  if p_type = 'story' then
    return (select s.author_id from public.stories s where s.id = p_id);
  end if;
  if public.ts_is_anon(p_type) then
    return public.buzz_v2_author_of(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
  end if;
  return public.ts_public_author_of(p_type, p_id);
end;
$$;

-- 'active' | 'hidden' | 'removed'. Public content can only be removed (it has no hidden state); a removed story is
-- deleted, and its photo file with it (migration 59's stories_after_delete).
create or replace function public.ts_set_content_status(p_type text, p_id uuid, p_status text, p_immune boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.ts_is_anon(p_type) then
    perform public.buzz_v2_set_status(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id, p_status, p_immune);
  elsif p_status = 'removed' and p_type = 'story' then
    delete from public.stories where id = p_id;
  elsif p_status = 'removed' then
    perform public.ts_public_remove(p_type, p_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Story cards in chats
-- -----------------------------------------------------------------------------
-- Migration 17's check, with a story card: its link is /stories/<id> (rebuilt from the id, as every card's is), and its
-- kind says whether it was shared ('story') or answers the story ('story_reply'). Other cards keep their three kinds.
alter table public.messages drop constraint if exists messages_shared_post_check;
alter table public.messages add constraint messages_shared_post_check check (
  shared_post is null
  or coalesce(
    jsonb_typeof(shared_post) = 'object'
    and shared_post->>'target_type' in ('post', 'apartment', 'roommate', 'item', 'story')
    and shared_post->>'target_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and shared_post->>'path' = (case shared_post->>'target_type' when 'post' then '/posts/' when 'apartment' then '/apartments/' when 'roommate' then '/roommates/' when 'story' then '/stories/' else '/marketplace/' end) || (shared_post->>'target_id')
    and case when shared_post->>'target_type' = 'story'
      then coalesce(shared_post->>'kind', '') in ('story', 'story_reply')
      else coalesce(shared_post->>'kind', 'post') in ('post', 'reel', 'listing')
    end,
    false
  )
);

-- A story card is checked against the story itself, and rewritten from it. The other cards are left to
-- guard_message_shared_post() (migration 47), which passes a story card through untouched. Blocks are read from the
-- table, not is_blocked_either_way(), because the people checked are not only the caller.
create or replace function public.guard_message_story_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_reply boolean;
  v_story public.stories%rowtype;
  v_name text;
  v_avatar text;
  v_picture text;
begin
  if new.shared_post is null or jsonb_typeof(new.shared_post) <> 'object' or new.shared_post ->> 'target_type' is distinct from 'story' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.shared_post is not distinct from old.shared_post then
    return new;
  end if;
  v_id := new.shared_post ->> 'target_id';
  if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    -- Malformed: messages_shared_post_check refuses it.
    return new;
  end if;
  v_reply := new.shared_post ->> 'kind' = 'story_reply';

  select * into v_story from public.stories s where s.id = v_id::uuid;
  if not found or v_story.expires_at <= now()
     or not public.can_see_story_as(new.sender_id, v_story.id, v_story.author_id, v_story.audience, v_story.university_id)
     or exists (
       select 1 from public.blocks b
       where (b.blocker_id = new.sender_id and b.blocked_id = v_story.author_id) or (b.blocker_id = v_story.author_id and b.blocked_id = new.sender_id)
     ) then
    raise exception 'This story is no longer available.' using errcode = '42501';
  end if;
  if v_reply and (new.sender_id = v_story.author_id or not exists (
    select 1 from public.conversation_members m where m.conversation_id = new.conversation_id and m.user_id = v_story.author_id
  )) then
    raise exception 'A reply to a story goes to the person who shared it.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.conversation_members m
    where m.conversation_id = new.conversation_id
      and m.user_id is distinct from new.sender_id
      and (
        not public.can_see_story_as(m.user_id, v_story.id, v_story.author_id, v_story.audience, v_story.university_id)
        or exists (
          select 1 from public.blocks b
          where (b.blocker_id = m.user_id and b.blocked_id = v_story.author_id) or (b.blocker_id = v_story.author_id and b.blocked_id = m.user_id)
        )
      )
  ) then
    raise exception 'Some people in this chat can''t see this story.' using errcode = '42501';
  end if;

  select p.full_name, p.avatar_url into v_name, v_avatar from public.profiles p where p.id = v_story.author_id;
  -- A photo story shows its photo; a video story its poster, or a still Mux makes of it.
  v_picture := coalesce(
    nullif(v_story.image_url, ''),
    nullif(v_story.video ->> 'poster_url', ''),
    case when coalesce(v_story.video ->> 'playback_id', '') ~ '^[A-Za-z0-9]+$' then 'https://image.mux.com/' || (v_story.video ->> 'playback_id') || '/thumbnail.jpg' end
  );
  new.shared_post := jsonb_build_object(
    'target_type', 'story',
    'target_id', v_story.id,
    'kind', case when v_reply then 'story_reply' else 'story' end,
    'path', '/stories/' || v_story.id::text,
    'title', null,
    'caption', null,
    'image_url', v_picture,
    'author', jsonb_build_object('id', v_story.author_id, 'name', coalesce(v_name, 'Someone'), 'avatar_url', v_avatar)
  );
  return new;
end;
$$;
revoke all on function public.guard_message_story_card() from public, anon, authenticated;
drop trigger if exists messages_guard_story_card on public.messages;
create trigger messages_guard_story_card
  before insert or update of shared_post on public.messages
  for each row execute function public.guard_message_story_card();

-- Migration 30's inbox line and notification text, naming a story card when a message has no words of its own.
create or replace function public.message_preview(p_content text, p_shared jsonb, p_attachments jsonb, p_snap jsonb, p_len int default 120)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(p_content, p_len), ''),
    case when p_snap is not null then 'Sent a Snap' end,
    case when p_shared is not null then
      case p_shared ->> 'kind' when 'reel' then 'Sent a reel' when 'listing' then 'Sent a listing' when 'story' then 'Sent a story' when 'story_reply' then 'Replied to a story' else 'Sent a post' end
    end,
    public.message_attachments_preview(p_attachments)
  );
$$;

-- Migration 31's quote of the message a reply answers: a story card is quoted as 'story' (it was 'listing' for any
-- card that was not a post). Everything else is as before.
create or replace function public.message_reply_snapshot(p_conversation_id uuid, p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m public.messages%rowtype;
  v_kind text;
  v_files jsonb;
  v_n int;
begin
  select * into v_m from public.messages m where m.id = p_message_id and m.conversation_id = p_conversation_id;
  if not found then
    raise exception 'You can only reply to a message in this chat' using errcode = 'foreign_key_violation', constraint = 'messages_reply_to_check';
  end if;
  v_files := case when jsonb_typeof(v_m.attachments) = 'array' then v_m.attachments else '[]'::jsonb end;
  v_n := jsonb_array_length(v_files);
  if jsonb_typeof(v_m.snap) = 'object' then
    v_kind := 'snap';
  elsif jsonb_typeof(v_m.shared_post) = 'object' then
    v_kind := case
      when v_m.shared_post ->> 'target_type' = 'story' then 'story'
      when coalesce(v_m.shared_post ->> 'target_type', '') not in ('', 'post') then 'listing'
      when v_m.shared_post ->> 'kind' = 'reel' then 'reel'
      else 'post'
    end;
  elsif v_n > 0 then
    v_kind := case
      when (select count(*) from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'audio') = v_n then 'voice'
      when exists (select 1 from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'video') then 'video'
      when exists (select 1 from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'image') then 'photo'
      when (select count(*) from jsonb_array_elements(v_files) e where e.value ->> 'kind' = 'file') = v_n then 'file'
      else 'photo'
    end;
  elsif v_m.image_url ~* '^https://' then
    v_kind := 'photo';
  else
    v_kind := 'text';
  end if;
  return jsonb_build_object(
    'id', v_m.id,
    'sender_id', v_m.sender_id,
    'kind', v_kind,
    'text', nullif(left(coalesce(v_m.content, ''), 140), '')
  );
end;
$$;

notify pgrst, 'reload schema';
