-- =============================================================================
-- Apartment Book - migration 10: blocking, reporting and account deletion
-- (App Store / Play Store requirements for apps with user content + accounts)
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('apartment', 'item', 'roommate', 'profile', 'message', 'comment')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'scam', 'harassment', 'inappropriate', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists reports_target_idx on public.reports (target_type, target_id);

alter table public.blocks enable row level security;
alter table public.reports enable row level security;

drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own" on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select to authenticated using (reporter_id = auth.uid());
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- True when either of us blocked the other. Anonymous visitors are never blocked.
create or replace function public.is_blocked_either_way(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = auth.uid())
  );
$$;

-- Blocked people's posts and comments disappear from each other's feeds.
drop policy if exists "apartments_select" on public.apartments;
create policy "apartments_select" on public.apartments
  for select using ((status = 'active' or owner_id = auth.uid()) and not public.is_blocked_either_way(owner_id));
drop policy if exists "roommate_posts_select" on public.roommate_posts;
create policy "roommate_posts_select" on public.roommate_posts
  for select using ((is_active or author_id = auth.uid()) and not public.is_blocked_either_way(author_id));
drop policy if exists "items_select" on public.items;
create policy "items_select" on public.items
  for select using ((status <> 'archived' or seller_id = auth.uid()) and not public.is_blocked_either_way(seller_id));
drop policy if exists "post_comments_select" on public.post_comments;
create policy "post_comments_select" on public.post_comments
  for select using (not public.is_blocked_either_way(user_id));

-- No new messages between blocked people, and no new direct chats.
drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
    and not exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id and cm.user_id <> auth.uid() and public.is_blocked_either_way(cm.user_id)
    )
  );

create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'Invalid user';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'User not found';
  end if;
  if public.is_blocked_either_way(p_other_user_id) then
    raise exception 'You cannot message this person';
  end if;

  v_key := least(v_me, p_other_user_id)::text || ':' || greatest(v_me, p_other_user_id)::text;

  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  begin
    insert into public.conversations (type, direct_key, created_by)
    values ('direct', v_key, v_me)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations where direct_key = v_key;
    return v_id;
  end;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other_user_id);
  return v_id;
end;
$$;

-- Delete my own account: profile, listings, messages, likes, comments and the
-- auth user itself (everything cascades from auth.users -> profiles).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  delete from storage.objects where owner = v_me;
  delete from auth.users where id = v_me;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
