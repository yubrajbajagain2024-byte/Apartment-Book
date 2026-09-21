-- =============================================================================
-- Apartment Book - migration 13: votes on Buzz replies (Reddit-style threads)
-- Same rules as the rest of Buzz: the table is closed to the API, everything
-- goes through security-definer functions, nothing identifies who voted.
-- Safe to run more than once.
-- =============================================================================
alter table public.buzz_comments add column if not exists score int not null default 0;

create table if not exists public.buzz_comment_votes (
  comment_id uuid not null references public.buzz_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.buzz_comment_votes enable row level security;
revoke all on public.buzz_comment_votes from anon, authenticated;

-- Replies now carry their score and my vote. (New columns at the end: older app builds ignore them.)
drop function if exists public.buzz_comments_list(uuid);
create or replace function public.buzz_comments_list(p_post_id uuid)
returns table (id uuid, parent_id uuid, body text, created_at timestamptz, alias text, is_op boolean, is_mine boolean, score int, my_vote smallint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.parent_id, c.body, least(c.visible_at, now()), c.alias, c.is_op, coalesce(c.author_id = auth.uid(), false),
    c.score,
    coalesce((select v.value from public.buzz_comment_votes v where v.comment_id = c.id and v.user_id = auth.uid()), 0)::smallint
  from public.buzz_comments c
  join public.buzz_posts b on b.id = c.post_id
  where c.post_id = p_post_id
    and public.buzz_can_see(b)
    and (c.visible_at <= now() or coalesce(c.author_id = auth.uid(), false))
    and not public.buzz_hidden(c.author_id, c.post_id)
  order by c.visible_at asc, c.seq asc
  limit 500;
$$;
grant execute on function public.buzz_comments_list(uuid) to anon, authenticated;

-- Vote on a reply: 1 up, -1 down, 0 clears. Only replies the caller can see.
create or replace function public.buzz_comment_vote(p_comment_id uuid, p_value int)
returns table (score int, my_vote smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_comment public.buzz_comments;
  v_post public.buzz_posts;
  v_old int;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'Invalid vote';
  end if;
  select * into v_comment from public.buzz_comments c where c.id = p_comment_id for update;
  if v_comment.id is not null then
    select * into v_post from public.buzz_posts b where b.id = v_comment.post_id;
  end if;
  if v_comment.id is null or v_post.id is null or not public.buzz_can_see(v_post)
     or not (v_comment.visible_at <= now() or coalesce(v_comment.author_id = v_me, false))
     or public.buzz_hidden(v_comment.author_id, v_comment.post_id) then
    raise exception 'Reply not found';
  end if;
  select v.value into v_old from public.buzz_comment_votes v where v.comment_id = p_comment_id and v.user_id = v_me;
  v_old := coalesce(v_old, 0);
  if p_value = 0 then
    delete from public.buzz_comment_votes v where v.comment_id = p_comment_id and v.user_id = v_me;
  else
    insert into public.buzz_comment_votes (comment_id, user_id, value) values (p_comment_id, v_me, p_value)
    on conflict (comment_id, user_id) do update set value = excluded.value;
  end if;
  update public.buzz_comments c set score = c.score - v_old + p_value where c.id = p_comment_id;
  return query select c.score, p_value::smallint from public.buzz_comments c where c.id = p_comment_id;
end;
$$;
revoke all on function public.buzz_comment_vote(uuid, int) from public, anon;
grant execute on function public.buzz_comment_vote(uuid, int) to authenticated;
