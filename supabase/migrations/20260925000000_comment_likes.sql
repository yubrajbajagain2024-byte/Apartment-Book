-- Migration 16: hearts on comments. The heart under a comment counts only the people who liked it; a dislike stays private
-- (like TikTok and YouTube) and only moves the Reddit-style score from migration 15. Safe to re-run.

alter table public.post_comments add column if not exists likes int not null default 0;

-- Both counts belong to the server: inserts start at 0 and only the votes trigger (which runs nested) may change them.
create or replace function public.post_comments_guard_score()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.score := 0;
    new.likes := 0;
  elsif pg_trigger_depth() <= 1 then
    new.score := old.score;
    new.likes := old.likes;
  end if;
  return new;
end;
$$;
drop trigger if exists post_comments_guard_score on public.post_comments;
create trigger post_comments_guard_score
  before insert or update of score, likes on public.post_comments
  for each row execute function public.post_comments_guard_score();

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
  set score = coalesce((select sum(v.value) from public.post_comment_votes v where v.comment_id = v_id), 0),
      likes = (select count(*) from public.post_comment_votes v where v.comment_id = v_id and v.value = 1)
  where c.id = v_id;
  return null;
end;
$$;
drop trigger if exists post_comment_votes_apply on public.post_comment_votes;
create trigger post_comment_votes_apply
  after insert or update or delete on public.post_comment_votes
  for each row execute function public.post_comment_votes_apply();

-- Count the hearts already given. The guard would keep the old numbers on a direct update, so it steps aside for this one statement.
alter table public.post_comments disable trigger post_comments_guard_score;
update public.post_comments c
set likes = (select count(*) from public.post_comment_votes v where v.comment_id = c.id and v.value = 1)
where c.likes is distinct from (select count(*) from public.post_comment_votes v where v.comment_id = c.id and v.value = 1);
alter table public.post_comments enable trigger post_comments_guard_score;

-- The vote function now returns the hearts too. Its result shape changes, so the old version goes first.
drop function if exists public.post_comment_vote(uuid, int);
create function public.post_comment_vote(p_comment_id uuid, p_value int)
returns table (score int, likes int, my_vote smallint)
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
  return query select c.score, c.likes, p_value::smallint from public.post_comments c where c.id = p_comment_id;
end;
$$;
grant execute on function public.post_comment_vote(uuid, int) to authenticated;
