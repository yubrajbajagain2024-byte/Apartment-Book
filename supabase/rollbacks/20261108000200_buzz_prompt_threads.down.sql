-- Rollback of supabase/migrations/20261108000200_buzz_prompt_threads.sql.
-- Puts back buzz_v2_meta and buzz_root_json of 20261103000100_buzz_v2.sql and drops the prompt threads' table,
-- functions and title trigger. The prompt threads and their answers stay, as ordinary buzzes with the prompt as their
-- title (titles already set to the prompt stay too); applying the migration again links them to their prompts again.
drop trigger if exists buzz_posts_prompt_title on public.buzz_posts;
drop function if exists public.buzz_v2_prompt_title();
drop function if exists public.buzz_v2_prompt_thread(uuid, text);

create or replace function public.buzz_v2_meta(p_scope text default 'campus')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := public.buzz_v2_viewer();
  v_count int;
  v_prompt_id uuid;
  v_prompt_text text;
  v_uni uuid;
  v_uni_name text;
  v_uni_short text;
begin
  if coalesce(p_scope, 'campus') not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  perform public.buzz_v2_close_due_polls(v_me);
  select count(*) into v_count from public.buzz_prompts;
  if v_count > 0 then
    select p.id, p.text into v_prompt_id, v_prompt_text
    from public.buzz_prompts p
    where p.idx = (floor(extract(epoch from now()) / 86400)::bigint % v_count)::int;
  end if;
  select u.id, u.name, coalesce(nullif(u.short_name, ''), u.name) into v_uni, v_uni_name, v_uni_short
  from public.profiles pr join public.universities u on u.id = pr.university_id
  where pr.id = v_me;
  return jsonb_build_object(
    'prompt', case when v_prompt_id is not null then jsonb_build_object('id', v_prompt_id, 'text', v_prompt_text) end,
    'smallCampusNote', coalesce(p_scope, 'campus') = 'campus' and v_uni is not null and public.buzz_v2_campus_small(v_uni),
    'campus', case when v_uni is not null then jsonb_build_object('name', v_uni_name, 'shortName', v_uni_short) end);
end;
$$;

create or replace function public.buzz_root_json(b public.buzz_posts, p_viewer uuid, p_staff boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff boolean := coalesce(p_staff, false);
  v_viewer uuid := case when coalesce(p_staff, false) then null else p_viewer end;
  v_mine boolean := v_viewer is not null and coalesce(b.author_id = v_viewer, false);
  v_open boolean;
  v_vote int;
begin
  if b.id is null then
    return null;
  end if;
  -- Others read an active buzz; its author reads it in every state but deleted; a placeholder has no words at all.
  v_open := v_staff or (b.status <> 'deleted' and (b.status = 'active' or v_mine));
  if v_viewer is not null then
    select v.value into v_vote from public.buzz_votes v where v.post_id = b.id and v.user_id = v_viewer;
  end if;
  return jsonb_build_object(
    'kind', 'buzz',
    'id', b.id,
    'threadId', b.id,
    'alias', public.buzz_alias_json(public.buzz_alias_digest(b.id, public.buzz_author_key(b.author_id, b.alias)), 0),
    'isOp', true,
    'isMine', v_mine,
    'text', case when v_open then b.body else '' end,
    'title', case when v_open then b.title else '' end,
    'media', case when v_open then public.buzz_v2_media_json(b) else '[]'::jsonb end,
    'scope', b.scope,
    'score', b.score,
    'myVote', coalesce(v_vote, 0),
    'collapsed', b.eligible_score <= -5 and b.eligible_votes >= 8,
    'status', b.status,
    'supportLink', b.support_link,
    'createdAt', public.buzz_minute_ms(least(b.visible_at, now())),
    'poll', case when v_open then public.buzz_v2_poll_json(b.id, v_viewer, v_mine) end,
    'replyCount', public.buzz_v2_reply_count(b.id, v_viewer, v_staff),
    'locked', b.locked,
    'campusShortName', case when b.scope = 'global' then public.buzz_v2_campus_name(b.university_id) end,
    'promptId', b.prompt_id);
end;
$$;

drop function if exists public.buzz_v2_prompt_thread_id(uuid, date, text, uuid);
drop function if exists public.buzz_v2_today_prompt();
drop table if exists public.buzz_prompt_threads;

revoke all on function public.buzz_root_json(public.buzz_posts, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.buzz_v2_meta(text) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_meta(text) to authenticated;

notify pgrst, 'reload schema';
