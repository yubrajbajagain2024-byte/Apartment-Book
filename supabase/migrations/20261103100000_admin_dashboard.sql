-- =============================================================================
-- Migration 16: read-only queries for the separate admin app (CampConnect Admin)
-- =============================================================================
-- Four staff functions on top of migrations 14 and 15. Every one of them calls
-- staff_require('moderator'), so the caller must be staff, not suspended, and in
-- a session that passed two-factor authentication (aal2). Nothing here writes.
--
--   admin_overview_stats()                 counts for the overview page
--   admin_users_list(filter, limit, before) browse people newest first
--                                          (all | suspended | staff)
--   admin_hidden_content_list(type, limit, before)
--                                          hidden content across the eight
--                                          moderated tables, newest hide first
--   admin_report_get(id)                   one report, same shape as
--                                          admin_reports_list
--
-- Buzz stays anonymous: the hidden-content list carries no Buzz author and
-- shows the published time (visible_at), never the real created_at, exactly
-- like the report queue. Only admin_content_get reveals a Buzz author, and it
-- logs every look (migration 15). Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Overview counts
-- -----------------------------------------------------------------------------
create or replace function public.admin_overview_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public.staff_require('moderator');
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_new_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'users_active_24h', (select count(*) from public.profiles p where p.last_seen_at > now() - interval '24 hours'),
    'suspended_active', (select count(*) from public.account_restrictions r where r.lifted_at is null and (r.expires_at is null or r.expires_at > now())),
    'reports_open', (select count(*) from public.reports r where r.status = 'open'),
    'reports_closed_7d', (select count(*) from public.reports r where r.status <> 'open' and r.reviewed_at > now() - interval '7 days'),
    'hidden_content',
        (select count(*) from public.apartments x where x.hidden_at is not null)
      + (select count(*) from public.items x where x.hidden_at is not null)
      + (select count(*) from public.roommate_posts x where x.hidden_at is not null)
      + (select count(*) from public.feed_posts x where x.hidden_at is not null)
      + (select count(*) from public.post_comments x where x.hidden_at is not null)
      + (select count(*) from public.messages x where x.hidden_at is not null)
      + (select count(*) from public.buzz_posts x where x.hidden_at is not null)
      + (select count(*) from public.buzz_comments x where x.hidden_at is not null),
    'listings_total',
        (select count(*) from public.apartments)
      + (select count(*) from public.items)
      + (select count(*) from public.roommate_posts),
    'posts_total', (select count(*) from public.feed_posts),
    'buzz_total', (select count(*) from public.buzz_posts),
    'media_pending', (select count(*) from public.media_jobs j where j.done_at is null),
    'media_failing', (select count(*) from public.media_jobs j where j.done_at is null and j.attempts >= 3),
    'staff_total', (select count(*) from public.staff)
  ) into v;
  return v;
end;
$$;
revoke all on function public.admin_overview_stats() from public, anon;
grant execute on function public.admin_overview_stats() to authenticated;

-- -----------------------------------------------------------------------------
-- People, newest first. p_before = the oldest created_at you have (paging).
-- -----------------------------------------------------------------------------
create or replace function public.admin_users_list(p_filter text default 'all', p_limit int default 50, p_before timestamptz default null)
returns table (user_id uuid, full_name text, email text, avatar_url text, university_name text, created_at timestamptz, last_seen_at timestamptz, suspended boolean, staff_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filter text := coalesce(p_filter, 'all');
begin
  perform public.staff_require('moderator');
  if v_filter not in ('all', 'suspended', 'staff') then
    raise exception 'Invalid filter';
  end if;
  return query
    select p.id, p.full_name, lower(u.email::text), p.avatar_url, un.name, p.created_at, p.last_seen_at, public.is_suspended(p.id), s.role
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.universities un on un.id = p.university_id
    left join public.staff s on s.user_id = p.id
    where (p_before is null or p.created_at < p_before)
      and (v_filter <> 'suspended' or public.is_suspended(p.id))
      and (v_filter <> 'staff' or s.user_id is not null)
    order by p.created_at desc, p.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.admin_users_list(text, int, timestamptz) from public, anon;
grant execute on function public.admin_users_list(text, int, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Hidden content, newest hide first. p_type narrows to one kind; p_before = the
-- oldest hidden_at you have. Buzz rows: no author, published time only.
-- -----------------------------------------------------------------------------
create or replace function public.admin_hidden_content_list(p_type text default null, p_limit int default 50, p_before timestamptz default null)
returns table (target_type text, target_id uuid, hidden_at timestamptz, hidden_reason text, title text, preview text, author_id uuid, author_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('moderator');
  if p_type is not null and public.admin_content_table(p_type) is null then
    raise exception 'Invalid content type';
  end if;
  return query
    select h.target_type, h.target_id, h.hidden_at, h.hidden_reason, h.title, h.preview, h.author_id, h.author_name, h.created_at
    from (
      select 'apartment'::text as target_type, a.id as target_id, a.hidden_at, a.hidden_reason, a.title::text as title, left(a.description, 140)::text as preview, a.owner_id as author_id, p.full_name::text as author_name, a.created_at
      from public.apartments a left join public.profiles p on p.id = a.owner_id where a.hidden_at is not null
      union all
      select 'item', i.id, i.hidden_at, i.hidden_reason, i.title, left(i.description, 140), i.seller_id, p.full_name, i.created_at
      from public.items i left join public.profiles p on p.id = i.seller_id where i.hidden_at is not null
      union all
      select 'roommate', r.id, r.hidden_at, r.hidden_reason, r.title, left(r.description, 140), r.author_id, p.full_name, r.created_at
      from public.roommate_posts r left join public.profiles p on p.id = r.author_id where r.hidden_at is not null
      union all
      select 'post', f.id, f.hidden_at, f.hidden_reason, null, left(f.body, 140), f.author_id, p.full_name, f.created_at
      from public.feed_posts f left join public.profiles p on p.id = f.author_id where f.hidden_at is not null
      union all
      select 'comment', c.id, c.hidden_at, c.hidden_reason, null, left(c.body, 140), c.user_id, p.full_name, c.created_at
      from public.post_comments c left join public.profiles p on p.id = c.user_id where c.hidden_at is not null
      union all
      select 'message', m.id, m.hidden_at, m.hidden_reason, null, left(m.content, 140), m.sender_id, p.full_name, m.created_at
      from public.messages m left join public.profiles p on p.id = m.sender_id where m.hidden_at is not null
      union all
      select 'buzz', b.id, b.hidden_at, b.hidden_reason, b.title, left(b.body, 140), null::uuid, null::text, b.visible_at
      from public.buzz_posts b where b.hidden_at is not null
      union all
      select 'buzz_comment', bc.id, bc.hidden_at, bc.hidden_reason, null, left(bc.body, 140), null::uuid, null::text, bc.visible_at
      from public.buzz_comments bc where bc.hidden_at is not null
    ) h
    where (p_type is null or h.target_type = p_type)
      and (p_before is null or h.hidden_at < p_before)
    order by h.hidden_at desc, h.target_id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.admin_hidden_content_list(text, int, timestamptz) from public, anon;
grant execute on function public.admin_hidden_content_list(text, int, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- One report, for the review page. Same columns and the same Buzz rule as
-- admin_reports_list (target_author_id is null for Buzz targets).
-- -----------------------------------------------------------------------------
create or replace function public.admin_report_get(p_id uuid)
returns table (
  id uuid, reporter_id uuid, reporter_name text, reporter_email text, target_type text, target_id uuid, reason text, details text,
  status text, decision text, notes text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, created_at timestamptz,
  target_preview text, target_hidden boolean, target_exists boolean, target_author_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.staff_require('moderator');
  return query
    select r.id, r.reporter_id, rp.full_name, lower(ru.email::text), r.target_type, r.target_id, r.reason, r.details,
      r.status, r.decision, r.notes, r.reviewed_by, vp.full_name, r.reviewed_at, r.created_at,
      case when r.target_type = 'profile' then coalesce(left(tp.full_name, 140), '')
           else coalesce(left(coalesce(nullif(s.snap ->> 'title', ''), s.snap ->> 'body'), 140), '') end,
      case when r.target_type = 'profile' then tp.id is not null and public.is_suspended(tp.id)
           else s.snap ->> 'hidden_at' is not null end,
      case when r.target_type = 'profile' then tp.id is not null else s.snap is not null end,
      case when r.target_type = 'profile' then tp.id
           when r.target_type in ('buzz', 'buzz_comment') then null
           else (s.snap ->> 'author_id')::uuid end
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join auth.users ru on ru.id = r.reporter_id
    left join public.profiles vp on vp.id = r.reviewed_by
    left join public.profiles tp on r.target_type = 'profile' and tp.id = r.target_id
    left join lateral (select case when r.target_type <> 'profile' then public.admin_content_snapshot(r.target_type, r.target_id) end as snap) s on true
    where r.id = p_id;
  if not found then
    raise exception 'Report not found';
  end if;
end;
$$;
revoke all on function public.admin_report_get(uuid) from public, anon;
grant execute on function public.admin_report_get(uuid) to authenticated;
