-- =============================================================================
-- Rollback of 20261105000000_anonymous_listings.sql (anonymous listings, listing audiences, anonymous inquiry chats).
-- Run as one transaction. Removes the columns, the two private tables, every policy, trigger and function the
-- migration added, puts back the conversations.inquiry_target_type rule of migration 39 and the NOT NULL on
-- roommate_posts.author_id and items.seller_id, and restores the twelve functions it replaced exactly as they were
-- before it ran (from the copies it kept in anonymous_listings_rollback).
-- Refuses while any listing is anonymous or has an audience other than Global, or any anonymous inquiry chat exists:
-- without the migration an anonymous listing has no poster, a campus or friends listing would become public, and an
-- anonymous chat would show the poster to the person they wrote to. Remove those on purpose first.
-- =============================================================================
do $$
declare
  v_found boolean;
begin
  if to_regclass('public.anonymous_listings_rollback') is null then
    raise exception 'anonymous_listings_rollback is missing: this database did not run 20261105000000_anonymous_listings.sql';
  end if;
  select exists (select 1 from public.roommate_posts where is_anonymous or audience <> 'global')
      or exists (select 1 from public.items where is_anonymous or audience <> 'global')
    into v_found;
  if v_found then
    raise exception 'anonymous listings or listings with an audience exist: remove them before rolling back the anonymous listings migration';
  end if;
  select exists (select 1 from public.anonymous_chat_posters)
      or exists (select 1 from public.conversations where poster_hidden or inquiry_target_type in ('roommate', 'item'))
      or exists (select 1 from public.messages where anonymous)
    into v_found;
  if v_found then
    raise exception 'anonymous inquiry chats exist: remove them before rolling back the anonymous listings migration';
  end if;
end $$;

-- Policies
drop policy if exists "roommate_posts_audience" on public.roommate_posts;
drop policy if exists "items_audience" on public.items;
drop policy if exists "roommate_posts_anonymous" on public.roommate_posts;
drop policy if exists "items_anonymous" on public.items;
drop policy if exists "roommate_posts_select_anonymous_own" on public.roommate_posts;
drop policy if exists "items_select_anonymous_own" on public.items;
drop policy if exists "roommate_posts_insert_anonymous" on public.roommate_posts;
drop policy if exists "items_insert_anonymous" on public.items;
drop policy if exists "roommate_posts_update_anonymous_own" on public.roommate_posts;
drop policy if exists "items_update_anonymous_own" on public.items;
drop policy if exists "roommate_posts_delete_anonymous_own" on public.roommate_posts;
drop policy if exists "items_delete_anonymous_own" on public.items;
drop policy if exists "conversation_members_hide_anonymous_poster" on public.conversation_members;
drop policy if exists "conversation_members_anonymous_poster_stays" on public.conversation_members;
drop policy if exists "messages_insert_anonymous_poster" on public.messages;
drop policy if exists "messages_anonymous_poster_block" on public.messages;

-- Triggers and their functions
drop trigger if exists listings_check_campus on public.roommate_posts;
drop trigger if exists listings_check_campus on public.items;
drop function if exists public.listings_check_campus();
drop trigger if exists zz_listings_hide_poster on public.roommate_posts;
drop trigger if exists zz_listings_hide_poster on public.items;
drop function if exists public.listings_hide_poster();
drop trigger if exists post_likes_not_own_anonymous on public.post_likes;
drop trigger if exists saved_listings_not_own_anonymous on public.saved_listings;
drop function if exists public.engagement_not_own_anonymous();
drop trigger if exists messages_anonymous_chat_rules on public.messages;
drop function if exists public.messages_anonymous_chat_rules();
drop trigger if exists zz_messages_hide_anonymous_poster on public.messages;
drop function if exists public.messages_hide_anonymous_poster();
do $$
begin
  if to_regclass('public.calls') is not null then
    drop trigger if exists calls_no_hidden_poster on public.calls;
  end if;
end $$;
drop function if exists public.no_calls_with_hidden_posters();
drop trigger if exists anonymous_listing_owner_gone on public.anonymous_listing_owners;
drop function if exists public.anonymous_listing_owner_gone();

-- The replaced functions, as they were (create or replace keeps their grants)
do $$
declare
  r record;
begin
  for r in select definition from public.anonymous_listings_rollback loop
    execute r.definition;
  end loop;
end $$;
drop table public.anonymous_listings_rollback;

-- The new functions
drop function if exists public.start_listing_inquiry(text, uuid);
drop function if exists public.reveal_listing_identity(uuid);
drop function if exists public.shared_post_is_public(jsonb);
drop function if exists public.blocked_by_anonymous_poster(uuid);
drop function if exists public.am_anonymous_poster(uuid);
drop function if exists public.chat_hides_poster(uuid);
drop function if exists public.anonymous_chat_poster(uuid);
drop function if exists public.anonymous_listing_visible(text, uuid);
drop function if exists public.can_see_listing(text, uuid, uuid, text, uuid);
drop function if exists public.can_see_listing_as(uuid, text, uuid, uuid, text, uuid);
drop function if exists public.listing_poster(text, uuid);
drop function if exists public.owns_anonymous_listing(text, uuid);
drop function if exists public.anonymous_listing_owner(text, uuid);

-- Tables and columns
drop table if exists public.anonymous_chat_posters;
drop table if exists public.anonymous_listing_owners;
alter table public.conversations drop constraint if exists conversations_inquiry_target_type_check;
alter table public.conversations add constraint conversations_inquiry_target_type_check
  check (inquiry_target_type is null or inquiry_target_type in ('apartment', 'deal'));
alter table public.conversations drop column if exists poster_hidden, drop column if exists poster_revealed_at;
alter table public.messages drop column if exists anonymous;
alter table public.roommate_posts drop constraint if exists roommate_posts_poster_check;
alter table public.roommate_posts drop constraint if exists roommate_posts_audience_check;
alter table public.items drop constraint if exists items_poster_check;
alter table public.items drop constraint if exists items_audience_check;
alter table public.roommate_posts drop column if exists is_anonymous, drop column if exists audience;
alter table public.items drop column if exists is_anonymous, drop column if exists audience;
alter table public.roommate_posts alter column author_id set not null;
alter table public.items alter column seller_id set not null;
