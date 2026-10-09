-- =============================================================================
-- Apartment Book - migration 15: comment threads with likes and dislikes
--   * post_comments.parent_id: a comment can answer another comment on the same post (Instagram-style replies)
--   * post_comment_votes + post_comments.score: thumbs up / down on a comment, one vote per person
--   * post_comment_vote(): the only way to vote (checks the comment is visible, keeps the score in step)
--   * a reply notifies the author of the comment it answers
-- Safe to run more than once.
-- =============================================================================

alter table public.post_comments add column if not exists parent_id uuid;
alter table public.post_comments add column if not exists score int not null default 0;
alter table public.post_comments drop constraint if exists post_comments_parent_id_fkey;
alter table public.post_comments
  add constraint post_comments_parent_id_fkey foreign key (parent_id) references public.post_comments (id) on delete cascade;
create index if not exists post_comments_parent_idx on public.post_comments (parent_id);

-- The score belongs to the server: inserts start at 0 and only the votes trigger (which runs nested) may change it.
create or replace function public.post_comments_guard_score()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.score := 0;
  elsif pg_trigger_depth() <= 1 then
    new.score := old.score;
  end if;
  return new;
end;
$$;
drop trigger if exists post_comments_guard_score on public.post_comments;
create trigger post_comments_guard_score
  before insert or update of score on public.post_comments
  for each row execute function public.post_comments_guard_score();

-- A reply stays on the post of the comment it answers.
create or replace function public.post_comment_check_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.post_comments;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A comment cannot answer itself';
  end if;
  select * into v_parent from public.post_comments where id = new.parent_id;
  if v_parent.id is null then
    raise exception 'The comment you are answering is gone';
  end if;
  if v_parent.target_type <> new.target_type or v_parent.target_id <> new.target_id then
    raise exception 'A reply must stay on the same post';
  end if;
  -- The parent is hidden from this person (a block either way): to them it does not exist.
  if public.is_blocked_either_way(v_parent.user_id) then
    raise exception 'The comment you are answering is gone';
  end if;
  return new;
end;
$$;
drop trigger if exists post_comment_check_parent on public.post_comments;
create trigger post_comment_check_parent
  before insert or update of parent_id on public.post_comments
  for each row execute function public.post_comment_check_parent();

-- Votes are public like post_likes (so a thread can show "you voted"); writing goes through post_comment_vote() only.
create table if not exists public.post_comment_votes (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists post_comment_votes_user_idx on public.post_comment_votes (user_id);
alter table public.post_comment_votes enable row level security;
drop policy if exists "post_comment_votes_select" on public.post_comment_votes;
create policy "post_comment_votes_select" on public.post_comment_votes for select using (true);
-- No insert / update / delete policies: only the function below writes.

-- The score is the sum of the votes, kept in step by trigger so cascades (a deleted account) are covered too.
create or replace function public.post_comment_votes_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.comment_id, old.comment_id);
begin
  update public.post_comments c
  set score = coalesce((select sum(v.value) from public.post_comment_votes v where v.comment_id = v_id), 0)
  where c.id = v_id;
  return null;
end;
$$;
drop trigger if exists post_comment_votes_apply on public.post_comment_votes;
create trigger post_comment_votes_apply
  after insert or update or delete on public.post_comment_votes
  for each row execute function public.post_comment_votes_apply();

-- Vote on a comment: 1 up, -1 down, 0 clears. Only comments you can see (blocks hide people from each other).
create or replace function public.post_comment_vote(p_comment_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'Invalid vote';
  end if;
  select c.user_id into v_author from public.post_comments c where c.id = p_comment_id for update;
  if v_author is null or public.is_blocked_either_way(v_author) then
    raise exception 'Comment not found';
  end if;
  if p_value = 0 then
    delete from public.post_comment_votes v where v.comment_id = p_comment_id and v.user_id = v_me;
  else
    insert into public.post_comment_votes (comment_id, user_id, value) values (p_comment_id, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
  return query select c.score, p_value::smallint from public.post_comments c where c.id = p_comment_id;
end;
$$;
grant execute on function public.post_comment_vote(uuid, int) to authenticated;

-- A reply tells the author of the comment it answers (the post owner is told by the existing trigger; one message if they are the same person).
create or replace function public.notify_on_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_author uuid;
  v_owner uuid := public.listing_owner(new.target_type, new.target_id);
  v_actor text;
begin
  if new.parent_id is null then
    return new;
  end if;
  select user_id into v_parent_author from public.post_comments where id = new.parent_id;
  if v_parent_author is null or v_parent_author = new.user_id or v_parent_author = v_owner then
    return new;
  end if;
  if exists (select 1 from public.blocks b where (b.blocker_id = v_parent_author and b.blocked_id = new.user_id) or (b.blocker_id = new.user_id and b.blocked_id = v_parent_author)) then
    return new;
  end if;
  select full_name into v_actor from public.profiles where id = new.user_id;
  perform public.notify(
    v_parent_author, new.user_id, 'comment',
    coalesce(v_actor, 'Someone') || ' replied to your comment', left(new.body, 140),
    public.post_link(new.target_type, new.target_id),
    jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id, 'comment_id', new.id, 'parent_id', new.parent_id),
    null
  );
  return new;
end;
$$;
drop trigger if exists notify_on_comment_reply on public.post_comments;
create trigger notify_on_comment_reply
  after insert on public.post_comments
  for each row execute function public.notify_on_comment_reply();
