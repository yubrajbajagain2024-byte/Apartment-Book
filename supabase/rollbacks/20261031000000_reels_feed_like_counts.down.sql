-- Undoes migration 38 (20261031000000_reels_feed_like_counts.sql) on the live project. Run it as ONE transaction.
--
-- reels_feed() goes back exactly as it was live before 38 (read from the live database on 2026-10-25, before 38 was
-- applied): the moderation migration’s version, with its plain count over post_likes. Its grants stay as they are
-- (create or replace keeps them). Then 38’s row leaves the migration tracker, so npm run db:setup would apply 38 again.
-- Only for a database that has the moderation schema (the live project); one built from this repo alone has nothing
-- of 38 to undo.
CREATE OR REPLACE FUNCTION public.reels_feed(p_university_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS TABLE(source_type text, source_id uuid, author_id uuid, author_name text, author_avatar_url text, author_verified boolean, title text, caption text, video jsonb, created_at timestamp with time zone, likes bigint, comments bigint, liked_by_me boolean, saved_by_me boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with src as (
    select 'post'::text as source_type, p.id as source_id, p.author_id, p.university_id, null::text as title, p.body as caption, p.videos -> 0 as video, p.created_at
      from public.feed_posts p where p.kind = 'reel' and p.has_video and p.hidden_at is null and not public.is_suspended(p.author_id)
    union all
    select 'apartment', a.id, a.owner_id, a.university_id, a.title, a.description, a.videos -> 0, a.created_at
      from public.apartments a where a.has_video and a.status = 'active' and a.hidden_at is null and not public.is_suspended(a.owner_id)
    union all
    select 'roommate', r.id, r.author_id, r.university_id, r.title, r.description, r.videos -> 0, r.created_at
      from public.roommate_posts r where r.has_video and r.is_active and r.hidden_at is null and not public.is_suspended(r.author_id)
  )
  select
    s.source_type, s.source_id, s.author_id, pr.full_name, pr.avatar_url,
    coalesce(u.email_domain is not null, false),
    s.title, s.caption, s.video, s.created_at,
    (select count(*) from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id),
    (select count(*) from public.post_comments c where c.target_type = s.source_type and c.target_id = s.source_id),
    exists (select 1 from public.post_likes l where l.target_type = s.source_type and l.target_id = s.source_id and l.user_id = auth.uid()),
    exists (select 1 from public.saved_listings sv where sv.target_type = s.source_type and sv.target_id = s.source_id and sv.user_id = auth.uid())
  from src s
  join public.profiles pr on pr.id = s.author_id
  left join public.universities u on u.id = pr.university_id
  where (p_university_id is null or s.university_id = p_university_id)
    and jsonb_typeof(s.video) = 'object'
  order by s.created_at desc, s.source_id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

do $rollback_38$
begin
  if to_regclass('public._migrations') is not null then
    delete from public._migrations where name = '20261031000000_reels_feed_like_counts.sql';
  end if;
end
$rollback_38$;
