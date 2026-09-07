-- =============================================================================
-- Apartment Book - initial database schema
-- Run this whole file in the Supabase SQL editor (or `supabase db push`).
-- It creates: enums, tables, indexes, triggers, RPC functions, row level
-- security policies, the image storage bucket and realtime for chat.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.listing_status as enum ('active', 'rented', 'archived');
create type public.item_condition as enum ('new', 'like_new', 'good', 'fair', 'poor');
create type public.item_status as enum ('available', 'sold', 'archived');
create type public.roommate_post_type as enum ('has_room', 'needs_room');
create type public.conversation_type as enum ('direct', 'group');
create type public.gender_pref as enum ('any', 'male', 'female', 'nonbinary');

-- -----------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Universities
-- -----------------------------------------------------------------------------
create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country text,
  created_at timestamptz not null default now(),
  constraint universities_name_key unique (name)
);

-- -----------------------------------------------------------------------------
-- Profiles (one row per auth user, created automatically by trigger)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  university_id uuid,
  program text,
  graduation_year integer,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_university_id_fkey foreign key (university_id)
    references public.universities (id) on delete set null
);

create index profiles_university_id_idx on public.profiles (university_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Apartments (home feed)
-- -----------------------------------------------------------------------------
create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  university_id uuid,
  title text not null,
  description text not null default '',
  price_per_month numeric(10, 2) not null check (price_per_month >= 0),
  currency text not null default 'USD',
  address text not null,
  city text,
  distance_km numeric(6, 2) check (distance_km is null or distance_km >= 0),
  bedrooms integer not null default 1 check (bedrooms >= 0),
  bathrooms numeric(3, 1) not null default 1 check (bathrooms >= 0),
  furnished boolean not null default false,
  utilities_included boolean not null default false,
  pets_allowed boolean not null default false,
  available_from date,
  lease_months integer check (lease_months is null or lease_months > 0),
  amenities text[] not null default '{}',
  images text[] not null default '{}',
  map_url text,
  contact_phone text,
  status public.listing_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apartments_owner_id_fkey foreign key (owner_id)
    references public.profiles (id) on delete cascade,
  constraint apartments_university_id_fkey foreign key (university_id)
    references public.universities (id) on delete set null
);

create index apartments_feed_idx on public.apartments (status, created_at desc);
create index apartments_university_id_idx on public.apartments (university_id);
create index apartments_owner_id_idx on public.apartments (owner_id);
create index apartments_price_idx on public.apartments (price_per_month);

create trigger apartments_set_updated_at
  before update on public.apartments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Roommate posts
-- -----------------------------------------------------------------------------
create table public.roommate_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  university_id uuid,
  post_type public.roommate_post_type not null,
  title text not null,
  description text not null default '',
  budget_min numeric(10, 2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(10, 2) check (budget_max is null or budget_max >= 0),
  currency text not null default 'USD',
  move_in_date date,
  location text,
  gender_preference public.gender_pref not null default 'any',
  smoking_ok boolean not null default false,
  pets_ok boolean not null default false,
  sleep_schedule text,
  cleanliness text,
  images text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roommate_posts_author_id_fkey foreign key (author_id)
    references public.profiles (id) on delete cascade,
  constraint roommate_posts_university_id_fkey foreign key (university_id)
    references public.universities (id) on delete set null
);

create index roommate_posts_feed_idx on public.roommate_posts (is_active, created_at desc);
create index roommate_posts_university_id_idx on public.roommate_posts (university_id);
create index roommate_posts_author_id_idx on public.roommate_posts (author_id);

create trigger roommate_posts_set_updated_at
  before update on public.roommate_posts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Marketplace items
-- -----------------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  university_id uuid,
  title text not null,
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  currency text not null default 'USD',
  category text not null,
  condition public.item_condition not null default 'good',
  images text[] not null default '{}',
  pickup_location text,
  status public.item_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_seller_id_fkey foreign key (seller_id)
    references public.profiles (id) on delete cascade,
  constraint items_university_id_fkey foreign key (university_id)
    references public.universities (id) on delete set null
);

create index items_feed_idx on public.items (status, created_at desc);
create index items_category_idx on public.items (category);
create index items_university_id_idx on public.items (university_id);
create index items_seller_id_idx on public.items (seller_id);

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Saved listings (bookmarks)
-- -----------------------------------------------------------------------------
create table public.saved_listings (
  user_id uuid not null,
  target_type text not null check (target_type in ('apartment', 'item', 'roommate')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id),
  constraint saved_listings_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Messaging
-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null default 'direct',
  name text,
  direct_key text,
  created_by uuid,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  constraint conversations_created_by_fkey foreign key (created_by)
    references public.profiles (id) on delete set null,
  constraint conversations_direct_key_key unique (direct_key)
);

create table public.conversation_members (
  conversation_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_members_conversation_id_fkey foreign key (conversation_id)
    references public.conversations (id) on delete cascade,
  constraint conversation_members_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete cascade
);

create index conversation_members_user_id_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_id uuid,
  content text not null check (char_length(content) between 1 and 4000),
  image_url text,
  created_at timestamptz not null default now(),
  constraint messages_conversation_id_fkey foreign key (conversation_id)
    references public.conversations (id) on delete cascade,
  constraint messages_sender_id_fkey foreign key (sender_id)
    references public.profiles (id) on delete set null
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- Is the given user a member of the conversation? (security definer so RLS
-- policies can call it without recursing into conversation_members policies)
create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
  );
$$;

-- After a message is inserted, update the conversation summary.
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_preview = left(new.content, 120)
  where id = new.conversation_id;

  -- The sender has obviously read their own message.
  update public.conversation_members
  set last_read_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;

  return new;
end;
$$;

create trigger on_message_created
  after insert on public.messages
  for each row execute function public.handle_new_message();

-- Find the 1:1 conversation with another user, creating it if needed.
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  v_key := least(v_me, p_other_user_id)::text || ':' || greatest(v_me, p_other_user_id)::text;

  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;

  begin
    insert into public.conversations (type, direct_key, created_by)
    values ('direct', v_key, v_me)
    returning id into v_id;

    insert into public.conversation_members (conversation_id, user_id)
    values (v_id, v_me), (v_id, p_other_user_id);
  exception when unique_violation then
    select id into v_id from public.conversations where direct_key = v_key;
  end;

  return v_id;
end;
$$;

-- Create a group conversation with the given members (creator is added too).
create or replace function public.create_group_conversation(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Add members to a group you belong to.
create or replace function public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation_id, p.id
  from public.profiles p
  where p.id = any (coalesce(p_member_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

-- Unread message count per conversation for the current user.
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id
   and cm.user_id = auth.uid()
  where m.created_at > cm.last_read_at
    and (m.sender_id is null or m.sender_id <> auth.uid())
  group by m.conversation_id;
$$;

-- Total unread messages for the navbar badge.
create or replace function public.get_total_unread()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(unread_count), 0)::bigint from public.get_unread_counts();
$$;

-- Mark a conversation as read by the current user.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.universities enable row level security;
alter table public.profiles enable row level security;
alter table public.apartments enable row level security;
alter table public.roommate_posts enable row level security;
alter table public.items enable row level security;
alter table public.saved_listings enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Universities: anyone can read, signed-in users can add missing ones.
create policy "universities_select" on public.universities
  for select using (true);
create policy "universities_insert" on public.universities
  for insert to authenticated with check (true);

-- Profiles: public to read (name, avatar, university), only you can edit yours.
create policy "profiles_select" on public.profiles
  for select using (true);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Apartments: active listings are public, owners see and manage their own.
create policy "apartments_select" on public.apartments
  for select using (status = 'active' or owner_id = auth.uid());
create policy "apartments_insert_own" on public.apartments
  for insert to authenticated with check (owner_id = auth.uid());
create policy "apartments_update_own" on public.apartments
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "apartments_delete_own" on public.apartments
  for delete to authenticated using (owner_id = auth.uid());

-- Roommate posts
create policy "roommate_posts_select" on public.roommate_posts
  for select using (is_active or author_id = auth.uid());
create policy "roommate_posts_insert_own" on public.roommate_posts
  for insert to authenticated with check (author_id = auth.uid());
create policy "roommate_posts_update_own" on public.roommate_posts
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "roommate_posts_delete_own" on public.roommate_posts
  for delete to authenticated using (author_id = auth.uid());

-- Marketplace items
create policy "items_select" on public.items
  for select using (status <> 'archived' or seller_id = auth.uid());
create policy "items_insert_own" on public.items
  for insert to authenticated with check (seller_id = auth.uid());
create policy "items_update_own" on public.items
  for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy "items_delete_own" on public.items
  for delete to authenticated using (seller_id = auth.uid());

-- Saved listings: private to each user
create policy "saved_listings_all_own" on public.saved_listings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Conversations: only members can see them; groups can be renamed by members.
create policy "conversations_select_member" on public.conversations
  for select to authenticated using (public.is_conversation_member(id, auth.uid()));
create policy "conversations_update_member" on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

-- Conversation members: members can see the member list, manage own row.
create policy "conversation_members_select_member" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
create policy "conversation_members_update_own" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "conversation_members_delete_own" on public.conversation_members
  for delete to authenticated using (user_id = auth.uid());

-- Messages: members can read and send, senders can delete their own.
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));
create policy "messages_delete_own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Storage: one public bucket for all images. Files live at
--   {kind}/{user_id}/{file}  e.g. apartments/2f3a.../photo.jpg
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "uploads_public_read" on storage.objects
  for select using (bucket_id = 'uploads');

create policy "uploads_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "uploads_update_own_folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "uploads_delete_own_folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- Realtime: stream new messages and conversation updates to the chat UI
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
