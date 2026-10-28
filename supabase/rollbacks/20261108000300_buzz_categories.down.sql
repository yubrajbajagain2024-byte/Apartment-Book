-- Rollback of 20261108000300_buzz_categories.sql: buzz_v2_create as in 20261103000100_buzz_v2.sql and buzz_root_json
-- as in 20261108000200_buzz_prompt_threads.sql. buzz_posts.category and its check stay, with every category in it:
-- nothing reads them any more, and applying the migration again shows them again.

create or replace function public.buzz_v2_create(
  p_author uuid, p_input jsonb, p_status text default 'active', p_support_link boolean default false, p_moderation jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
declare
  v_cfg public.buzz_secrets;
  v_me public.profiles;
  v_in jsonb := coalesce(p_input, '{}'::jsonb);
  v_status text := coalesce(p_status, 'active');
  v_text text;
  v_title text;
  v_scope text;
  v_images text[] := '{}'::text[];
  v_meta jsonb := '[]'::jsonb;
  v_videos jsonb := '[]'::jsonb;
  v_item jsonb;
  v_url text;
  v_prefix text;
  v_video jsonb;
  v_pb text;
  v_media public.media;
  v_duration numeric;
  v_poster text;
  v_width numeric;
  v_height numeric;
  v_options text[];
  v_days int;
  v_prompt uuid;
  v_id uuid := gen_random_uuid();
  v_visible timestamptz;
  b public.buzz_posts;
begin
  perform public.buzz_v2_assert_writer(p_author);
  if v_status not in ('active', 'held') then
    raise exception 'buzz:validation_failed:A new buzz is active or held for review.';
  end if;
  if jsonb_typeof(v_in) <> 'object'
     or coalesce(jsonb_typeof(v_in -> 'text'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(v_in -> 'title'), 'null') not in ('string', 'null') then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;
  select * into v_me from public.profiles where id = p_author;
  select * into v_cfg from public.buzz_secrets where id = 1;

  -- words: an optional title and a body, one of them saying something
  v_text := public.buzz_trim(v_in ->> 'text');
  v_title := public.buzz_trim(v_in ->> 'title');
  if char_length(v_text) > 500 then
    raise exception 'buzz:validation_failed:Keep it under 500 characters.';
  end if;
  if char_length(v_title) > 100 then
    raise exception 'buzz:validation_failed:Keep the title under 100 characters.';
  end if;
  if v_text = '' and v_title = '' then
    raise exception 'buzz:validation_failed:Say something first.';
  end if;

  -- where: Campus (the author's university) or Global, never both
  v_scope := coalesce(v_in ->> 'scope', 'campus');
  if v_scope not in ('campus', 'global') then
    raise exception 'buzz:validation_failed:Pick Campus or Global.';
  end if;
  if v_scope = 'campus' and v_me.university_id is null then
    raise exception 'buzz:validation_failed:Add your university to your profile to buzz on its campus feed.';
  end if;

  -- photos: up to 4, from this project's anonymous folder under a random name, really uploaded by the author
  if jsonb_typeof(v_in -> 'images') = 'array' then
    if jsonb_array_length(v_in -> 'images') > 4 then
      raise exception 'buzz:validation_failed:You can attach up to 4 photos.';
    end if;
    v_prefix := v_cfg.storage_origin || '/storage/v1/object/public/uploads/buzz/anon/';
    for v_item in select e from jsonb_array_elements(v_in -> 'images') as e loop
      v_url := case when jsonb_typeof(v_item) = 'string' then v_item #>> '{}' end;
      if v_url is null
         or left(v_url, length(v_cfg.storage_origin)) <> v_cfg.storage_origin
         or substr(v_url, length(v_cfg.storage_origin) + 1) !~ '^/storage/v1/object/public/uploads/buzz/anon/[a-f0-9]{32,64}\.(jpg|jpeg|png|webp)$'
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'uploads' and o.name = 'buzz/anon/' || substr(v_url, length(v_prefix) + 1)
             and (to_jsonb(o) ->> 'owner_id' = p_author::text or to_jsonb(o) ->> 'owner' = p_author::text)) then
        raise exception 'buzz:validation_failed:Buzz photos must be uploaded anonymously.';
      end if;
      if not (v_url = any (v_images)) then
        v_images := v_images || v_url;
      end if;
    end loop;
  elsif coalesce(jsonb_typeof(v_in -> 'images'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:Buzz photos must be uploaded anonymously.';
  end if;
  -- one meta entry per attached photo, numbers only, a small blur only
  select coalesce(jsonb_agg(t.entry), '[]'::jsonb) into v_meta
  from (
    select distinct on (m ->> 'url') jsonb_build_object(
      'url', m ->> 'url',
      'width', case when jsonb_typeof(m -> 'width') = 'number' and (m ->> 'width')::numeric between 1 and 50000 then m -> 'width' else 'null'::jsonb end,
      'height', case when jsonb_typeof(m -> 'height') = 'number' and (m ->> 'height')::numeric between 1 and 50000 then m -> 'height' else 'null'::jsonb end,
      'blur', case when jsonb_typeof(m -> 'blur') = 'string' and (m ->> 'blur') like 'data:image/%' and length(m ->> 'blur') <= 4000 then m -> 'blur' else 'null'::jsonb end
    ) as entry
    from jsonb_array_elements(case when jsonb_typeof(v_in -> 'imageMeta') = 'array' and jsonb_array_length(v_in -> 'imageMeta') <= 24
                                   then v_in -> 'imageMeta' else '[]'::jsonb end) as m
    where jsonb_typeof(m) = 'object' and m ->> 'url' = any (v_images)
    order by m ->> 'url'
  ) t;

  -- or one video: the author's own finished Mux upload, 60 seconds at most, stored without its media id
  if jsonb_typeof(v_in -> 'video') = 'object' then
    if cardinality(v_images) > 0 then
      raise exception 'buzz:validation_failed:Add photos or one video, not both.';
    end if;
    v_video := v_in -> 'video';
    v_pb := case when jsonb_typeof(v_video -> 'playbackId') = 'string' then v_video ->> 'playbackId' end;
    if v_pb is null or v_pb !~ '^[A-Za-z0-9]{8,120}$' then
      raise exception 'buzz:validation_failed:That video isn''t ready yet.';
    end if;
    select * into v_media from public.media m
    where m.playback_id = v_pb and m.owner_id = p_author and m.status = 'ready'
    order by m.created_at desc
    limit 1;
    if v_media.id is null then
      raise exception 'buzz:validation_failed:That video isn''t ready yet.';
    end if;
    v_duration := coalesce(v_media.duration_seconds,
                           case when jsonb_typeof(v_video -> 'durationSeconds') = 'number' then (v_video ->> 'durationSeconds')::numeric end);
    if v_duration is not null and (v_duration < 0 or v_duration > 60.5) then
      raise exception 'buzz:validation_failed:Videos on Buzz max out at 60 seconds.';
    end if;
    v_poster := coalesce(v_media.poster_url, case when jsonb_typeof(v_video -> 'posterUrl') = 'string' then v_video ->> 'posterUrl' end);
    if v_poster is null or length(v_poster) > 300 or v_poster !~ ('^https://image\.mux\.com/' || v_pb || '/[A-Za-z0-9._?=&-]+$') then
      v_poster := null;
    end if;
    v_width := coalesce(v_media.width::numeric, case when jsonb_typeof(v_video -> 'width') = 'number' then (v_video ->> 'width')::numeric end);
    v_height := coalesce(v_media.height::numeric, case when jsonb_typeof(v_video -> 'height') = 'number' then (v_video ->> 'height')::numeric end);
    v_videos := jsonb_build_array(jsonb_build_object(
      'media_id', '00000000-0000-0000-0000-000000000000',
      'playback_id', v_pb,
      'poster_url', v_poster,
      'width', case when v_width between 1 and 20000 then v_width end,
      'height', case when v_height between 1 and 20000 then v_height end,
      'duration_seconds', v_duration));
  elsif coalesce(jsonb_typeof(v_in -> 'video'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:That video isn''t ready yet.';
  end if;

  -- a poll: 2-4 different options of 1-60 characters, 1, 3 or 7 days, from accounts at least a day old
  if jsonb_typeof(v_in -> 'poll') = 'object' then
    if coalesce(jsonb_typeof(v_in -> 'poll' -> 'options'), '') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_in -> 'poll' -> 'options') as e where jsonb_typeof(e) <> 'string') then
      raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
    end if;
    select array_agg(public.buzz_trim(x.e #>> '{}') order by x.n) into v_options
    from jsonb_array_elements(v_in -> 'poll' -> 'options') with ordinality as x(e, n);
    if coalesce(cardinality(v_options), 0) not between 2 and 4 then
      raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
    end if;
    if exists (select 1 from unnest(v_options) as o where char_length(o) not between 1 and 60) then
      raise exception 'buzz:validation_failed:Each poll option needs 1 to 60 characters.';
    end if;
    if (select count(distinct lower(o)) from unnest(v_options) as o) <> cardinality(v_options) then
      raise exception 'buzz:validation_failed:Poll options must be different.';
    end if;
    v_days := case when jsonb_typeof(v_in -> 'poll' -> 'durationDays') = 'number' and (v_in -> 'poll' ->> 'durationDays') in ('1', '3', '7')
                   then (v_in -> 'poll' ->> 'durationDays')::int end;
    if v_days is null then
      raise exception 'buzz:validation_failed:Polls run for 1, 3 or 7 days.';
    end if;
    if v_me.created_at > now() - interval '24 hours' then
      raise exception 'buzz:too_new:Polls unlock 24 hours after you join.';
    end if;
  elsif coalesce(jsonb_typeof(v_in -> 'poll'), 'null') <> 'null' then
    raise exception 'buzz:validation_failed:Polls need 2 to 4 options.';
  end if;

  -- answering a Daily Campus Prompt
  if coalesce(jsonb_typeof(v_in -> 'promptId'), 'null') <> 'null' then
    if jsonb_typeof(v_in -> 'promptId') = 'string' and (v_in ->> 'promptId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.id into v_prompt from public.buzz_prompts p where p.id = (v_in ->> 'promptId')::uuid;
    end if;
    if v_prompt is null then
      raise exception 'buzz:validation_failed:That prompt has expired.';
    end if;
  end if;

  perform public.buzz_v2_rate_limit(p_author, 'thread');
  v_visible := now() + make_interval(secs => random() * greatest(coalesce(v_cfg.thread_jitter_seconds, 0), 0));
  insert into public.buzz_posts (id, author_id, alias, university_id, title, body, images, image_meta, videos, scope, status, support_link,
                                 prompt_id, created_at, visible_at)
  values (v_id, p_author, '', v_me.university_id, v_title, v_text, v_images, v_meta, v_videos, v_scope, v_status, coalesce(p_support_link, false),
          v_prompt, now(), v_visible);
  if v_options is not null then
    insert into public.buzz_polls (post_id, closes_at) values (v_id, public.buzz_floor_minute(v_visible) + make_interval(days => v_days));
    insert into public.buzz_poll_options (post_id, idx, text)
    select v_id, (u.n - 1)::int, u.o from unnest(v_options) with ordinality as u(o, n);
  end if;
  if jsonb_typeof(p_moderation) = 'object' then
    perform public.ts_apply_moderation(p_entity_type => 'buzz', p_entity_id => v_id, p_surface => 'buzz', p_author => p_author,
                                       p_university => v_me.university_id, p_moderation => p_moderation);
  end if;
  -- Held content waits for a person: it always has a queue item, even if the record named none.
  if v_status = 'held' and coalesce(jsonb_typeof(p_moderation -> 'queue'), '') <> 'object' then
    perform public.ts_enqueue(
      p_entity_type => 'buzz', p_entity_id => v_id, p_surface => 'buzz', p_university => v_me.university_id, p_author => p_author,
      p_source => 'rule_flag', p_category => null, p_severity => 'none', p_priority => 'p2', p_label => null,
      p_rule_ids => '[]'::jsonb, p_blocked_text => null, p_report_delta => 0, p_weight_delta => 0);
  end if;
  select * into b from public.buzz_posts where id = v_id;
  return public.buzz_root_json(b, p_author, false);
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
    'promptId', b.prompt_id,
    -- the thread of a day's prompt, owned by no one: its replies are the answers
    'isPromptThread', exists (select 1 from public.buzz_prompt_threads t where t.thread_id = b.id),
    -- an answer posted as its own buzz: that day's prompt thread on its feed, once anyone answered there
    'promptThreadId', case when b.prompt_id is not null then (
      select t.thread_id from public.buzz_prompt_threads t
      where t.prompt_id = b.prompt_id and t.thread_id <> b.id and t.scope = b.scope
        and t.university_id is not distinct from case when b.scope = 'campus' then b.university_id end
        and t.day between (b.created_at at time zone 'utc')::date - 1 and (b.created_at at time zone 'utc')::date
      order by t.day desc
      limit 1) end);
end;
$$;

-- Internal, as every Buzz function is (buzz_v2.sql §17); creating is for the website's moderated write API.
revoke all on function public.buzz_v2_create(uuid, jsonb, text, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.buzz_v2_create(uuid, jsonb, text, boolean, jsonb) to service_role;
revoke all on function public.buzz_root_json(public.buzz_posts, uuid, boolean) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
