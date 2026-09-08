-- =============================================================================
-- Apartment Book - migration 8: likes and comments on posts
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.post_likes (
  target_type text not null check (target_type in ('apartment', 'item', 'roommate')),
  target_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, user_id),
  constraint post_likes_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index if not exists post_likes_target_idx on public.post_likes (target_type, target_id);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('apartment', 'item', 'roommate')),
  target_id uuid not null,
  user_id uuid not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint post_comments_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index if not exists post_comments_target_idx on public.post_comments (target_type, target_id, created_at);

alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

drop policy if exists "post_likes_select" on public.post_likes;
create policy "post_likes_select" on public.post_likes for select using (true);
drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own" on public.post_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own" on public.post_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "post_comments_select" on public.post_comments;
create policy "post_comments_select" on public.post_comments for select using (true);
drop policy if exists "post_comments_insert_own" on public.post_comments;
create policy "post_comments_insert_own" on public.post_comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "post_comments_delete_own_or_owner" on public.post_comments;
create policy "post_comments_delete_own_or_owner" on public.post_comments
  for delete to authenticated using (user_id = auth.uid() or public.listing_owner(target_type, target_id) = auth.uid());

-- Like/comment counts plus whether the caller liked it, in one call.
create or replace function public.post_engagement(p_target_type text, p_target_id uuid)
returns table (likes bigint, comments bigint, liked_by_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.post_likes l where l.target_type = p_target_type and l.target_id = p_target_id),
    (select count(*) from public.post_comments c where c.target_type = p_target_type and c.target_id = p_target_id),
    exists (select 1 from public.post_likes l where l.target_type = p_target_type and l.target_id = p_target_id and l.user_id = auth.uid());
$$;

-- Same numbers for a whole feed page in one round trip.
create or replace function public.post_engagement_many(p_target_type text, p_target_ids uuid[])
returns table (target_id uuid, likes bigint, comments bigint, liked_by_me boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id,
    (select count(*) from public.post_likes l where l.target_type = p_target_type and l.target_id = t.id),
    (select count(*) from public.post_comments c where c.target_type = p_target_type and c.target_id = t.id),
    exists (select 1 from public.post_likes l where l.target_type = p_target_type and l.target_id = t.id and l.user_id = auth.uid())
  from unnest(p_target_ids) as t(id);
$$;

-- Notifications for likes and comments (owner only, never for your own actions).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment'));

create or replace function public.post_link(p_target_type text, p_target_id uuid)
returns text
language sql
immutable
as $$
  select case p_target_type when 'apartment' then '/apartments/' when 'item' then '/marketplace/' else '/roommates/' end || p_target_id;
$$;

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.listing_owner(new.target_type, new.target_id);
  v_actor text;
  v_count bigint;
begin
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;
  select full_name into v_actor from public.profiles where id = new.user_id;
  select count(*) into v_count from public.post_likes where target_type = new.target_type and target_id = new.target_id;
  perform public.notify(
    v_owner, new.user_id, 'like',
    case when v_count > 1 then coalesce(v_actor, 'Someone') || ' and ' || (v_count - 1) || ' other' || case when v_count > 2 then 's' else '' end || ' liked your post'
         else coalesce(v_actor, 'Someone') || ' liked your post' end,
    null, public.post_link(new.target_type, new.target_id),
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id),
    'like:' || new.target_type || ':' || new.target_id
  );
  return new;
end;
$$;
drop trigger if exists notify_on_like on public.post_likes;
create trigger notify_on_like after insert on public.post_likes for each row execute function public.notify_on_like();

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.listing_owner(new.target_type, new.target_id);
  v_actor text;
begin
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;
  select full_name into v_actor from public.profiles where id = new.user_id;
  perform public.notify(
    v_owner, new.user_id, 'comment',
    coalesce(v_actor, 'Someone') || ' commented on your post', left(new.body, 140),
    public.post_link(new.target_type, new.target_id),
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id, 'comment_id', new.id),
    null
  );
  return new;
end;
$$;
drop trigger if exists notify_on_comment on public.post_comments;
create trigger notify_on_comment after insert on public.post_comments for each row execute function public.notify_on_comment();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_comments') then
    alter publication supabase_realtime add table public.post_comments;
  end if;
end $$;
