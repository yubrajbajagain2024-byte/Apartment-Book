-- =============================================================================
-- Rollback of migration 39 (the business portal), generated from the production backup taken just before it
-- (~/CampConnect-backups/2026-10-25-before-migrations-38-40). Run as one transaction, after migration 40's rollback.
-- It removes everything 39 added and puts the seven functions it replaced back exactly as production ran them.
-- Refuses to run while business accounts exist: without 39 they would become ordinary accounts on the student side.
-- Chats started as inquiries stay, as ordinary chats named after their business.
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'role')
     and exists (select 1 from public.profiles where role in ('business_owner', 'business_staff')) then
    raise exception 'Business accounts exist. Delete or deal with them before rolling back migration 39.';
  end if;
end $$;

-- Triggers 39 put on existing tables
drop trigger if exists profiles_keep_role on public.profiles;
drop trigger if exists profiles_quiet_business on public.profiles;
drop trigger if exists messages_business_rules on public.messages;
drop trigger if exists business_invite_claim_on_confirm on auth.users;
do $$
declare
  t text;
begin
  if to_regclass('public.calls') is not null then
    drop trigger if exists calls_no_business on public.calls;
  end if;
  foreach t in array array['feed_posts', 'post_comments', 'post_likes', 'post_comment_votes', 'buzz_posts', 'buzz_comments', 'buzz_votes', 'buzz_comment_votes', 'roommate_posts', 'items', 'follows', 'profile_classes', 'saved_listings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_block_business', t);
    end if;
  end loop;
  foreach t in array array['feed_posts', 'post_comments', 'post_likes', 'post_comment_votes', 'roommate_posts', 'items', 'follows', 'profile_classes', 'saved_listings', 'course_groups'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_no_business_session', t);
    end if;
  end loop;
end $$;

-- Policies 39 added to existing tables
drop policy if exists "apartments_insert_team" on public.apartments;
drop policy if exists "apartments_update_team" on public.apartments;
drop policy if exists "apartments_delete_team" on public.apartments;
drop policy if exists "apartments_business_rules_insert" on public.apartments;
drop policy if exists "apartments_business_rules_update" on public.apartments;
drop policy if exists "apartments_business_rules_delete" on public.apartments;
drop policy if exists "apartments_business_standing" on public.apartments;
drop policy if exists "apartments_business_session" on public.apartments;
drop policy if exists "conversations_business_scope" on public.conversations;
drop policy if exists "conversation_members_business_scope" on public.conversation_members;
drop policy if exists "messages_business_scope" on public.messages;
drop policy if exists "messages_business_write" on public.messages;
drop policy if exists "profiles_business_scope" on public.profiles;
drop policy if exists "objects_business_uploads_insert" on storage.objects;
drop policy if exists "objects_business_uploads_update" on storage.objects;

-- The seven functions 39 replaced, exactly as production ran them before it, with their grants
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, avatar_url, university_id)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    public.university_for_email(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public;
grant execute on function public.handle_new_user() to anon;
grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.handle_new_user() to service_role;

CREATE OR REPLACE FUNCTION public.enforce_university_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.university_for_email(new.email) is null
     and not exists (select 1 from public.staff_invites i where i.email = lower(btrim(coalesce(new.email::text, '')))) then
    raise exception 'Please sign up with your university email address (for example you@txstate.edu).'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
revoke all on function public.enforce_university_email() from public, anon, authenticated, service_role;
grant execute on function public.enforce_university_email() to service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_other_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_or_create_direct_conversation(uuid) to public;
grant execute on function public.get_or_create_direct_conversation(uuid) to anon;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_name text, p_member_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', trim(p_name), v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  select v_id, u.id
  from (
    select distinct unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), v_me)) as id
  ) u
  join public.profiles p on p.id = u.id;

  return v_id;
end;
$function$;
revoke all on function public.create_group_conversation(text,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.create_group_conversation(text,uuid[]) to public;
grant execute on function public.create_group_conversation(text,uuid[]) to anon;
grant execute on function public.create_group_conversation(text,uuid[]) to authenticated;
grant execute on function public.create_group_conversation(text,uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_conversation_member(p_conversation_id, v_me) then
    raise exception 'Not a member of this conversation';
  end if;
  if (select type from public.conversations where id = p_conversation_id) <> 'group' then
    raise exception 'Can only add members to group conversations';
  end if;
  if public.is_course_chat(p_conversation_id) then
    raise exception 'Course chats fill themselves: classmates join by adding the class to their profile.';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation_id, p.id
  from public.profiles p
  where p.id = any (coalesce(p_member_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$function$;
revoke all on function public.add_group_members(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.add_group_members(uuid,uuid[]) to public;
grant execute on function public.add_group_members(uuid,uuid[]) to anon;
grant execute on function public.add_group_members(uuid,uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid,uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.listing_owner(p_target_type text, p_target_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_target_type
    when 'apartment' then (select owner_id from public.apartments where id = p_target_id)
    when 'item' then (select seller_id from public.items where id = p_target_id)
    when 'roommate' then (select author_id from public.roommate_posts where id = p_target_id)
    when 'post' then (select author_id from public.feed_posts where id = p_target_id)
  end;
$function$;
revoke all on function public.listing_owner(text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.listing_owner(text,uuid) to public;
grant execute on function public.listing_owner(text,uuid) to anon;
grant execute on function public.listing_owner(text,uuid) to authenticated;
grant execute on function public.listing_owner(text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.record_view(p_target_type text, p_target_id uuid, p_viewer_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
  v_owner uuid;
begin
  if p_target_type not in ('apartment', 'item', 'roommate', 'post') or p_target_id is null then
    return;
  end if;
  v_owner := public.listing_owner(p_target_type, p_target_id);
  if v_owner is null or (auth.uid() is not null and v_owner = auth.uid()) then
    return;
  end if;
  v_key := coalesce(auth.uid()::text, nullif(left(p_viewer_key, 64), ''));
  if v_key is null then
    return;
  end if;
  insert into public.post_views (target_type, target_id, viewer_id, viewer_key)
  values (p_target_type, p_target_id, auth.uid(), v_key)
  on conflict do nothing;
end;
$function$;
revoke all on function public.record_view(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.record_view(text,uuid,text) to public;
grant execute on function public.record_view(text,uuid,text) to anon;
grant execute on function public.record_view(text,uuid,text) to authenticated;
grant execute on function public.record_view(text,uuid,text) to service_role;

-- Tables and columns 39 added (the foreign keys from apartments and conversations go with the tables)
drop table if exists public.listing_promotions, public.deals, public.business_invites, public.business_members, public.businesses cascade;
alter table public.conversations drop column if exists business_id, drop column if exists inquiry_target_type, drop column if exists inquiry_target_id;
alter table public.apartments drop column if exists business_id;
delete from public.post_views where target_type = 'deal';
alter table public.post_views drop constraint if exists post_views_target_type_check;
alter table public.post_views add constraint post_views_target_type_check check (target_type in ('apartment', 'item', 'roommate', 'post'));

-- Functions only 39 made
drop function if exists public.role_of(uuid);
drop function if exists public.my_role();
drop function if exists public.is_business_account(uuid);
drop function if exists public.student_side_ok();
drop function if exists public.is_admin();
drop function if exists public.require_admin();
drop function if exists public.keep_role();
drop function if exists public.grant_role(uuid, text);
drop function if exists public.account_confirmed(uuid);
drop function if exists public.business_of(uuid);
drop function if exists public.business_status(uuid);
drop function if exists public.business_owner_id(uuid);
drop function if exists public.is_business_member(uuid);
drop function if exists public.is_business_owner_of(uuid);
drop function if exists public.business_approved(uuid);
drop function if exists public.team_can_manage(uuid);
drop function if exists public.team_can_operate(uuid);
drop function if exists public.owner_can_edit(uuid);
drop function if exists public.businesses_keep_review();
drop function if exists public.my_business();
drop function if exists public.business_claim_invite(uuid, text, jsonb, timestamptz);
drop function if exists public.business_invite_claim_on_confirm();
drop function if exists public.business_invite_lookup(text);
drop function if exists public.business_invite_create(text);
drop function if exists public.business_invite_revoke(uuid);
drop function if exists public.business_member_remove(uuid);
drop function if exists public.listing_write_allowed(uuid, uuid);
drop function if exists public.listing_row_editable(uuid);
drop function if exists public.listing_sponsored(public.apartments);
drop function if exists public.deal_sponsored(public.deals);
drop function if exists public.start_business_inquiry(text, uuid);
drop function if exists public.business_members_sync_conversations();
drop function if exists public.business_chat_readable(uuid);
drop function if exists public.chat_write_problem(uuid);
drop function if exists public.chat_write_ok(uuid);
drop function if exists public.messages_business_rules();
drop function if exists public.no_calls_with_businesses();
drop function if exists public.block_business_social_writes();
drop function if exists public.business_can_see_profile(uuid);
drop function if exists public.business_uploads_ok();
drop function if exists public.business_accounts_stay_quiet();
drop function if exists public.business_listing_stats(uuid);
drop function if exists public.business_deal_stats(uuid);
drop function if exists public.business_overview(uuid);
drop function if exists public.admin_list_businesses(text);
drop function if exists public.admin_review_business(uuid, text, text);
drop function if exists public.admin_set_verified(uuid, boolean, text);
drop function if exists public.admin_business_targets(uuid);
drop function if exists public.admin_record_promotion(text, uuid, timestamptz, timestamptz, integer, text, text);
drop function if exists public.admin_cancel_promotion(uuid);
drop function if exists public.admin_list_promotions(uuid);

alter table public.profiles drop constraint if exists profiles_role_check;
drop index if exists public.profiles_role_idx;
alter table public.profiles drop column if exists role;

delete from public._migrations where name = '20261101000000_business_portal.sql';
notify pgrst, 'reload schema';
