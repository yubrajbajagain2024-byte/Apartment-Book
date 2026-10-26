-- =============================================================================
-- Migration 41: Trust & Safety, ported from UniVerse (server/src/lib/{reports,sanctions,audit}.ts,
-- lib/moderation/{staff,queue}.ts, services/admin/**, routes/admin/**). Safe to re-run.
--
--   * Moderation storage: mod_queue (one open item per piece of content), moderation_events (what the engine said
--     about a write), moderation_actions, strikes, user_sanctions (warnings, mutes, suspensions, bans and the
--     "content removed" notices), appeals, audit_log (append-only: triggers refuse every update and delete),
--     banned_emails (a banned address cannot sign up again), moderation_rule_state (which engine rule packs run) and
--     staff_members (who is a moderator or an admin). Every one of these has row-level security on and NO grants to
--     the API: they are read and written only by the functions below.
--   * Who is staff: where CampConnect Admin's staff list exists (public.staff, applied to production outside this repo
--     on 2026-10-25; see supabase/applied-outside-repo), it is the only list. Its owners and admins are admins here,
--     its moderators moderators, a suspended staff member is nobody, and staff are added and removed in CampConnect
--     Admin. Without it (a database built from this repo alone), staff_members is the list: staff are added by hand
--     in the SQL editor, then an admin grants and revokes roles from the website's staff console, audited:
--         insert into public.staff_members (user_id, role) values ('<profile id>', 'admin')
--           on conflict (user_id) do update set role = excluded.role;
--   * Every console_* function also needs a session that passed two-factor sign-in (aal2) on an account that still
--     has a verified factor, CampConnect Admin's rule. Without one, staff get 'mfa_required'; everyone else 'not_found'.
--   * reports (migration 10) grows UniVerse's columns (eligible, weight, queue_id, sub_reason, closed_at, bad_faith,
--     university_id), UniVerse's reasons and the Buzz target types; one report per person and thing. The API may still
--     insert public reports (old builds do), but every value the server owns is set by a trigger, which also files the
--     queue item and runs auto-hide. Buzz reports go through buzz_v2_report (migration 42) -> ts_file_report().
--   * The anonymity firewall for staff (UniVerse SPEC 4.2.14): no staff payload names the author of a buzz, for any
--     role. Moderators act on "the author of this item" and the server resolves the account; they see a bucketed,
--     blind standing only. A sanction, strike, queue item or audit row about Buzz content is "anon-origin": it targets
--     the content, never the user, and is left out of everything a moderator sees about a named account (so acting on
--     a buzz moves no number on anyone's user page). Admins see anon-origin sanctions on a user page only with
--     day-floored times and a sealed id. The one way from a buzz to its author is console_unmask(): admins only, a reason
--     code and a written reason of 30+ characters, the typed word UNMASK, at most 10 a day, the audit row written
--     BEFORE the author is looked up, and every other admin told.
--   * Posting status: ts_posting_status() is what every write checks (mutes in scope, suspensions, bans, warnings not
--     yet acknowledged). Buzz writes check it in migration 42; this file adds a trigger that holds public posts,
--     comments, listings and roommate posts to it too, and keeps suspended or banned accounts out of messages.
--   * Notifications of two new types: 'moderation' (to the person concerned: their content hidden, removed or back,
--     a sanction, an appeal received or decided, their report resolved) and 'staff' (to staff: an unmask, an appeal to
--     review). Never with an actor; data.event says which. The type check is rebuilt as a union of what it allowed, what
--     the table holds and this list (with Buzz's three), so re-running this file after migration 42 never breaks.
--   * Rule packs: moderation_rule_state rows are seeded for the engine's 12 packs; a pack with no row counts as on.
--   * The Buzz content itself is reached only through migration 42's adapters (buzz_v2_snapshot, buzz_v2_author_of,
--     buzz_v2_set_status, buzz_v2_set_locked, buzz_v2_staff_context). plpgsql resolves them when it runs, so this file
--     can come first. Public content (posts, comments, listings, roommate posts, profiles, messages) has its own small
--     adapters here: a snapshot of its text and remove (delete the row; a profile loses its bio and photo).
--
-- Errors: 'ts:<code>:<message>' (codes: not_found, forbidden, validation_failed, conflict, rate_limited,
-- unauthenticated, append_only, mfa_required, not_supported). Errors about Buzz content raised on Buzz's behalf use 'buzz:<code>:<message>'.
-- Times in JSON are epoch milliseconds; JSON keys are camelCase.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Small helpers
-- -----------------------------------------------------------------------------
create or replace function public.ts_ms(p timestamptz)
returns bigint
language sql
stable
as $$
  select floor(extract(epoch from p) * 1000)::bigint;
$$;

-- UTC day start, in ms (anon-origin rows are shown to admins at day precision only).
create or replace function public.ts_day_ms(p timestamptz)
returns bigint
language sql
stable
as $$
  select (floor(extract(epoch from p) / 86400) * 86400000)::bigint;
$$;

create or replace function public.ts_minute_ms(p timestamptz)
returns bigint
language sql
stable
as $$
  select (floor(extract(epoch from p) / 60) * 60000)::bigint;
$$;

-- ms -> timestamptz (null stays null).
create or replace function public.ts_from_ms(p bigint)
returns timestamptz
language sql
immutable
as $$
  select case when p is null then null else to_timestamp(p / 1000.0) end;
$$;

create or replace function public.ts_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return nullif(btrim(p), '')::uuid;
exception when others then
  return null;
end;
$$;

-- Buzz content is anonymous ('buzz_comment' is the pre-v2 name of a reply, kept until migration 42 renames it).
create or replace function public.ts_is_anon(p_type text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_type in ('buzz', 'buzz_reply', 'buzz_comment'), false);
$$;

create or replace function public.ts_is_category(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(p in (
    'threat_violence', 'harassment_bullying', 'hate', 'sexual_minors', 'sexual_explicit', 'drugs_illegal_sales', 'self_harm',
    'pii_doxxing', 'named_accusation', 'impersonation', 'spam_scam', 'academic_dishonesty', 'profanity'
  ), false);
$$;

-- packages/shared/src/buzz/constants.ts MODERATION_CATEGORY_LABELS.
create or replace function public.ts_category_label(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'threat_violence' then 'Threats & violence'
    when 'harassment_bullying' then 'Harassment & bullying'
    when 'hate' then 'Hate'
    when 'sexual_minors' then 'Sexual content & minors'
    when 'sexual_explicit' then 'Sexual content'
    when 'drugs_illegal_sales' then 'Drugs & illegal sales'
    when 'self_harm' then 'Self-harm & suicide'
    when 'pii_doxxing' then 'Private info & doxxing'
    when 'named_accusation' then 'Naming people'
    when 'impersonation' then 'Impersonation'
    when 'spam_scam' then 'Spam & scams'
    when 'academic_dishonesty' then 'Academic dishonesty'
    when 'profanity' then 'Profanity'
    else 'the Community Guidelines'
  end;
$$;

-- packages/shared/src/buzz/constants.ts GUIDELINE_ANCHORS (section ids of /guidelines, no '#').
create or replace function public.ts_guideline_anchor(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'threat_violence' then 'threats'
    when 'harassment_bullying' then 'harassment'
    when 'hate' then 'hate'
    when 'sexual_minors' then 'sexual'
    when 'sexual_explicit' then 'sexual'
    when 'drugs_illegal_sales' then 'drugs'
    when 'self_harm' then 'self-harm'
    when 'pii_doxxing' then 'private-info'
    when 'named_accusation' then 'private-info'
    when 'impersonation' then 'impersonation'
    when 'spam_scam' then 'spam'
    when 'academic_dishonesty' then 'academic'
    when 'profanity' then 'harassment'
  end;
$$;

create or replace function public.ts_severity_rank(p text)
returns int
language sql
immutable
as $$
  select case p when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end;
$$;

-- Priorities sort as text ('p0' < 'p1' < ...), so the higher of two is least(a, b). One level up:
create or replace function public.ts_priority_raise(p text)
returns text
language sql
immutable
as $$
  select case p when 'p3' then 'p2' when 'p2' then 'p1' else 'p0' end;
$$;

-- Queue targets (UniVerse safety 3.2 "SLA"): P0 1 h, P1 12 h, P2 24 h, P3 72 h.
create or replace function public.ts_sla(p text)
returns interval
language sql
immutable
as $$
  select case p when 'p0' then interval '1 hour' when 'p1' then interval '12 hours' when 'p2' then interval '24 hours' else interval '72 hours' end;
$$;

-- Report reasons: UniVerse's ids (packages/shared BUZZ_REPORT_REASONS) plus this app's older ones.
create or replace function public.ts_reason_priority(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'self_harm' then 'p0' when 'threat' then 'p0' when 'minor_safety' then 'p0'
    when 'doxxing' then 'p1' when 'harassment' then 'p1' when 'hate' then 'p1' when 'sexual' then 'p1'
    when 'drugs_illegal' then 'p2' when 'impersonation' then 'p2' when 'spam_scam' then 'p2'
    when 'spam' then 'p2' when 'scam' then 'p2' when 'inappropriate' then 'p2'
    else 'p3'
  end;
$$;

create or replace function public.ts_reason_category(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'self_harm' then 'self_harm' when 'threat' then 'threat_violence' when 'minor_safety' then 'sexual_minors'
    when 'doxxing' then 'pii_doxxing' when 'harassment' then 'harassment_bullying' when 'hate' then 'hate'
    when 'sexual' then 'sexual_explicit' when 'drugs_illegal' then 'drugs_illegal_sales' when 'impersonation' then 'impersonation'
    when 'spam_scam' then 'spam_scam' when 'spam' then 'spam_scam' when 'scam' then 'spam_scam'
    when 'academic_dishonesty' then 'academic_dishonesty'
  end;
$$;

-- The blind buckets of UniVerse's blindAuthorStanding: exact numbers would fingerprint an author.
create or replace function public.ts_bucket(n bigint)
returns text
language sql
immutable
as $$
  select case when n is null or n <= 0 then '0' when n = 1 then '1' when n = 2 then '2' when n <= 5 then '3-5' else '6+' end;
$$;

-- "24 hours", "3 days": for notices, so they never carry a clock time in the wrong time zone.
create or replace function public.ts_duration_text(p interval)
returns text
language sql
immutable
as $$
  select case
    when p is null then null
    when extract(epoch from p) < 48 * 3600 then round(extract(epoch from p) / 3600)::int || ' hours'
    else round(extract(epoch from p) / 86400)::int || ' days'
  end;
$$;

-- The text of a content snapshot, whitespace folded, at most 140 characters (or the fallback when there is none).
create or replace function public.ts_excerpt(p_snapshot jsonb, p_fallback text default null)
returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(
    case
      when p_snapshot is null then coalesce(p_fallback, '')
      else coalesce((
        select string_agg(coalesce(f ->> 'text', ''), ' ' order by o)
        from jsonb_array_elements(case when jsonb_typeof(p_snapshot -> 'fields') = 'array' then p_snapshot -> 'fields' else '[]'::jsonb end) with ordinality as e(f, o)
      ), '')
    end, '\s+', ' ', 'g')), 140);
$$;

-- Staff notes and report notes on Buzz items never carry an address, a handle or an account id into a payload.
create or replace function public.ts_scrub(p text)
returns text
language sql
immutable
as $$
  select case when p is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(p, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
        '@[A-Za-z0-9._]{2,30}', '@…', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[account]', 'g')
  end;
$$;

-- Metadata keys that could name a person: dropped from anon-origin audit rows.
create or replace function public.ts_strip_identity(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then coalesce(p, '{}'::jsonb) else
    p - array['userId', 'user_id', 'targetUserId', 'target_user_id', 'authorId', 'author_id', 'handle', 'username', 'email',
              'displayName', 'fullName', 'full_name', 'name']
  end;
$$;

-- universities.country is a name ('United States'); the engine picks crisis lines by ISO code.
create or replace function public.ts_country_code(p text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p, '')))
    when 'united states' then 'US' when 'usa' then 'US' when 'us' then 'US'
    when 'canada' then 'CA' when 'united kingdom' then 'GB' when 'uk' then 'GB' when 'ireland' then 'IE'
    when 'australia' then 'AU' when 'new zealand' then 'NZ' when 'india' then 'IN' when 'nepal' then 'NP'
    when 'singapore' then 'SG' when 'germany' then 'DE' when 'netherlands' then 'NL'
    else case when btrim(coalesce(p, '')) ~ '^[A-Za-z]{2}$' then upper(btrim(p)) end
  end;
$$;

-- sha256 of the lower-cased address (UniVerse banned_emails).
create or replace function public.ts_email_hash(p text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(lower(btrim(coalesce(p, ''))), 'UTF8')), 'hex');
$$;

create or replace function public.ts_fail(p_code text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using message = 'ts:' || p_code || ':' || p_message, errcode = 'P0001';
end;
$$;

-- Errors about Buzz content speak Buzz's language ('buzz:<code>:...'), so the Buzz client layer reads them.
create or replace function public.ts_fail_for(p_type text, p_code text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using message = (case when public.ts_is_anon(p_type) then 'buzz:' else 'ts:' end) || p_code || ':' || p_message, errcode = 'P0001';
end;
$$;

-- The error code of a 'ts:<code>:<message>' / 'buzz:<code>:<message>' error message (bulk actions report it per item).
create or replace function public.ts_error_code(p_message text)
returns text
language sql
immutable
as $$
  select coalesce(substring(p_message from '^(?:ts|buzz):([a-z_]+):'), 'failed');
$$;

-- -----------------------------------------------------------------------------
-- 1. Secrets
-- -----------------------------------------------------------------------------
-- seal_key keys the opaque handles staff payloads use in place of anon-origin sanction ids, and the unmask subject
-- tag. Nobody reads it through the API (RLS on, no policies, no grants).
create table if not exists public.ts_secrets (
  id int primary key default 1 check (id = 1),
  seal_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.ts_secrets (id) values (1) on conflict (id) do nothing;

create or replace function public.ts_seal(p_purpose text, p_value text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to((select s.seal_key from public.ts_secrets s where s.id = 1) || ':' || p_purpose || ':' || coalesce(p_value, ''), 'UTF8')), 'hex');
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.staff_members (
  user_id uuid primary key,
  role text not null check (role in ('moderator', 'admin')),
  created_at timestamptz not null default now(),
  constraint staff_members_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);

-- One OPEN item per piece of content (closed ones stay for the record). author_id is server-internal: it is never
-- serialized for Buzz content, for any role. A blocked write never became content: entity_id is null and the text is
-- kept in blocked_text.
create table if not exists public.mod_queue (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  surface text not null,
  university_id uuid,
  author_id uuid,
  source text not null check (source in ('rule_flag', 'rule_block_escalation', 'ai_flag', 'user_report', 'community_score', 'appeal', 'system')),
  category text,
  severity text not null default 'none' check (severity in ('none', 'low', 'medium', 'high', 'critical')),
  priority text not null check (priority in ('p0', 'p1', 'p2', 'p3')),
  label text,
  status text not null default 'open' check (status in ('open', 'claimed', 'escalated', 'closed')),
  claimed_by uuid,
  claimed_at timestamptz,
  report_count int not null default 0,
  reporter_weight int not null default 0,
  blocked_text text,
  rule_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(rule_ids) = 'array'),
  ai_verdict jsonb,
  legal_hold boolean not null default false,
  reference text,
  appeal_id uuid,
  created_at timestamptz not null default now(),
  first_action_at timestamptz,
  closed_at timestamptz,
  resolution text check (resolution is null or resolution in ('approved', 'removed', 'dismissed', 'sanctioned', 'escalated_external')),
  constraint mod_queue_author_id_fkey foreign key (author_id) references public.profiles (id) on delete set null,
  constraint mod_queue_claimed_by_fkey foreign key (claimed_by) references public.profiles (id) on delete set null,
  constraint mod_queue_university_id_fkey foreign key (university_id) references public.universities (id) on delete set null
);
create unique index if not exists mod_queue_one_open_per_entity on public.mod_queue (entity_type, entity_id)
  where status <> 'closed' and entity_id is not null;
create index if not exists mod_queue_status_idx on public.mod_queue (status, priority, created_at);
create index if not exists mod_queue_entity_idx on public.mod_queue (entity_type, entity_id, created_at desc);
create index if not exists mod_queue_author_idx on public.mod_queue (author_id) where status <> 'closed';
create index if not exists mod_queue_appeal_idx on public.mod_queue (appeal_id) where appeal_id is not null;

-- What the engine said about each field of a write (flag, block, or allow: the text hash feeds the duplicate check).
create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  surface text not null,
  field text not null default 'body',
  author_id uuid,
  university_id uuid,
  action text not null check (action in ('allow', 'flag', 'block')),
  visibility text not null default 'visible' check (visibility in ('visible', 'held')),
  category text,
  subcode text,
  severity text not null default 'none' check (severity in ('none', 'low', 'medium', 'high', 'critical')),
  rule_ids jsonb not null default '[]'::jsonb,
  matches jsonb not null default '[]'::jsonb,
  signals jsonb not null default '{}'::jsonb,
  text_hash text not null default '',
  engine_version text not null default '',
  created_at timestamptz not null default now(),
  constraint moderation_events_author_id_fkey foreign key (author_id) references public.profiles (id) on delete set null
);
create index if not exists moderation_events_entity_idx on public.moderation_events (entity_type, entity_id, created_at desc);
create index if not exists moderation_events_author_idx on public.moderation_events (author_id, created_at desc);

-- Every staff action. target_user_id is server-internal (enforcement); for Buzz content it is never serialized.
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid,
  entity_type text not null,
  entity_id uuid,
  target_user_id uuid,
  actor_id uuid,
  actor_role text not null check (actor_role in ('moderator', 'admin', 'system')),
  action text not null,
  category text,
  note text,
  batch_id uuid,
  sanction_id uuid,
  created_at timestamptz not null default now(),
  constraint moderation_actions_queue_id_fkey foreign key (queue_id) references public.mod_queue (id) on delete set null,
  constraint moderation_actions_target_user_id_fkey foreign key (target_user_id) references public.profiles (id) on delete set null,
  constraint moderation_actions_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null
);
create index if not exists moderation_actions_queue_idx on public.moderation_actions (queue_id, created_at);
create index if not exists moderation_actions_entity_idx on public.moderation_actions (entity_type, entity_id);
create index if not exists moderation_actions_created_idx on public.moderation_actions (created_at);

-- Points per confirmed violation (UniVerse safety 4.2): low/medium 90 days, high 180 days, critical never expire.
create table if not exists public.strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_type text not null,
  entity_id uuid,
  origin text not null default 'public' check (origin in ('public', 'anon')),
  category text not null,
  severity text not null,
  points int not null check (points > 0),
  action_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint strikes_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint strikes_action_id_fkey foreign key (action_id) references public.moderation_actions (id) on delete set null
);
create index if not exists strikes_user_idx on public.strikes (user_id);
create index if not exists strikes_entity_idx on public.strikes (entity_type, entity_id);

-- Warnings, mutes, suspensions and bans, plus the 'removal' notice a strike leaves (it quotes the person's own
-- content back to them; staff never see the excerpt). origin 'anon' = it came from Buzz content. effective_at may lie
-- 5-30 minutes ahead (anon-origin warnings and mutes on non-P0 items), so the moment it starts says nothing about
-- when staff acted. expires_at null = open-ended (ban, warning, removal).
create table if not exists public.user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('warning', 'mute', 'suspension', 'ban', 'removal')),
  scope text not null default 'all' check (scope in ('all', 'buzz_only', 'requests')),
  origin text not null default 'public' check (origin in ('public', 'anon')),
  category text,
  entity_type text,
  entity_id uuid,
  content_excerpt text,
  content_label text,
  action_id uuid,
  actor_id uuid,
  starts_at timestamptz not null default now(),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  acknowledged_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  created_at timestamptz not null default now(),
  constraint user_sanctions_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint user_sanctions_action_id_fkey foreign key (action_id) references public.moderation_actions (id) on delete set null,
  constraint user_sanctions_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null,
  constraint user_sanctions_lifted_by_fkey foreign key (lifted_by) references public.profiles (id) on delete set null
);
create index if not exists user_sanctions_user_idx on public.user_sanctions (user_id, kind, expires_at);
create index if not exists user_sanctions_entity_idx on public.user_sanctions (entity_type, entity_id);
create index if not exists user_sanctions_action_idx on public.user_sanctions (action_id);

-- One appeal per sanction, within 14 days, reviewed by someone other than the person who acted.
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  sanction_id uuid not null,
  text text not null check (char_length(text) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'reversed', 'reduced')),
  reviewer_id uuid,
  outcome_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint appeals_sanction_id_key unique (sanction_id),
  constraint appeals_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint appeals_sanction_id_fkey foreign key (sanction_id) references public.user_sanctions (id) on delete cascade,
  constraint appeals_reviewer_id_fkey foreign key (reviewer_id) references public.profiles (id) on delete set null
);
create index if not exists appeals_status_idx on public.appeals (status, created_at);

-- Append-only. No foreign keys on purpose: an ON DELETE action would have to update a row, and none may change.
-- actor_id null = the system. seq orders rows written in the same transaction (the unmask row before the subject row).
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  actor_id uuid,
  actor_role text not null,
  action text not null,
  target_type text,
  target_id text,
  queue_id uuid,
  batch_id uuid,
  reason_code text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc, seq desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);
create index if not exists audit_log_queue_idx on public.audit_log (queue_id);

create or replace function public.ts_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception using message = 'ts:append_only:audit_log is append-only', errcode = 'P0001';
end;
$$;
drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update on public.audit_log for each row execute function public.ts_audit_append_only();
drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete before delete on public.audit_log for each row execute function public.ts_audit_append_only();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function public.ts_audit_append_only();

create table if not exists public.banned_emails (
  email_hash text primary key,
  created_at timestamptz not null default now()
);

-- Which engine rule packs run. The packs themselves live in code (packages/moderation, RULE_PACK_IDS); the write API
-- reads the state through ts_writer_context().enabledRulePacks. A pack with no row is ON (an empty table must never
-- mean "no rules"); rows are seeded anyway so the staff console lists every pack.
create or replace function public.ts_rule_pack_ids()
returns text[]
language sql
immutable
as $$
  select array['baseline', 'admin.threats', 'admin.harassment', 'admin.hate', 'admin.sexual', 'admin.drugs', 'admin.selfharm',
               'admin.pii', 'admin.impersonation', 'admin.spam', 'admin.academic', 'admin.commerce'];
$$;

create table if not exists public.moderation_rule_state (
  pack_id text primary key check (pack_id ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint moderation_rule_state_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);
insert into public.moderation_rule_state (pack_id)
select unnest(public.ts_rule_pack_ids())
on conflict (pack_id) do nothing;

-- Every known pack (the engine's, plus any row added since) with its switch; no row = on.
create or replace function public.ts_rule_packs_state()
returns table (pack_id text, enabled boolean, updated_by uuid, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ids.id, coalesce(r.enabled, true), r.updated_by, r.updated_at
  from (select unnest(public.ts_rule_pack_ids()) as id union select x.pack_id from public.moderation_rule_state x) ids
  left join public.moderation_rule_state r on r.pack_id = ids.id;
$$;

-- Closed to the API: row-level security with no policies, and no grants (a grant would also leak row estimates).
do $$
declare
  t text;
begin
  foreach t in array array['ts_secrets', 'staff_members', 'mod_queue', 'moderation_events', 'moderation_actions', 'strikes',
                           'user_sanctions', 'appeals', 'audit_log', 'banned_emails', 'moderation_rule_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
  execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.audit_log', 'seq'));
end
$$;

-- Never in the realtime publication (deleted or changed rows would reach every subscriber).
do $$
declare
  t text;
begin
  foreach t in array array['staff_members', 'mod_queue', 'moderation_events', 'moderation_actions', 'strikes', 'user_sanctions', 'appeals', 'audit_log'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
       and not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. A banned address cannot sign up again
-- -----------------------------------------------------------------------------
-- Its own trigger next to enforce_university_email, which other migrations own (the university domains, then business
-- and staff sign-ups), so neither one replaces the other whatever order they run in.
create or replace function public.ts_refuse_banned_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.banned_emails b where b.email_hash = public.ts_email_hash(new.email)) then
    raise exception 'This email address can''t be used to sign up.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists ts_refuse_banned_email on auth.users;
create trigger ts_refuse_banned_email
  before insert on auth.users
  for each row execute function public.ts_refuse_banned_email();

-- -----------------------------------------------------------------------------
-- 4. Notification types
-- -----------------------------------------------------------------------------
-- A union, never a fixed list: this file re-runs after migration 42 (Buzz's 'buzz_reply', 'buzz_milestone',
-- 'buzz_poll_closed') and must keep every type already allowed, and every type already in the table.
do $$
declare
  v_have text[];
  v_all text[];
begin
  select array_agg(distinct m[1]) into v_have
  from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  select array_agg(distinct t order by t) into v_all
  from unnest(
    coalesce(v_have, '{}'::text[])
    || coalesce((select array_agg(distinct n.type) from public.notifications n), '{}'::text[])
    || array['message', 'listing_saved', 'nearby_listing', 'system', 'like', 'comment', 'follow', 'snap',
             'moderation', 'staff', 'buzz_reply', 'buzz_milestone', 'buzz_poll_closed']
  ) as t;
  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
                 (select string_agg(quote_literal(t), ', ' order by t) from unnest(v_all) as t));
end
$$;

-- Moderation notices are written here and nowhere else: never an actor; visible_at lets a delayed sanction's notice
-- appear only when the sanction starts. created_at follows visible_at, so the list never shows the real time.
create or replace function public.ts_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_data jsonb, p_visible_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := greatest(now(), coalesce(p_visible_at, now()));
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, title, body, link, data, created_at, visible_at)
  values (p_user, null, p_type, left(p_title, 200), left(p_body, 300), p_link, coalesce(p_data, '{}'::jsonb), v_at, v_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Reports: UniVerse's columns, reasons and rules
-- -----------------------------------------------------------------------------
alter table public.reports
  add column if not exists eligible boolean not null default false,
  add column if not exists weight int not null default 0,
  add column if not exists queue_id uuid,
  add column if not exists sub_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists bad_faith boolean not null default false,
  add column if not exists university_id uuid;

alter table public.reports drop constraint if exists reports_weight_check;
alter table public.reports add constraint reports_weight_check check (weight between 0 and 2);
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('open', 'reviewed', 'actioned', 'dismissed'));
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'self_harm', 'threat', 'minor_safety', 'doxxing', 'harassment', 'hate', 'sexual', 'drugs_illegal', 'impersonation', 'spam_scam',
  'academic_dishonesty', 'other', 'spam', 'scam', 'inappropriate'
));
-- 'buzz_comment' stays valid until migration 42 renames those rows to 'buzz_reply'.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('apartment', 'item', 'roommate', 'profile', 'message', 'comment', 'post', 'buzz', 'buzz_reply', 'buzz_comment'));

-- One report per person and thing: keep the oldest of any repeats, then hold it.
delete from public.reports r
using public.reports o
where r.reporter_id = o.reporter_id and r.target_type = o.target_type and r.target_id = o.target_id
  and (o.created_at < r.created_at or (o.created_at = r.created_at and o.id < r.id));
create unique index if not exists reports_one_per_reporter on public.reports (reporter_id, target_type, target_id);
create index if not exists reports_open_idx on public.reports (target_type, target_id) where status = 'open';

-- Buzz is reported through buzz_v2_report() only (it hides the item for the reporter and never offers a block).
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and target_type not in ('buzz', 'buzz_reply', 'buzz_comment'));

-- The API keeps the columns it had: what someone may read about their own reports, and what they may send. Weight,
-- eligibility and the queue link are the server's (a reporter could otherwise read their own trust level).
revoke all on table public.reports from anon, authenticated;
grant select (id, reporter_id, target_type, target_id, reason, details, status, created_at) on table public.reports to authenticated;
grant insert (reporter_id, target_type, target_id, reason, details) on table public.reports to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Roles, standing, posting status
-- -----------------------------------------------------------------------------
-- 'admin' | 'moderator' | null. CampConnect Admin's staff list wins where it exists (see the header); its table is
-- read with dynamic SQL so this file also runs where it does not.
create or replace function public.ts_role_of(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_user is null then
    return null;
  end if;
  if to_regclass('public.staff') is not null then
    execute 'select case s.role when ''moderator'' then ''moderator'' else ''admin'' end from public.staff s where s.user_id = $1'
      into v_role using p_user;
    if v_role is not null and to_regprocedure('public.is_suspended(uuid)') is not null then
      if public.is_suspended(p_user) then
        return null;
      end if;
    end if;
    return v_role;
  end if;
  select s.role into v_role from public.staff_members s where s.user_id = p_user;
  return v_role;
end;
$$;

-- Everyone on the staff list (admins only, or everyone), for notices to staff.
create or replace function public.ts_staff_ids(p_admins_only boolean)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.staff') is not null then
    return query execute 'select s.user_id from public.staff s where not $1 or s.role in (''owner'', ''admin'')' using coalesce(p_admins_only, false);
    return;
  end if;
  return query select m.user_id from public.staff_members m where not coalesce(p_admins_only, false) or m.role = 'admin';
end;
$$;

-- This session passed two-factor sign-in (Supabase sets aal2) and the account still has a verified factor, so a
-- factor deleted in the dashboard ends staff access at once. CampConnect Admin's staff_mfa_verified(), applied here.
create or replace function public.ts_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

-- The caller's own role (null for everyone who is not staff). The website shows the console entry with it.
create or replace function public.ts_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.ts_role_of(auth.uid());
$$;

-- Active strike points, every origin (enforcement uses the true total; staff views filter it).
create or replace function public.ts_strike_points(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(s.points), 0)::int
  from public.strikes s
  where s.user_id = p_user and s.revoked_at is null and (s.expires_at is null or s.expires_at > now());
$$;

-- UniVerse safety 3.1: 'low' after a bad-faith report, or 3+ dismissed in 30 days with under 20 % confirmed; 'high'
-- with 5+ confirmed at 70 % or more.
create or replace function public.ts_reporter_trust(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select
      count(*) filter (where r.status = 'actioned') as confirmed,
      count(*) as closed,
      count(*) filter (where r.status = 'dismissed' and r.closed_at > now() - interval '30 days') as dismissed30,
      coalesce(bool_or(r.bad_faith), false) as bad_faith
    from public.reports r
    where r.reporter_id = p_user and r.status <> 'open'
  )
  select case
    when c.bad_faith or (c.dismissed30 >= 3 and (case when c.closed = 0 then 0 else c.confirmed::numeric / c.closed end) < 0.2) then 'low'
    when c.confirmed >= 5 and c.confirmed::numeric / nullif(c.closed, 0) >= 0.7 then 'high'
    else 'normal'
  end
  from c;
$$;

-- What a write by p_user may do right now. p_scope: 'buzz', 'public' or 'message_request'. A ban, a suspension and a
-- mute in scope refuse; so does a warning not yet acknowledged (UniVerse assertCanPost). The strictest one answers.
create or replace function public.ts_posting_status(p_user uuid, p_scope text default 'buzz')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s public.user_sanctions;
  v_warning uuid;
  v_until timestamptz;
begin
  if p_user is null then
    return jsonb_build_object('allowed', false, 'mutedUntil', null, 'reason', null, 'warningId', null);
  end if;
  select s.* into v_s
  from public.user_sanctions s
  where s.user_id = p_user and s.kind in ('ban', 'suspension', 'mute') and s.lifted_at is null
    and s.effective_at <= now() and (s.expires_at is null or s.expires_at > now())
    and (s.kind <> 'mute' or s.scope = 'all' or (s.scope = 'buzz_only' and p_scope = 'buzz') or (s.scope = 'requests' and p_scope = 'message_request'))
  order by case s.kind when 'ban' then 0 when 'suspension' then 1 else 2 end, s.expires_at desc nulls first
  limit 1;
  if found then
    return jsonb_build_object(
      'allowed', false,
      'mutedUntil', public.ts_ms(v_s.expires_at),
      'reason', case v_s.kind when 'ban' then 'banned' when 'suspension' then 'suspended' else 'muted' end,
      'warningId', null);
  end if;
  -- CampConnect Admin's suspensions (account_restrictions, migration 15) count too. Its triggers stop what a suspended
  -- account writes itself; Buzz posts and replies are written by the website's server, so they rest on this check.
  if to_regclass('public.account_restrictions') is not null then
    if public.is_suspended(p_user) then
      execute 'select r.expires_at from public.account_restrictions r where r.user_id = $1 and r.lifted_at is null order by r.created_at desc limit 1'
        into v_until using p_user;
      return jsonb_build_object('allowed', false, 'mutedUntil', public.ts_ms(v_until), 'reason', 'suspended', 'warningId', null);
    end if;
  end if;
  select s.id into v_warning
  from public.user_sanctions s
  where s.user_id = p_user and s.kind = 'warning' and s.acknowledged_at is null and s.lifted_at is null and s.effective_at <= now()
  order by s.created_at
  limit 1;
  if v_warning is not null then
    return jsonb_build_object('allowed', false, 'mutedUntil', null, 'reason', 'warning', 'warningId', v_warning);
  end if;
  return jsonb_build_object('allowed', true, 'mutedUntil', null, 'reason', null, 'warningId', null);
end;
$$;

-- UniVerse's "new account" for rate limits: under 72 hours old, or 72 hours after a suspension ended.
create or replace function public.ts_treated_as_new(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.created_at > now() - interval '72 hours' from public.profiles p where p.id = p_user), true)
    or exists (
      select 1 from public.user_sanctions s
      where s.user_id = p_user and s.kind = 'suspension'
        and least(s.lifted_at, s.expires_at) between now() - interval '72 hours' and now()
    );
$$;

-- -----------------------------------------------------------------------------
-- 7. Content adapters
-- -----------------------------------------------------------------------------
-- Public content: {entityType, entityId, status, universityId, surface, label, autoHideImmune, createdAt, href,
-- fields [{field, text}], media [{url, kind}], parent}. Public content has no hidden state, so it is always 'active'
-- while it exists. Never the author: that is ts_public_author_of().
create or replace function public.ts_public_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_fields jsonb := '[]'::jsonb;
  v_media jsonb := '[]'::jsonb;
  v_href text;
  v_label text;
  v_uni uuid;
  v_parent jsonb := null;
begin
  if p_id is null then
    return null;
  end if;
  if p_type = 'post' then
    select to_jsonb(x) into r from public.feed_posts x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'body', '')));
    v_label := case when r ->> 'kind' = 'reel' then 'reel' else 'post' end;
    v_href := case when r ->> 'kind' = 'reel' then '/reels/' else '/posts/' end || p_id::text;
  elsif p_type = 'comment' then
    select to_jsonb(x) into r from public.post_comments x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'body', '')));
    v_label := 'comment';
    v_href := public.post_link(r ->> 'target_type', public.ts_uuid(r ->> 'target_id'));
    v_parent := jsonb_build_object('entityType', r ->> 'target_type', 'entityId', r ->> 'target_id');
  elsif p_type = 'apartment' then
    select to_jsonb(x) into r from public.apartments x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'listing';
    v_href := '/apartments/' || p_id::text;
  elsif p_type = 'item' then
    select to_jsonb(x) into r from public.items x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'item';
    v_href := '/marketplace/' || p_id::text;
  elsif p_type = 'roommate' then
    select to_jsonb(x) into r from public.roommate_posts x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'title', 'text', coalesce(r ->> 'title', '')),
                                  jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'description', '')));
    v_label := 'roommate post';
    v_href := '/roommates/' || p_id::text;
  elsif p_type = 'profile' then
    select to_jsonb(x) into r from public.profiles x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'name', 'text', coalesce(r ->> 'full_name', '')),
                                  jsonb_build_object('field', 'bio', 'text', coalesce(r ->> 'bio', '')));
    v_label := 'profile';
    v_href := '/profile/' || p_id::text;
    if coalesce(r ->> 'avatar_url', '') <> '' then
      v_media := jsonb_build_array(jsonb_build_object('url', r ->> 'avatar_url', 'kind', 'image'));
    end if;
  elsif p_type = 'message' then
    select to_jsonb(x) into r from public.messages x where x.id = p_id;
    if r is null then return null; end if;
    v_fields := jsonb_build_array(jsonb_build_object('field', 'body', 'text', coalesce(r ->> 'content', '')));
    v_label := 'message';
    v_href := '/messages/' || coalesce(r ->> 'conversation_id', '');
    if coalesce(r ->> 'image_url', '') <> '' then
      v_media := jsonb_build_array(jsonb_build_object('url', r ->> 'image_url', 'kind', 'image'));
    end if;
  else
    return null;
  end if;

  if p_type in ('post', 'apartment', 'item', 'roommate') then
    select coalesce(jsonb_agg(jsonb_build_object('url', u, 'kind', 'image') order by o), '[]'::jsonb) into v_media
    from jsonb_array_elements_text(case when jsonb_typeof(r -> 'images') = 'array' then r -> 'images' else '[]'::jsonb end) with ordinality as e(u, o);
    v_media := v_media || coalesce((
      select jsonb_agg(jsonb_build_object('url', 'https://stream.mux.com/' || (v ->> 'playback_id') || '.m3u8', 'kind', 'video') order by o)
      from jsonb_array_elements(case when jsonb_typeof(r -> 'videos') = 'array' then r -> 'videos' else '[]'::jsonb end) with ordinality as e(v, o)
      where coalesce(v ->> 'playback_id', '') ~ '^[A-Za-z0-9]+$'
    ), '[]'::jsonb);
  end if;
  v_uni := public.ts_uuid(r ->> 'university_id');
  if v_uni is null and p_type = 'comment' then
    select p.university_id into v_uni from public.profiles p where p.id = public.ts_uuid(r ->> 'user_id');
  end if;
  return jsonb_build_object(
    'entityType', p_type, 'entityId', p_id, 'status', 'active', 'universityId', v_uni, 'surface', p_type, 'label', v_label,
    'autoHideImmune', false, 'createdAt', public.ts_ms((r ->> 'created_at')::timestamptz), 'href', v_href,
    'fields', v_fields, 'media', v_media, 'parent', v_parent);
end;
$$;

create or replace function public.ts_public_author_of(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_type
    when 'post' then (select x.author_id from public.feed_posts x where x.id = p_id)
    when 'comment' then (select x.user_id from public.post_comments x where x.id = p_id)
    when 'apartment' then (select x.owner_id from public.apartments x where x.id = p_id)
    when 'item' then (select x.seller_id from public.items x where x.id = p_id)
    when 'roommate' then (select x.author_id from public.roommate_posts x where x.id = p_id)
    when 'profile' then (select x.id from public.profiles x where x.id = p_id)
    when 'message' then (select x.sender_id from public.messages x where x.id = p_id)
  end;
$$;

-- "Remove" for public content deletes it (its likes, comments and views go with it through their own triggers). A
-- profile is never deleted: it loses its bio and photo.
create or replace function public.ts_public_remove(p_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_type = 'post' then delete from public.feed_posts where id = p_id;
  elsif p_type = 'comment' then delete from public.post_comments where id = p_id;
  elsif p_type = 'apartment' then delete from public.apartments where id = p_id;
  elsif p_type = 'item' then delete from public.items where id = p_id;
  elsif p_type = 'roommate' then delete from public.roommate_posts where id = p_id;
  elsif p_type = 'profile' then update public.profiles set bio = null, avatar_url = null where id = p_id;
  elsif p_type = 'message' then delete from public.messages where id = p_id;
  end if;
end;
$$;

-- Any content: Buzz through migration 42's adapter (no author in it), public content through the one above.
create or replace function public.ts_snapshot(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
begin
  if p_id is null or p_type is null then
    return null;
  end if;
  if public.ts_is_anon(p_type) then
    begin
      s := public.buzz_v2_snapshot(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
    exception when undefined_function then
      return null;
    end;
    if s is null or jsonb_typeof(s) <> 'object' or s ->> 'entityId' is null then
      return null;
    end if;
    return s;
  end if;
  return public.ts_public_snapshot(p_type, p_id);
end;
$$;

-- FIREWALL: the author of any content. Server-internal; only console_unmask() ever returns it to anyone.
create or replace function public.ts_author_of(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return null;
  end if;
  if public.ts_is_anon(p_type) then
    return public.buzz_v2_author_of(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
  end if;
  return public.ts_public_author_of(p_type, p_id);
end;
$$;

-- 'active' | 'hidden' | 'removed'. Public content can only be removed (it has no hidden state).
create or replace function public.ts_set_content_status(p_type text, p_id uuid, p_status text, p_immune boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.ts_is_anon(p_type) then
    perform public.buzz_v2_set_status(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id, p_status, p_immune);
  elsif p_status = 'removed' then
    perform public.ts_public_remove(p_type, p_id);
  end if;
end;
$$;

-- Buzz: the thread with its parent chain and nearby replies, through the blind serializer. Public content: none.
create or replace function public.ts_staff_context(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null or not public.ts_is_anon(p_type) then
    return null;
  end if;
  return public.buzz_v2_staff_context(case when p_type = 'buzz_comment' then 'buzz_reply' else p_type end, p_id);
exception when undefined_function then
  return null;
end;
$$;

create or replace function public.ts_university_name(p_university uuid, p_short boolean default true)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- short_name arrives with migration 42; to_jsonb() reads it when it is there and never fails when it is not.
  select case when p_short then coalesce(nullif(to_jsonb(u) ->> 'short_name', ''), u.name) else u.name end
  from public.universities u where u.id = p_university;
$$;

-- -----------------------------------------------------------------------------
-- 8. The queue and the engine's records
-- -----------------------------------------------------------------------------
-- Upsert the entity's open item: priority and severity only ever go up, category / label / author fill in when
-- missing, rule ids merge, report counters add. The first source is kept. Writers of one entity serialize on an
-- advisory lock, so two reports at once make one item.
create or replace function public.ts_enqueue(
  p_entity_type text, p_entity_id uuid, p_surface text, p_university uuid, p_author uuid, p_source text, p_category text,
  p_severity text, p_priority text, p_label text, p_rule_ids jsonb, p_blocked_text text, p_report_delta int, p_weight_delta int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_priority text := case when p_priority in ('p0', 'p1', 'p2', 'p3') then p_priority else 'p2' end;
  v_severity text := case when p_severity in ('none', 'low', 'medium', 'high', 'critical') then p_severity else 'none' end;
  v_source text := case when p_source in ('rule_flag', 'rule_block_escalation', 'ai_flag', 'user_report', 'community_score', 'appeal', 'system') then p_source else 'system' end;
  v_category text := case when public.ts_is_category(p_category) then p_category end;
  v_rules jsonb;
  v_type text := case when p_entity_type = 'buzz_comment' then 'buzz_reply' else p_entity_type end;
begin
  if v_type is null then
    perform public.ts_fail('validation_failed', 'A queue item needs an entity type.');
  end if;
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_rules
  from jsonb_array_elements_text(case when jsonb_typeof(p_rule_ids) = 'array' then p_rule_ids else '[]'::jsonb end) x
  where x <> '';
  if p_entity_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('mod_queue:' || v_type || ':' || p_entity_id::text, 0));
    select q.id into v_id from public.mod_queue q
    where q.entity_type = v_type and q.entity_id = p_entity_id and q.status <> 'closed'
    for update;
    if v_id is not null then
      update public.mod_queue q set
        priority = least(q.priority, v_priority),
        severity = case when public.ts_severity_rank(v_severity) > public.ts_severity_rank(q.severity) then v_severity else q.severity end,
        category = coalesce(q.category, v_category),
        label = coalesce(q.label, p_label),
        author_id = coalesce(q.author_id, p_author),
        university_id = coalesce(q.university_id, p_university),
        rule_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                    from (select jsonb_array_elements_text(q.rule_ids) as x union select jsonb_array_elements_text(v_rules)) s),
        report_count = q.report_count + coalesce(p_report_delta, 0),
        reporter_weight = q.reporter_weight + coalesce(p_weight_delta, 0)
      where q.id = v_id;
      return v_id;
    end if;
  end if;
  insert into public.mod_queue (entity_type, entity_id, surface, university_id, author_id, source, category, severity, priority, label,
                                report_count, reporter_weight, blocked_text, rule_ids)
  values (v_type, p_entity_id, coalesce(nullif(p_surface, ''), v_type), p_university, p_author, v_source, v_category, v_severity, v_priority,
          p_label, coalesce(p_report_delta, 0), coalesce(p_weight_delta, 0), case when p_entity_id is null then left(p_blocked_text, 4000) end, v_rules)
  returning id into v_id;
  return v_id;
end;
$$;

-- One moderation_events row per event: {field, action, visibility, category, subcode, severity, ruleIds, matches,
-- signals, textHash, engineVersion} (packages/moderation toModerationRecord). Unknown values fall back to defaults.
create or replace function public.ts_record_events(p_entity_type text, p_entity_id uuid, p_surface text, p_author uuid, p_university uuid, p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.moderation_events (entity_type, entity_id, surface, field, author_id, university_id, action, visibility, category, subcode,
                                        severity, rule_ids, matches, signals, text_hash, engine_version)
  select
    case when p_entity_type = 'buzz_comment' then 'buzz_reply' else p_entity_type end,
    p_entity_id,
    -- a poll option of a buzz is moderated on surface 'buzz_poll': each event may name its own
    coalesce(case when (e ->> 'surface') ~ '^[a-z_]{2,32}$' then e ->> 'surface' end, nullif(p_surface, ''), p_entity_type),
    case when e ->> 'field' in ('title', 'body', 'option', 'name', 'bio', 'handle') then e ->> 'field' else 'body' end,
    p_author,
    p_university,
    case when e ->> 'action' in ('allow', 'flag', 'block') then e ->> 'action' else 'flag' end,
    case when e ->> 'visibility' in ('visible', 'held') then e ->> 'visibility' else 'visible' end,
    case when public.ts_is_category(e ->> 'category') then e ->> 'category' end,
    left(e ->> 'subcode', 64),
    case when e ->> 'severity' in ('none', 'low', 'medium', 'high', 'critical') then e ->> 'severity' else 'none' end,
    case when jsonb_typeof(e -> 'ruleIds') = 'array' then e -> 'ruleIds' else '[]'::jsonb end,
    case when jsonb_typeof(e -> 'matches') = 'array' then e -> 'matches' else '[]'::jsonb end,
    case when jsonb_typeof(e -> 'signals') = 'object' then e -> 'signals' else '{}'::jsonb end,
    left(coalesce(e ->> 'textHash', ''), 128),
    left(coalesce(e ->> 'engineVersion', ''), 32)
  from (
    select e from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end) e limit 50
  ) x(e)
  where jsonb_typeof(e) = 'object';
end;
$$;

-- What a Buzz write calls with the engine's record (migration 42's buzz_v2_create / buzz_v2_reply): the events, and
-- the queue item when the engine asked for one ({source, category, severity, priority, label, ruleIds, aiVerdict}).
create or replace function public.ts_apply_moderation(p_entity_type text, p_entity_id uuid, p_surface text, p_author uuid, p_university uuid, p_moderation jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  q jsonb;
  v_id uuid;
begin
  if p_moderation is null or jsonb_typeof(p_moderation) <> 'object' then
    return null;
  end if;
  perform public.ts_record_events(p_entity_type, p_entity_id, p_surface, p_author, p_university, p_moderation -> 'events');
  q := p_moderation -> 'queue';
  if jsonb_typeof(q) = 'object' then
    v_id := public.ts_enqueue(
      p_entity_type, p_entity_id, p_surface, p_university, p_author,
      case when q ->> 'source' in ('rule_flag', 'rule_block_escalation', 'ai_flag') then q ->> 'source' else 'rule_flag' end,
      q ->> 'category', q ->> 'severity', q ->> 'priority',
      coalesce(q ->> 'label', case when q ->> 'category' = 'self_harm' then 'wellbeing' end),
      q -> 'ruleIds', null, 0, 0);
    if jsonb_typeof(q -> 'aiVerdict') = 'object' then
      update public.mod_queue set ai_verdict = q -> 'aiVerdict' where id = v_id;
    end if;
  end if;
  return v_id;
end;
$$;

-- A blocked write (it never became content): its events with no entity, and the queue item with the text when the
-- engine escalated (a credible threat, self-harm method). Service role only (the write API).
create or replace function public.ts_record_blocked(p_author uuid, p_surface text, p_text text, p_moderation jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case p_surface when 'buzz_poll' then 'buzz' else p_surface end;
  v_uni uuid;
  q jsonb;
  v_id uuid;
begin
  if p_author is null or not exists (select 1 from public.profiles p where p.id = p_author) then
    perform public.ts_fail('not_found', 'That account isn''t available.');
  end if;
  if v_type is null or v_type not in ('buzz', 'buzz_reply', 'post', 'comment', 'apartment', 'item', 'roommate', 'profile', 'message') then
    perform public.ts_fail('validation_failed', 'Unknown surface.');
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = p_author;
  if p_moderation is null or jsonb_typeof(p_moderation) <> 'object' then
    return null;
  end if;
  perform public.ts_record_events(v_type, null, p_surface, p_author, v_uni, p_moderation -> 'events');
  q := p_moderation -> 'queue';
  if jsonb_typeof(q) = 'object' then
    v_id := public.ts_enqueue(
      v_type, null, p_surface, v_uni, p_author,
      case when q ->> 'source' in ('rule_flag', 'rule_block_escalation', 'ai_flag') then q ->> 'source' else 'rule_block_escalation' end,
      q ->> 'category', q ->> 'severity', q ->> 'priority',
      coalesce(q ->> 'label', case when q ->> 'category' = 'self_harm' then 'wellbeing' end),
      q -> 'ruleIds', coalesce(p_text, ''), 0, 0);
    if jsonb_typeof(q -> 'aiVerdict') = 'object' then
      update public.mod_queue set ai_verdict = q -> 'aiVerdict' where id = v_id;
    end if;
  end if;
  return v_id;
end;
$$;

-- Everything the moderation engine needs about a writer (the write API, service role only): the account, its age and
-- strike points, its recent text hashes (duplicate detection; blocked texts do not count), whether it may post to Buzz,
-- and which rule packs are on.
create or replace function public.ts_writer_context(p_author uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uni uuid;
  v_created timestamptz;
  v_country text;
begin
  select p.university_id, p.created_at, u.country into v_uni, v_created, v_country
  from public.profiles p left join public.universities u on u.id = p.university_id
  where p.id = p_author;
  if not found then
    perform public.ts_fail('not_found', 'That account isn''t available.');
  end if;
  return jsonb_build_object(
    'userId', p_author,
    'universityId', v_uni,
    'countryCode', public.ts_country_code(v_country),
    'role', coalesce(public.ts_role_of(p_author), 'user'),
    'accountAgeMs', greatest(0, floor(extract(epoch from (now() - v_created)) * 1000))::bigint,
    'activeStrikePoints', public.ts_strike_points(p_author),
    'recentHashes', coalesce((
      select jsonb_agg(e.text_hash order by e.created_at)
      from public.moderation_events e
      where e.author_id = p_author and e.created_at > now() - interval '10 minutes' and e.text_hash <> '' and e.action <> 'block'
        and e.surface in ('buzz', 'buzz_reply', 'buzz_poll')
    ), '[]'::jsonb),
    'posting', public.ts_posting_status(p_author, 'buzz')
      || jsonb_build_object('pollsUnlockAt', case when v_created + interval '24 hours' > now() then public.ts_ms(v_created + interval '24 hours') end),
    'treatedAsNew', public.ts_treated_as_new(p_author),
    'enabledRulePacks', coalesce((select jsonb_agg(r.pack_id order by r.pack_id) from public.ts_rule_packs_state() r where r.enabled), '[]'::jsonb),
    'disabledRulePacks', coalesce((select jsonb_agg(r.pack_id order by r.pack_id) from public.ts_rule_packs_state() r where not r.enabled), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Staff write path (UniVerse lib/moderation/staff.ts + lib/audit.ts)
-- -----------------------------------------------------------------------------
create or replace function public.ts_audit(
  p_actor uuid, p_actor_role text, p_action text, p_target_type text, p_target_id text, p_queue_id uuid, p_batch_id uuid,
  p_reason_code text, p_reason text, p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, queue_id, batch_id, reason_code, reason, metadata)
  values (p_actor, coalesce(p_actor_role, 'system'), p_action, p_target_type, p_target_id, p_queue_id, p_batch_id, p_reason_code, p_reason,
          case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end)
  returning id into v_id;
  return v_id;
end;
$$;

-- moderation_actions + the audit row, in the caller's transaction. The target is the content; the person is stored
-- server-side only, and named in the audit metadata only for public content (UniVerse anon-origin rule 3).
create or replace function public.ts_record_action(
  p_queue_id uuid, p_entity_type text, p_entity_id uuid, p_target_user uuid, p_actor uuid, p_actor_role text, p_action text,
  p_category text, p_note text, p_batch uuid, p_sanction uuid, p_reason_code text, p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_anon boolean := public.ts_is_anon(p_entity_type) or public.ts_is_anon((select q.entity_type from public.mod_queue q where q.id = p_queue_id));
  v_extra jsonb := case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end;
begin
  insert into public.moderation_actions (queue_id, entity_type, entity_id, target_user_id, actor_id, actor_role, action, category, note, batch_id, sanction_id)
  values (p_queue_id, p_entity_type, p_entity_id, p_target_user, p_actor, coalesce(p_actor_role, 'system'), p_action, p_category, p_note, p_batch, p_sanction)
  returning id into v_id;
  if p_queue_id is not null then
    update public.mod_queue set first_action_at = coalesce(first_action_at, now()) where id = p_queue_id;
  end if;
  if v_anon then
    v_extra := public.ts_strip_identity(v_extra);
  end if;
  perform public.ts_audit(p_actor, p_actor_role, p_action, p_entity_type, p_entity_id::text, p_queue_id, p_batch, p_reason_code, p_note,
    jsonb_build_object('actionId', v_id, 'category', p_category, 'sanctionId', p_sanction) || v_extra
      || case when not v_anon and p_target_user is not null then jsonb_build_object('targetUserId', p_target_user) else '{}'::jsonb end);
  return v_id;
end;
$$;

-- Close every open report on the content; each reporter is told the outcome, never what happened to whom.
create or replace function public.ts_close_reports(p_entity_type text, p_entity_id uuid, p_outcome text, p_bad_faith boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_anon boolean := public.ts_is_anon(p_entity_type);
begin
  if p_entity_id is null then
    return;
  end if;
  for r in
    update public.reports set status = p_outcome, closed_at = now(), bad_faith = coalesce(p_bad_faith, false)
    where target_type in (p_entity_type, case when p_entity_type = 'buzz_reply' then 'buzz_comment' end) and target_id = p_entity_id and status = 'open'
    returning id, reporter_id
  loop
    perform public.ts_notify(
      r.reporter_id, 'moderation',
      case when p_outcome = 'actioned' then 'Thanks — we reviewed your report and took action.'
           else 'Thanks — we reviewed your report and didn''t find a violation.' end,
      case when p_outcome = 'actioned' then null
           when v_anon then 'You can still hide it. Reports help us spot patterns.'
           else 'You can still block or hide it. Reports help us spot patterns.' end,
      '/guidelines',
      jsonb_build_object('event', 'report_resolved', 'outcome', case when p_outcome = 'actioned' then 'actioned' else 'no_violation' end));
  end loop;
end;
$$;

-- The strike (points per severity) and the 'removal' notice that quotes the person's own content back to them.
-- Returns their active points after it (the true total).
create or replace function public.ts_add_strike(p_user uuid, p_entity_type text, p_entity_id uuid, p_category text, p_severity text, p_action_id uuid, p_snapshot jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.moderation_actions;
  v_anon boolean;
  v_points int := case p_severity when 'critical' then 5 when 'high' then 3 when 'medium' then 2 else 1 end;
  v_ttl interval := case p_severity when 'critical' then null when 'high' then interval '180 days' else interval '90 days' end;
  v_strike uuid;
begin
  select * into v_action from public.moderation_actions where id = p_action_id;
  v_anon := public.ts_is_anon(p_entity_type) or public.ts_is_anon((select q.entity_type from public.mod_queue q where q.id = v_action.queue_id));
  insert into public.strikes (user_id, entity_type, entity_id, origin, category, severity, points, action_id, expires_at)
  values (p_user, p_entity_type, p_entity_id, case when v_anon then 'anon' else 'public' end, coalesce(p_category, 'spam_scam'),
          coalesce(p_severity, 'low'), v_points, p_action_id, case when v_ttl is null then null else now() + v_ttl end)
  returning id into v_strike;
  insert into public.user_sanctions (user_id, kind, scope, origin, category, entity_type, entity_id, content_excerpt, content_label, action_id, actor_id,
                                     starts_at, effective_at, expires_at)
  values (p_user, 'removal', 'all', case when v_anon then 'anon' else 'public' end, p_category, p_entity_type, p_entity_id,
          nullif(public.ts_excerpt(p_snapshot), ''), p_snapshot ->> 'label', p_action_id, v_action.actor_id, now(), now(), null);
  perform public.ts_audit(v_action.actor_id, coalesce(v_action.actor_role, 'system'), 'strike_add', p_entity_type, p_entity_id::text, v_action.queue_id, null, null, null,
    jsonb_build_object('strikeId', v_strike, 'points', v_points, 'severity', p_severity, 'category', p_category,
                       'expiresAt', case when v_ttl is null then null else public.ts_ms(now() + v_ttl) end)
      || case when v_anon then '{}'::jsonb else jsonb_build_object('userId', p_user) end);
  return public.ts_strike_points(p_user);
end;
$$;

-- Restore / reversed appeal: every live strike on the content goes, and so do its 'removal' notices.
create or replace function public.ts_revoke_strikes(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.strikes set revoked_at = now() where entity_type = p_entity_type and entity_id = p_entity_id and revoked_at is null;
  get diagnostics v_n = row_count;
  update public.user_sanctions set lifted_at = now()
  where kind = 'removal' and entity_type = p_entity_type and entity_id = p_entity_id and lifted_at is null;
  if v_n > 0 then
    perform public.ts_audit(null, 'system', 'strike_revoke', p_entity_type, p_entity_id::text, null, null, null, null, jsonb_build_object('revoked', v_n));
  end if;
end;
$$;

-- A sanction on an account. For Buzz content (anon origin) the audit row targets the content, not the person, and a
-- warning or mute on a non-P0 item starts 5-30 minutes later, so its start cannot be matched to the staff action.
-- Its notice shows when it starts. A ban also puts the address on banned_emails; a suspension or a ban ends the
-- person's sessions (where Supabase Auth's tables are reachable).
create or replace function public.ts_apply_sanction(
  p_user uuid, p_kind text, p_duration interval, p_scope text, p_category text, p_entity_type text, p_entity_id uuid,
  p_actor uuid, p_actor_role text, p_action_id uuid, p_delayed boolean, p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_action public.moderation_actions;
  v_type text := p_entity_type;
  v_entity uuid := p_entity_id;
  v_queue public.mod_queue;
  v_anon boolean;
  v_delay boolean := false;
  v_effective timestamptz;
  v_expires timestamptz;
  v_scope text := case when p_scope in ('all', 'buzz_only', 'requests') then p_scope else 'all' end;
  v_snapshot jsonb := p_snapshot;
  v_id uuid;
  v_email text;
  v_label text;
begin
  if p_kind not in ('warning', 'mute', 'suspension', 'ban') then
    perform public.ts_fail('validation_failed', 'Unknown sanction.');
  end if;
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform public.ts_fail('not_found', 'This account isn''t available.');
  end if;
  if p_action_id is not null then
    select * into v_action from public.moderation_actions where id = p_action_id;
    if v_type is null then
      v_type := v_action.entity_type;
      v_entity := v_action.entity_id;
    end if;
    select * into v_queue from public.mod_queue where id = v_action.queue_id;
  end if;
  v_anon := public.ts_is_anon(v_type) or public.ts_is_anon(v_queue.entity_type);
  if p_kind in ('warning', 'mute') then
    if p_delayed is true then
      v_delay := true;
    elsif p_delayed is null and v_anon then
      v_delay := coalesce(v_queue.priority, (select q.priority from public.mod_queue q where q.entity_type = v_type and q.entity_id = v_entity order by q.created_at desc limit 1), 'p2') <> 'p0';
    end if;
  end if;
  v_effective := now() + case when v_delay then make_interval(secs => 300 + floor(random() * 1501)) else interval '0' end;
  v_expires := case p_kind
    when 'mute' then v_effective + coalesce(p_duration, interval '24 hours')
    when 'suspension' then v_effective + coalesce(p_duration, interval '7 days')
  end;
  if v_snapshot is null and v_entity is not null then
    v_snapshot := public.ts_snapshot(v_type, v_entity);
  end if;

  insert into public.user_sanctions (user_id, kind, scope, origin, category, entity_type, entity_id, content_excerpt, content_label, action_id, actor_id,
                                     starts_at, effective_at, expires_at)
  values (p_user, p_kind, v_scope, case when v_anon then 'anon' else 'public' end, p_category, v_type, v_entity,
          nullif(public.ts_excerpt(v_snapshot), ''), v_snapshot ->> 'label', p_action_id, p_actor, v_effective, v_effective, v_expires)
  returning id into v_id;
  if p_action_id is not null then
    update public.moderation_actions set sanction_id = coalesce(sanction_id, v_id) where id = p_action_id;
  end if;
  perform public.ts_audit(p_actor, coalesce(p_actor_role, 'system'), 'sanction_apply',
    case when v_anon then coalesce(v_type, 'queue') else 'user' end,
    case when v_anon then coalesce(v_entity::text, v_queue.id::text) else p_user::text end,
    v_queue.id, null, null, null,
    jsonb_build_object('sanctionId', v_id, 'kind', p_kind, 'scope', v_scope, 'category', p_category,
                       'durationMs', case when p_duration is null then null else floor(extract(epoch from p_duration) * 1000)::bigint end,
                       'effectiveAt', public.ts_ms(v_effective), 'endsAt', public.ts_ms(v_expires))
      || case when not v_anon and v_entity is not null then jsonb_build_object('entityType', v_type, 'entityId', v_entity) else '{}'::jsonb end);

  v_label := coalesce(v_snapshot ->> 'label', 'post');
  perform public.ts_notify(
    p_user, 'moderation',
    case p_kind
      when 'warning' then 'You received a warning about ' || public.ts_category_label(p_category) || '.'
      when 'mute' then 'You''re muted for ' || public.ts_duration_text(v_expires - v_effective) || '.'
      when 'suspension' then 'Your account is suspended for ' || public.ts_duration_text(v_expires - v_effective) || '.'
      else 'Your account has been permanently banned.'
    end,
    case p_kind
      when 'warning' then 'No restrictions this time. Read it in Account status before you post again.'
      when 'mute' then 'You can still read and vote, but you can''t post. Reason: ' || public.ts_category_label(p_category) || '.'
      when 'suspension' then 'Reason: ' || public.ts_category_label(p_category) || '. You can appeal once.'
      else 'Reason: ' || public.ts_category_label(p_category) || '. You can appeal once within 14 days.'
    end,
    '/settings/account-status',
    jsonb_build_object('event', case p_kind when 'warning' then 'warning' when 'mute' then 'muted' when 'suspension' then 'suspended' else 'banned' end,
                       'sanctionId', v_id, 'kind', p_kind, 'scope', v_scope, 'category', p_category, 'until', public.ts_ms(v_expires)),
    v_effective);

  if p_kind = 'ban' then
    select u.email into v_email from auth.users u where u.id = p_user;
    if v_email is not null then
      insert into public.banned_emails (email_hash) values (public.ts_email_hash(v_email)) on conflict (email_hash) do nothing;
    end if;
  end if;
  if p_kind in ('suspension', 'ban') and to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions where user_id = $1' using p_user;
    exception when others then
      null; -- no rights on Auth's tables here: the posting checks still hold the account
    end;
  end if;
  return v_id;
end;
$$;

-- Lift (a no-op when already lifted). The last ban lifted takes the address off banned_emails.
create or replace function public.ts_lift_sanction(p_id uuid, p_actor uuid, p_actor_role text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_s public.user_sanctions;
  v_queue uuid;
  v_email text;
begin
  select * into v_s from public.user_sanctions where id = p_id for update;
  if not found then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if v_s.lifted_at is not null then
    return;
  end if;
  update public.user_sanctions set lifted_at = now(), lifted_by = p_actor where id = p_id;
  if v_s.kind = 'ban' and not exists (
    select 1 from public.user_sanctions s where s.user_id = v_s.user_id and s.kind = 'ban' and s.lifted_at is null and s.id <> p_id
  ) then
    select u.email into v_email from auth.users u where u.id = v_s.user_id;
    if v_email is not null then
      delete from public.banned_emails where email_hash = public.ts_email_hash(v_email);
    end if;
  end if;
  select a.queue_id into v_queue from public.moderation_actions a where a.id = v_s.action_id;
  perform public.ts_audit(p_actor, coalesce(p_actor_role, 'system'), 'sanction_lift',
    case when v_s.origin = 'anon' then coalesce(v_s.entity_type, 'queue') else 'user' end,
    case when v_s.origin = 'anon' then coalesce(v_s.entity_id::text, v_queue::text) else v_s.user_id::text end,
    v_queue, null, null, null, jsonb_build_object('sanctionId', p_id, 'kind', v_s.kind));
end;
$$;

-- Set the content's status and tell its author: hidden, removed, or back up (an approval of content that was never
-- hidden sends nothing). The author is looked up before a removal deletes public content.
create or replace function public.ts_apply_content_status(
  p_entity_type text, p_entity_id uuid, p_status text, p_immune boolean, p_category text, p_sanction uuid, p_before jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb := coalesce(p_before, public.ts_snapshot(p_entity_type, p_entity_id));
  v_author uuid;
  v_event text;
  v_label text;
  v_category text;
begin
  if v_before is null then
    perform public.ts_fail('not_found', 'That content isn''t available.');
  end if;
  v_author := public.ts_author_of(p_entity_type, p_entity_id);
  perform public.ts_set_content_status(p_entity_type, p_entity_id, p_status, p_immune);
  if p_status = 'active' then
    v_event := case when v_before ->> 'status' in ('hidden', 'removed') then 'content_restored' end;
  elsif p_status is distinct from v_before ->> 'status' then
    v_event := case p_status when 'hidden' then 'content_hidden' when 'removed' then 'content_removed' end;
  end if;
  if v_event is null then
    return;
  end if;
  v_label := coalesce(v_before ->> 'label', 'post');
  v_category := coalesce(p_category, (select q.category from public.mod_queue q where q.entity_type = p_entity_type and q.entity_id = p_entity_id
                                      order by case when q.status <> 'closed' then 0 else 1 end, q.created_at desc limit 1));
  perform public.ts_notify(
    v_author, 'moderation',
    case v_event
      when 'content_restored' then 'Your ' || v_label || ' is back up.'
      when 'content_hidden' then 'Your ' || v_label || ' is hidden while our team reviews it.'
      else 'Your ' || v_label || ' was removed for breaking our guideline on ' || public.ts_category_label(v_category) || '.'
    end,
    case when v_event = 'content_restored' then null else nullif('“' || public.ts_excerpt(v_before) || '”', '“”') end,
    '/settings/account-status',
    jsonb_build_object('event', v_event, 'label', v_label, 'category', v_category, 'sanctionId', p_sanction, 'anonymous', public.ts_is_anon(p_entity_type)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Reports and auto-hide (UniVerse lib/reports.ts)
-- -----------------------------------------------------------------------------
-- UniVerse safety 3.2 over weighted DISTINCT eligible reporters (open reports; weights capped at 2, and at least two
-- reporters, so one trusted reporter alone never hides anything). Buzz, Buzz replies and comments hide at 3, posts at 5,
-- listings at 4 (2 when every report says spam); 2 reports of a threat, a minor or doxxing hide anything; content the
-- engine flagged hides one report sooner (never below 2). Reason self_harm never hides; messages and profiles never
-- hide; content staff approved never hides again. Buzz is hidden through its adapter and its author told. Public
-- content has no hidden state: reaching the threshold raises its queue item to P1 instead.
create or replace function public.ts_evaluate_auto_hide(p_entity_type text, p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  v_distinct int;
  v_weighted int;
  v_p0 int;
  v_all_spam boolean;
  v_threshold int;
  v_queue public.mod_queue;
  v_next text;
begin
  if p_entity_type in ('message', 'profile') or p_entity_id is null then
    return;
  end if;
  -- Reports name a Buzz reply 'buzz_comment' (CampConnect Admin's word); the queue and the events say 'buzz_reply'.
  p_entity_type := case when p_entity_type = 'buzz_comment' then 'buzz_reply' else p_entity_type end;
  s := public.ts_snapshot(p_entity_type, p_entity_id);
  if s is null or s ->> 'status' <> 'active' or coalesce((s ->> 'autoHideImmune')::boolean, false) then
    return;
  end if;
  select count(*), coalesce(sum(w), 0), coalesce(sum(w) filter (where reason in ('threat', 'minor_safety', 'doxxing')), 0),
         coalesce(bool_and(reason in ('spam_scam', 'spam', 'scam')), false)
  into v_distinct, v_weighted, v_p0, v_all_spam
  from (
    select r.reporter_id, max(least(r.weight, 2)) as w, (array_agg(r.reason order by r.weight desc, r.created_at))[1] as reason
    from public.reports r
    where r.target_type in (p_entity_type, case when p_entity_type = 'buzz_reply' then 'buzz_comment' end) and r.target_id = p_entity_id
      and r.status = 'open' and r.eligible and r.weight > 0 and r.reason <> 'self_harm'
    group by r.reporter_id
  ) d;
  if v_distinct < 2 then
    return;
  end if;
  v_threshold := case
    when p_entity_type in ('buzz', 'buzz_reply', 'buzz_comment', 'comment') then 3
    when p_entity_type in ('apartment', 'item', 'roommate') then case when v_all_spam then 2 else 4 end
    else 5
  end;
  if exists (select 1 from public.mod_queue q where q.entity_type = p_entity_type and q.entity_id = p_entity_id and q.source in ('rule_flag', 'ai_flag'))
     or exists (select 1 from public.moderation_events e where e.entity_type = p_entity_type and e.entity_id = p_entity_id and e.action = 'flag') then
    v_threshold := greatest(2, v_threshold - 1);
  end if;
  if not (v_weighted >= v_threshold or v_p0 >= 2) then
    return;
  end if;

  select * into v_queue from public.mod_queue q where q.entity_type = p_entity_type and q.entity_id = p_entity_id and q.status <> 'closed';
  if public.ts_is_anon(p_entity_type) then
    perform public.ts_apply_content_status(p_entity_type, p_entity_id, 'hidden', null, v_queue.category, null, s);
    if v_queue.id is not null then
      v_next := public.ts_priority_raise(v_queue.priority);
      if v_next > 'p1' then
        v_next := 'p1';
      end if;
      update public.mod_queue set priority = least(priority, v_next) where id = v_queue.id;
    end if;
  elsif v_queue.id is not null then
    update public.mod_queue set priority = least(priority, 'p1') where id = v_queue.id;
  end if;
end;
$$;

-- Every new report, from the API (public content) or from ts_file_report() (Buzz): the server's columns are the
-- server's; a repeat is a quiet no-op; the content must exist and not be the reporter's own; eligibility and weight
-- per UniVerse (account 24 h+, not muted/suspended/banned, trust not low, not the author, and for public content not
-- blocked either way: Buzz never looks at blocks); 20 reports a day (10 for accounts under 72 hours); and the queue
-- item is filed (P0 'wellbeing' for "I'm worried about this person").
create or replace function public.ts_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  v_anon boolean := public.ts_is_anon(new.target_type);
  v_author uuid;
  v_created timestamptz;
  v_reporter_uni uuid;
  v_trust text;
  v_eligible boolean;
  v_priority text;
  v_count int;
begin
  new.status := 'open';
  new.closed_at := null;
  new.bad_faith := false;
  new.queue_id := null;
  new.created_at := now();
  new.details := nullif(btrim(coalesce(new.details, '')), '');
  -- A Buzz report straight from the API is left alone here: the insert policy refuses it. Buzz is reported through
  -- buzz_v2_report -> ts_file_report(), which marks its insert with ts.filing_report.
  if v_anon and auth.uid() is not null and coalesce(current_setting('ts.filing_report', true), '') <> 'on' then
    return new;
  end if;
  if new.reporter_id is null then
    perform public.ts_fail_for(new.target_type, 'unauthenticated', 'Log in to report.');
  end if;
  if exists (select 1 from public.reports r where r.reporter_id = new.reporter_id and r.target_type = new.target_type and r.target_id = new.target_id) then
    return null;
  end if;
  select p.created_at, p.university_id into v_created, v_reporter_uni from public.profiles p where p.id = new.reporter_id;
  select count(*) into v_count from public.reports r where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day';
  if v_count >= (case when v_created > now() - interval '72 hours' then 10 else 20 end) then
    perform public.ts_fail_for(new.target_type, 'rate_limited', 'You''ve sent a lot of reports today. Try again tomorrow.');
  end if;
  s := public.ts_snapshot(new.target_type, new.target_id);
  if s is null then
    perform public.ts_fail_for(new.target_type, 'not_found', case when v_anon then 'That buzz isn''t available.' else 'That content isn''t available.' end);
  end if;
  v_author := public.ts_author_of(new.target_type, new.target_id);
  if v_author = new.reporter_id then
    perform public.ts_fail_for(new.target_type, case when v_anon then 'own_item' else 'validation_failed' end,
      case when v_anon then 'You can''t report your own buzz.' else 'You can''t report your own content.' end);
  end if;
  v_trust := public.ts_reporter_trust(new.reporter_id);
  v_eligible := v_created is not null and v_created <= now() - interval '24 hours' and v_trust <> 'low'
    and not exists (
      select 1 from public.user_sanctions x
      where x.user_id = new.reporter_id and x.kind in ('mute', 'suspension', 'ban') and x.lifted_at is null
        and x.effective_at <= now() and (x.expires_at is null or x.expires_at > now())
    )
    and (v_anon or v_author is null or not exists (
      select 1 from public.blocks b
      where (b.blocker_id = new.reporter_id and b.blocked_id = v_author) or (b.blocker_id = v_author and b.blocked_id = new.reporter_id)
    ));
  if v_eligible and to_regclass('public.account_restrictions') is not null then
    v_eligible := not public.is_suspended(new.reporter_id);
  end if;
  new.eligible := v_eligible;
  new.weight := case when not v_eligible then 0 when v_trust = 'high' then 2 else 1 end;
  new.university_id := coalesce(public.ts_uuid(s ->> 'universityId'), new.university_id, v_reporter_uni);
  if not (new.target_type in ('apartment', 'item', 'roommate') and new.reason in ('spam_scam', 'spam', 'scam')) then
    new.sub_reason := null;
  else
    new.sub_reason := left(new.sub_reason, 40);
  end if;
  v_priority := public.ts_reason_priority(new.reason);
  if new.target_type = 'profile' and (
    select count(distinct r.reporter_id) from public.reports r
    where r.target_type = 'profile' and r.target_id = new.target_id and r.created_at > now() - interval '7 days'
  ) + 1 >= 5 then
    v_priority := least(v_priority, 'p1');
  end if;
  new.queue_id := public.ts_enqueue(
    new.target_type, new.target_id, coalesce(s ->> 'surface', new.target_type), new.university_id, v_author, 'user_report',
    public.ts_reason_category(new.reason), 'none', v_priority, case when new.reason = 'self_harm' then 'wellbeing' end,
    '[]'::jsonb, null, 1, new.weight);
  return new;
end;
$$;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports for each row execute function public.ts_reports_before_insert();

create or replace function public.ts_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A report is never lost to an auto-hide failure (UniVerse evaluateAutoHide never throws).
  begin
    perform public.ts_evaluate_auto_hide(new.target_type, new.target_id);
  exception when others then
    raise warning 'auto-hide of % % failed: %', new.target_type, new.target_id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports for each row execute function public.ts_reports_after_insert();

-- File a report (migration 42's buzz_v2_report calls this). Idempotent: a repeat answers {alreadyReported: true}.
-- "Something else" needs a note of 10+ characters; notes stop at 500.
create or replace function public.ts_file_report(p_reporter uuid, p_entity_type text, p_entity_id uuid, p_reason text, p_note text, p_university uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case when p_entity_type = 'buzz_comment' then 'buzz_reply' else p_entity_type end;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_filed boolean;
begin
  if p_reporter is null then
    perform public.ts_fail_for(v_type, 'unauthenticated', 'Log in to report.');
  end if;
  if v_type is null or v_type not in ('apartment', 'item', 'roommate', 'profile', 'message', 'comment', 'post', 'buzz', 'buzz_reply') then
    perform public.ts_fail('validation_failed', 'That can''t be reported.');
  end if;
  if p_reason is null or p_reason not in ('self_harm', 'threat', 'minor_safety', 'doxxing', 'harassment', 'hate', 'sexual', 'drugs_illegal',
                                          'impersonation', 'spam_scam', 'academic_dishonesty', 'other')
     and not (not public.ts_is_anon(v_type) and p_reason in ('spam', 'scam', 'inappropriate')) then
    perform public.ts_fail_for(v_type, 'validation_failed', 'Pick a reason.');
  end if;
  if p_reason = 'other' and char_length(coalesce(v_note, '')) < 10 then
    perform public.ts_fail_for(v_type, 'validation_failed', 'Tell us a bit more (at least 10 characters).');
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    perform public.ts_fail_for(v_type, 'validation_failed', 'Keep the note under 500 characters.');
  end if;
  -- A reply's report is stored as 'buzz_comment', the type CampConnect Admin's report queue reads.
  if exists (select 1 from public.reports r where r.reporter_id = p_reporter and r.target_type in (v_type, case when v_type = 'buzz_reply' then 'buzz_comment' end)
             and r.target_id = p_entity_id) then
    return jsonb_build_object('alreadyReported', true);
  end if;
  perform set_config('ts.filing_report', 'on', true);
  insert into public.reports (reporter_id, target_type, target_id, reason, details, university_id)
  values (p_reporter, case when v_type = 'buzz_reply' then 'buzz_comment' else v_type end, p_entity_id, p_reason, v_note, p_university);
  v_filed := found;
  perform set_config('ts.filing_report', 'off', true);
  return jsonb_build_object('alreadyReported', not v_filed);
end;
$$;

-- Reports filed before this migration get their queue items (they were never reviewable before). They carry no weight.
do $$
declare
  r record;
  v_type text;
  v_author uuid;
  v_uni uuid;
  v_exists boolean;
  v_queue uuid;
begin
  for r in select * from public.reports where queue_id is null and status = 'open' order by created_at loop
    v_type := case when r.target_type = 'buzz_comment' then 'buzz_reply' else r.target_type end;
    v_author := null;
    v_uni := null;
    v_exists := true;
    if r.target_type = 'buzz' then
      select b.author_id, b.university_id into v_author, v_uni from public.buzz_posts b where b.id = r.target_id;
      v_exists := found;
    elsif r.target_type in ('buzz_comment', 'buzz_reply') then
      select c.author_id, b.university_id into v_author, v_uni from public.buzz_comments c join public.buzz_posts b on b.id = c.post_id where c.id = r.target_id;
      v_exists := found;
    else
      v_exists := public.ts_public_snapshot(r.target_type, r.target_id) is not null;
      v_author := public.ts_public_author_of(r.target_type, r.target_id);
      v_uni := public.ts_uuid(public.ts_public_snapshot(r.target_type, r.target_id) ->> 'universityId');
    end if;
    if not v_exists then
      continue;
    end if;
    v_queue := public.ts_enqueue(v_type, r.target_id, v_type, v_uni, v_author, 'user_report', public.ts_reason_category(r.reason), 'none',
                                 public.ts_reason_priority(r.reason), case when r.reason = 'self_harm' then 'wellbeing' end, '[]'::jsonb, null, 1, 0);
    update public.reports set queue_id = v_queue, university_id = coalesce(university_id, v_uni) where id = r.id;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 11. Staff serializers (the firewall lives here)
-- -----------------------------------------------------------------------------
-- Conflict of interest and legal hold (UniVerse queueVisibleTo): never content you wrote, reported or are in the chat
-- of; escalated and legal-hold items for admins only.
create or replace function public.ts_queue_visible(q public.mod_queue, p_viewer uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (q.author_id is null or q.author_id <> p_viewer)
    and not exists (
      select 1 from public.reports rp
      where rp.reporter_id = p_viewer and rp.target_id = q.entity_id
        and rp.target_type in (q.entity_type, case when q.entity_type = 'buzz_reply' then 'buzz_comment' end)
    )
    and not (q.entity_type = 'message' and exists (
      select 1 from public.messages m join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = q.entity_id and cm.user_id = p_viewer
    ))
    and (p_role = 'admin' or (not q.legal_hold and q.status <> 'escalated'));
$$;

-- StaffQueueItem: no author, reporter or user field of any kind, for any content type. Buzz items' times are cut to
-- the minute.
create or replace function public.ts_queue_item_json(q public.mod_queue, p_viewer uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lease boolean := q.status <> 'closed' and q.claimed_by is not null and q.claimed_at > now() - interval '10 minutes';
  v_anon boolean := public.ts_is_anon(q.entity_type);
begin
  return jsonb_build_object(
    'id', q.id,
    'entityType', q.entity_type,
    'entityId', q.entity_id,
    'surface', q.surface,
    'anon', v_anon,
    'universityShortName', coalesce(public.ts_university_name(q.university_id), 'Campus'),
    'source', q.source,
    'category', q.category,
    'severity', q.severity,
    'priority', q.priority,
    'label', q.label,
    'status', case when q.status = 'claimed' and not v_lease then 'open' else q.status end,
    'resolution', q.resolution,
    'reportCount', q.report_count,
    'appealId', q.appeal_id,
    'excerpt', public.ts_excerpt(p_snapshot, q.blocked_text),
    'contentStatus', p_snapshot ->> 'status',
    'claimedByMe', v_lease and q.claimed_by = p_viewer,
    'claimedByOther', v_lease and q.claimed_by <> p_viewer,
    'slaDueAt', case when v_anon then public.ts_minute_ms(q.created_at + public.ts_sla(q.priority)) else public.ts_ms(q.created_at + public.ts_sla(q.priority)) end,
    'createdAt', case when v_anon then public.ts_minute_ms(q.created_at) else public.ts_ms(q.created_at) end,
    'closedAt', case when v_anon then public.ts_minute_ms(q.closed_at) else public.ts_ms(q.closed_at) end);
end;
$$;

-- Blind standing (every role): built ONLY from anon-origin rows, the Buzz persona's own history, in buckets. Nothing
-- staff can see or change on a named account may move it, or it becomes a guess-the-author oracle.
create or replace function public.ts_blind_standing(p_author uuid, p_current uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'kind', 'blind',
    'accountAge', (
      select case
        when p.created_at is null then '30d+'
        when p.created_at > now() - interval '24 hours' then '<24h'
        when p.created_at > now() - interval '7 days' then '<7d'
        when p.created_at > now() - interval '30 days' then '<30d'
        else '30d+' end
      from (select (select x.created_at from public.profiles x where x.id = p_author) as created_at) p),
    'strikePoints', public.ts_bucket((
      select coalesce(sum(s.points), 0) from public.strikes s
      where s.user_id = p_author and s.origin = 'anon' and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))),
    'priorByCategory', coalesce((
      select jsonb_object_agg(c.category, public.ts_bucket(c.n)) from (
        select s.category, count(*) as n from public.strikes s
        where s.user_id = p_author and s.origin = 'anon' and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
        group by s.category) c), '{}'::jsonb),
    'sanction', (
      select s.kind from public.user_sanctions s
      where s.user_id = p_author and s.origin = 'anon' and s.kind in ('mute', 'suspension', 'ban') and s.lifted_at is null
        and s.effective_at <= now() and (s.expires_at is null or s.expires_at > now())
      order by case s.kind when 'ban' then 0 when 'suspension' then 1 else 2 end
      limit 1),
    'otherOpenItems', public.ts_bucket((
      select count(*) from public.mod_queue q
      where q.author_id = p_author and q.status <> 'closed' and public.ts_is_anon(q.entity_type) and q.id is distinct from p_current)));
$$;

-- A sanction as staff see it: the person's own SanctionNotice WITHOUT the excerpt and label, plus origin. An
-- anon-origin row carries day-floored times and a sealed id instead of its own (its real id sits in content-targeted
-- audit rows, and joining the two would be an unmask without a reason).
create or replace function public.ts_staff_sanction_json(s public.user_sanctions, p_appeal_status text, p_id_override text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_anon boolean := s.origin = 'anon';
  v_until timestamptz := case when s.lifted_at is not null then least(coalesce(s.expires_at, s.lifted_at), s.lifted_at) else s.expires_at end;
  v_deadline timestamptz := case when s.kind = 'warning' then null else s.created_at + interval '14 days' end;
  v_status text := coalesce(p_appeal_status, 'none');
begin
  return jsonb_build_object(
    'id', coalesce(p_id_override, case when v_anon then 'sx_' || public.ts_seal('staff-sanction', s.id::text) else s.id::text end),
    'kind', s.kind,
    'scope', s.scope,
    'category', s.category,
    'guidelineAnchor', public.ts_guideline_anchor(s.category),
    'startsAt', case when v_anon then public.ts_day_ms(s.effective_at) else public.ts_ms(s.effective_at) end,
    'until', case when v_anon then public.ts_day_ms(v_until) else public.ts_ms(v_until) end,
    'acknowledgedAt', case when v_anon then public.ts_day_ms(s.acknowledged_at) else public.ts_ms(s.acknowledged_at) end,
    'liftedAt', case when v_anon then public.ts_day_ms(s.lifted_at) else public.ts_ms(s.lifted_at) end,
    -- computed here: an anon-origin row's day-floored times cannot tell
    'inEffect', s.kind in ('mute', 'suspension', 'ban') and s.lifted_at is null and s.effective_at <= now() and (s.expires_at is null or s.expires_at > now()),
    'liftable', s.kind <> 'removal' and s.lifted_at is null and (s.expires_at is null or s.expires_at > now()),
    'canAppeal', v_deadline is not null and v_status = 'none' and s.lifted_at is null and now() <= v_deadline,
    'appealStatus', v_status,
    'appealDeadline', case when v_anon then public.ts_day_ms(v_deadline) else public.ts_ms(v_deadline) end,
    'createdAt', case when v_anon then public.ts_day_ms(s.created_at) else public.ts_ms(s.created_at) end,
    'origin', s.origin);
end;
$$;

-- Staff standing of a named account (UniVerse staffStandingFor). Moderators: anon-origin sanctions and strikes are
-- left out entirely and out of every count, and the status comes from public-origin rows only, so acting on a buzz
-- changes nothing a moderator can see about anyone. Admins: everything, anon-origin rows sealed and day-floored.
create or replace function public.ts_staff_standing(p_user uuid, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin boolean := p_role = 'admin';
  v_sanctions jsonb;
  v_points int;
  v_open int;
  v_status text;
begin
  select coalesce(jsonb_agg(public.ts_staff_sanction_json(s, coalesce(a.status, 'none')) order by s.created_at desc, s.id desc), '[]'::jsonb)
  into v_sanctions
  from public.user_sanctions s
  left join public.appeals a on a.sanction_id = s.id
  where s.user_id = p_user and (v_admin or s.origin = 'public');

  if v_admin then
    v_points := public.ts_strike_points(p_user);
  else
    select coalesce(sum(s.points), 0)::int into v_points from public.strikes s
    where s.user_id = p_user and s.origin = 'public' and s.revoked_at is null and (s.expires_at is null or s.expires_at > now());
  end if;
  select count(*)::int into v_open from public.mod_queue q
  where q.author_id = p_user and q.status <> 'closed' and (v_admin or not public.ts_is_anon(q.entity_type));
  select case
      when bool_or(s.kind = 'ban') then 'banned'
      when bool_or(s.kind = 'suspension') then 'suspended'
      else 'active' end
  into v_status
  from public.user_sanctions s
  where s.user_id = p_user and s.kind in ('ban', 'suspension') and s.lifted_at is null and s.effective_at <= now()
    and (s.expires_at is null or s.expires_at > now()) and (v_admin or s.origin = 'public');
  return jsonb_build_object('strikePoints', v_points, 'openQueueItems', v_open, 'sanctions', v_sanctions, 'status', coalesce(v_status, 'active'));
end;
$$;

create or replace function public.ts_user_summary_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'username', p.username, 'avatarUrl', p.avatar_url)
  from public.profiles p where p.id = p_user;
$$;

-- StaffUserDetail. A named account, so: no Buzz text, ever, and (moderators) no anon-origin row or count. Email for
-- admins only.
create or replace function public.ts_staff_user_json(p_user uuid, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_standing jsonb := public.ts_staff_standing(p_user, p_role);
  v_profile jsonb;
begin
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'username', p.username, 'avatarUrl', p.avatar_url,
                            'universityName', public.ts_university_name(p.university_id, false), 'createdAt', public.ts_ms(p.created_at))
  into v_profile
  from public.profiles p where p.id = p_user;
  if v_profile is null then
    return null;
  end if;
  return jsonb_build_object(
    'user', v_profile,
    'email', case when p_role = 'admin' then (select u.email from auth.users u where u.id = p_user) end,
    'role', coalesce(public.ts_role_of(p_user), 'user'),
    'status', v_standing ->> 'status',
    'strikePoints', (v_standing ->> 'strikePoints')::int,
    'sanctions', v_standing -> 'sanctions',
    'openQueueItems', (v_standing ->> 'openQueueItems')::int);
end;
$$;

-- AuditRow (UniVerse serializeAuditRow): a 'user' target tied to a Buzz queue item shows no id (except an admin
-- reading a buzz_unmask row); moderators never get buzz_unmask metadata, and get anon-origin metadata stripped.
create or replace function public.ts_audit_row_json(a public.audit_log, p_admin boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_queue_type text := (select q.entity_type from public.mod_queue q where q.id = a.queue_id);
  v_anon boolean := public.ts_is_anon(v_queue_type) or (a.target_type is not null and a.target_type <> 'user' and public.ts_is_anon(a.target_type));
  v_actor jsonb := null;
begin
  if a.actor_id is not null then
    v_actor := jsonb_build_object('id', a.actor_id, 'displayName', coalesce((select p.full_name from public.profiles p where p.id = a.actor_id), 'Staff'),
                                  'role', a.actor_role);
  end if;
  return jsonb_build_object(
    'id', a.id,
    'actor', v_actor,
    'action', a.action,
    'targetType', a.target_type,
    'targetId', case when a.target_type = 'user' and public.ts_is_anon(v_queue_type) and not (p_admin and a.action = 'buzz_unmask') then null else a.target_id end,
    'queueId', a.queue_id,
    'batchId', a.batch_id,
    'reasonCode', a.reason_code,
    'reason', a.reason,
    'metadata', case when a.action = 'buzz_unmask' and not p_admin then null when v_anon and not p_admin then public.ts_strip_identity(a.metadata) else a.metadata end,
    'createdAt', public.ts_ms(a.created_at));
end;
$$;

-- StaffAppeal: reviewed blind, no user field, ever. An anon-origin appeal carries the appealed content (so it can be
-- judged) but its sanction id becomes the appeal id and its times are day-floored.
create or replace function public.ts_appeal_json(p_appeal uuid, p_viewer uuid, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.appeals;
  s public.user_sanctions;
  v_action_actor uuid;
  v_anon boolean;
  v_can boolean;
begin
  select * into a from public.appeals where id = p_appeal;
  if not found then
    return null;
  end if;
  select * into s from public.user_sanctions where id = a.sanction_id;
  select m.actor_id into v_action_actor from public.moderation_actions m where m.id = s.action_id;
  v_anon := s.origin = 'anon';
  v_can := a.status = 'open' and a.user_id <> p_viewer and v_action_actor is distinct from p_viewer and s.actor_id is distinct from p_viewer
    and (s.kind not in ('suspension', 'ban') or p_role = 'admin');
  return jsonb_build_object(
    'id', a.id,
    'sanction', public.ts_staff_sanction_json(s, a.status, case when v_anon then a.id::text end),
    'contentExcerpt', s.content_excerpt,
    'contentLabel', s.content_label,
    'text', a.text,
    'status', a.status,
    'createdAt', case when v_anon then public.ts_day_ms(a.created_at) else public.ts_ms(a.created_at) end,
    'queueId', (select q.id from public.mod_queue q where q.appeal_id = a.id order by q.created_at desc limit 1),
    'canReview', v_can);
end;
$$;

-- An escalated blocked write (no content) whose author an admin may reveal: a threat of violence or a self-harm risk.
create or replace function public.ts_unmaskable_blocked(q public.mod_queue)
returns boolean
language sql
stable
as $$
  select coalesce(public.ts_is_anon(q.entity_type) and q.entity_id is null and q.blocked_text is not null and q.author_id is not null and q.source <> 'appeal'
    and (q.category in ('threat_violence', 'self_harm') or q.label = 'wellbeing'), false);
$$;

-- The UniVerse ladder suggestion (safety 4.2). On Buzz items it quotes a blind bucket, never the exact tally, and
-- counts only the Buzz persona's own anon-origin history (for every role); on public items it uses the numbers the
-- viewer's own author panel shows.
create or replace function public.ts_suggestion(q public.mod_queue, p_author uuid, p_has_content boolean, p_visible_points int, p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_anon boolean := public.ts_is_anon(q.entity_type);
  v_severity text := case when q.severity = 'none' then 'low' else q.severity end;
  v_current int;
  v_after int;
  v_prior boolean;
  v_kind text;
  v_action text;
  v_step text;
  v_tally text;
begin
  if q.source = 'appeal' or q.appeal_id is not null then
    return null;
  end if;
  if q.category = 'self_harm' or q.label = 'wellbeing' then
    return jsonb_build_object('action', 'approve', 'reason', 'Wellbeing item: never a sanction. Check in, then approve or dismiss.');
  end if;
  if q.category is null then
    return null;
  end if;
  if v_anon then
    select coalesce(sum(s.points), 0)::int into v_current from public.strikes s
    where s.user_id = p_author and s.origin = 'anon' and s.revoked_at is null and (s.expires_at is null or s.expires_at > now());
    v_prior := exists (select 1 from public.user_sanctions s where s.user_id = p_author and s.origin = 'anon' and s.kind = 'warning' and s.lifted_at is null);
  else
    v_current := coalesce(p_visible_points, 0);
    v_prior := p_author is not null and exists (
      select 1 from public.user_sanctions s where s.user_id = p_author and s.kind = 'warning' and s.lifted_at is null and (p_role = 'admin' or s.origin = 'public'));
  end if;
  v_after := coalesce(v_current, 0) + case v_severity when 'critical' then 5 when 'high' then 3 when 'medium' then 2 else 1 end;
  if v_after <= 2 then
    v_kind := case when v_prior then 'removal' else 'warning' end;
    v_action := case when v_prior then 'remove' else 'remove_and_warn' end;
    v_step := case when v_prior then 'removal only' else 'warning' end;
  elsif v_after <= 4 then v_action := 'remove_and_mute_24h'; v_step := 'mute 24 hours';
  elsif v_after <= 6 then v_action := 'remove_and_mute_72h'; v_step := 'mute 72 hours';
  elsif v_after <= 8 then v_action := 'remove_and_mute_7d'; v_step := 'mute 7 days';
  elsif v_after <= 11 then v_action := 'suspend_7d'; v_step := 'suspension 7 days';
  elsif v_after <= 14 then v_action := 'suspend_30d'; v_step := 'suspension 30 days';
  else v_action := 'ban'; v_step := 'ban';
  end if;
  if not p_has_content and v_action in ('remove', 'remove_and_warn') then
    v_action := 'warn_only';
  end if;
  v_tally := case when v_anon then 'Strike points after this violation: ' || public.ts_bucket(v_after)
                  else v_after || ' active strike point' || case when v_after = 1 then '' else 's' end || ' after this violation' end;
  return jsonb_build_object('action', v_action, 'reason', v_tally || ' → ' || v_step || ' (safety ladder).');
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Staff: who may call
-- -----------------------------------------------------------------------------
-- Non-staff get 'not found' from every staff function, as if it did not exist (UniVerse answers 404, never 403).
-- Staff without a two-factor session get 'mfa_required' (they know they are staff; nobody else learns it).
create or replace function public.ts_require_staff()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_role_of(auth.uid());
begin
  if v_role is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if not public.ts_mfa_ok() then
    perform public.ts_fail('mfa_required', 'Confirm it''s you with your authenticator app to use the staff console.');
  end if;
  return v_role;
end;
$$;

-- Admin-only functions answer moderators 'not found' too.
create or replace function public.ts_require_admin()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.ts_role_of(auth.uid()) is distinct from 'admin' then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if not public.ts_mfa_ok() then
    perform public.ts_fail('mfa_required', 'Confirm it''s you with your authenticator app to use the staff console.');
  end if;
  return 'admin';
end;
$$;

-- An audit row once a day per staff member, item and kind of look (the detail is opened often).
create or replace function public.ts_audit_once_per_day(p_actor uuid, p_role text, p_action text, q public.mod_queue)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.audit_log a where a.actor_id = p_actor and a.action = p_action and a.queue_id = q.id and a.created_at > now() - interval '1 day') then
    return;
  end if;
  perform public.ts_audit(p_actor, p_role, p_action, q.entity_type, q.entity_id::text, q.id, null, null, null, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Staff: the queue
-- -----------------------------------------------------------------------------
-- Views: priority, wellbeing, held, auto_hidden, reports, escalated (admins), appeals, mine, closed (30 days, search
-- by id prefix). Filters: {surface, category, source, universityId, q}. Priority first, then oldest. held and
-- auto_hidden depend on the content's live status, so they look at no more than 2000 open items per call.
create or replace function public.console_queue(p_view text default 'priority', p_limit int default 30, p_offset int default 0, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_view text := case when p_view in ('priority', 'wellbeing', 'held', 'auto_hidden', 'reports', 'escalated', 'appeals', 'mine', 'closed') then p_view else 'priority' end;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_surface text := nullif(v_f ->> 'surface', '');
  v_category text := nullif(v_f ->> 'category', '');
  v_source text := nullif(v_f ->> 'source', '');
  v_uni uuid := public.ts_uuid(v_f ->> 'universityId');
  v_q text := nullif(regexp_replace(lower(coalesce(v_f ->> 'q', '')), '[^0-9a-f-]', '', 'g'), '');
  v_items jsonb := '[]'::jsonb;
  v_seen int := 0;
  v_more boolean := false;
  v_snap jsonb;
  m public.mod_queue;
begin
  for m in
    select x.* from public.mod_queue x
    where case v_view
        when 'priority' then x.status <> 'closed'
        when 'wellbeing' then x.status <> 'closed' and x.label = 'wellbeing'
        when 'held' then x.status <> 'closed'
        when 'auto_hidden' then x.status <> 'closed'
        when 'reports' then x.status <> 'closed' and (x.source = 'user_report' or x.report_count > 0)
        when 'escalated' then x.status = 'escalated'
        when 'appeals' then x.status <> 'closed' and (x.source = 'appeal' or x.appeal_id is not null)
        when 'mine' then x.status <> 'closed' and x.claimed_by = v_me and x.claimed_at > now() - interval '10 minutes'
        else x.status = 'closed' and x.closed_at >= now() - interval '30 days'
      end
      and public.ts_queue_visible(x, v_me, v_role)
      and (v_surface is null or x.surface = v_surface)
      and (v_category is null or x.category = v_category)
      and (v_source is null or x.source = v_source)
      and (v_uni is null or x.university_id = v_uni)
      and (v_view <> 'closed' or v_q is null or x.id::text like v_q || '%')
    order by
      case when v_view = 'closed' then x.closed_at end desc nulls last,
      case when v_view <> 'closed' then x.priority end asc,
      case when v_view <> 'closed' then x.created_at end asc,
      x.id asc
    limit case when v_view in ('held', 'auto_hidden') then 2000 else v_offset + v_limit + 1 end
  loop
    v_snap := null;
    if v_view in ('held', 'auto_hidden') then
      v_snap := public.ts_snapshot(m.entity_type, m.entity_id);
      if v_view = 'held' and coalesce(v_snap ->> 'status', '') <> 'held' then
        continue;
      end if;
      if v_view = 'auto_hidden' and not (coalesce(v_snap ->> 'status', '') = 'hidden' or m.source in ('community_score', 'ai_flag')) then
        continue;
      end if;
    end if;
    v_seen := v_seen + 1;
    if v_seen <= v_offset then
      continue;
    end if;
    if jsonb_array_length(v_items) >= v_limit then
      v_more := true;
      exit;
    end if;
    if v_view not in ('held', 'auto_hidden') then
      v_snap := public.ts_snapshot(m.entity_type, m.entity_id);
    end if;
    v_items := v_items || public.ts_queue_item_json(m, v_me, v_snap);
  end loop;
  return jsonb_build_object('items', v_items, 'nextOffset', case when v_more then v_offset + v_limit end);
end;
$$;

create or replace function public.console_queue_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_out jsonb;
  v_held int := 0;
  v_hidden int := 0;
  v_status text;
  m public.mod_queue;
begin
  select jsonb_build_object(
    'priority', count(*) filter (where x.status <> 'closed'),
    'wellbeing', count(*) filter (where x.status <> 'closed' and x.label = 'wellbeing'),
    'reports', count(*) filter (where x.status <> 'closed' and (x.source = 'user_report' or x.report_count > 0)),
    'escalated', count(*) filter (where x.status = 'escalated'),
    'appeals', count(*) filter (where x.status <> 'closed' and (x.source = 'appeal' or x.appeal_id is not null)),
    'mine', count(*) filter (where x.status <> 'closed' and x.claimed_by = v_me and x.claimed_at > now() - interval '10 minutes'),
    'closed', count(*) filter (where x.status = 'closed' and x.closed_at >= now() - interval '30 days'))
  into v_out
  from public.mod_queue x
  where (x.status <> 'closed' or x.closed_at >= now() - interval '30 days') and public.ts_queue_visible(x, v_me, v_role);
  for m in
    select x.* from public.mod_queue x
    where x.status <> 'closed' and public.ts_queue_visible(x, v_me, v_role)
    order by x.priority, x.created_at
    limit 2000
  loop
    v_status := coalesce(public.ts_snapshot(m.entity_type, m.entity_id) ->> 'status', '');
    if v_status = 'held' then
      v_held := v_held + 1;
    end if;
    if v_status = 'hidden' or m.source in ('community_score', 'ai_flag') then
      v_hidden := v_hidden + 1;
    end if;
  end loop;
  return v_out || jsonb_build_object('held', v_held, 'auto_hidden', v_hidden);
end;
$$;

-- StaffQueueItemDetail. Opening an item claims it for 10 minutes (unless someone else holds it, or it is closed or
-- escalated). p_after_action: the caller just acted, so show the result without the visibility filter (an escalated
-- item leaves a moderator's queues) and claim nothing.
create or replace function public.ts_queue_detail(p_id uuid, p_viewer uuid, p_role text, p_after_action boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.mod_queue;
  v_admin boolean := p_role = 'admin';
  v_anon boolean;
  v_snap jsonb;
  v_matches jsonb;
  v_signals jsonb;
  v_fields jsonb;
  v_hits jsonb;
  v_context jsonb := null;
  v_reports jsonb;
  v_history jsonb;
  v_author uuid;
  v_author_json jsonb;
  v_standing jsonb;
  v_visible_points int := null;
  v_reveal boolean;
begin
  select * into q from public.mod_queue where id = p_id;
  if not found or (not p_after_action and not public.ts_queue_visible(q, p_viewer, p_role)) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if not p_after_action and q.status not in ('closed', 'escalated')
     and not (q.claimed_by is not null and q.claimed_by <> p_viewer and q.claimed_at > now() - interval '10 minutes') then
    update public.mod_queue set claimed_by = p_viewer, claimed_at = now(), status = case when status = 'open' then 'claimed' else status end
    where id = p_id
    returning * into q;
  end if;
  v_anon := public.ts_is_anon(q.entity_type);
  v_snap := public.ts_snapshot(q.entity_type, q.entity_id);

  -- the engine's matches (each knows its field), from every event of this content or, for blocked text, of that write
  select coalesce(jsonb_agg(case when jsonb_typeof(mm) = 'object' and not (mm ? 'field') then mm || jsonb_build_object('field', e.field) else mm end), '[]'::jsonb)
  into v_matches
  from public.moderation_events e
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.matches) = 'array' then e.matches else '[]'::jsonb end) mm
  where e.entity_type = q.entity_type
    and ((q.entity_id is not null and e.entity_id = q.entity_id)
      or (q.entity_id is null and e.entity_id is null and e.author_id = q.author_id and e.created_at between q.created_at - interval '1 minute' and q.created_at + interval '1 minute'));
  select e.signals into v_signals
  from public.moderation_events e
  where e.entity_type = q.entity_type
    and ((q.entity_id is not null and e.entity_id = q.entity_id)
      or (q.entity_id is null and e.entity_id is null and e.author_id = q.author_id and e.created_at between q.created_at - interval '1 minute' and q.created_at + interval '1 minute'))
  order by public.ts_severity_rank(e.severity) desc, e.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'field', f ->> 'field',
      'text', coalesce(f ->> 'text', ''),
      'spans', coalesce((
        select jsonb_agg(m -> 'span')
        from jsonb_array_elements(v_matches) m
        where coalesce(m ->> 'field', 'body') = coalesce(f ->> 'field', 'body')
          and jsonb_typeof(m -> 'span') = 'array' and jsonb_array_length(m -> 'span') = 2
      ), '[]'::jsonb)) order by o), '[]'::jsonb)
  into v_fields
  from jsonb_array_elements(case
      when v_snap is not null and jsonb_typeof(v_snap -> 'fields') = 'array' then v_snap -> 'fields'
      when q.blocked_text is not null then jsonb_build_array(jsonb_build_object('field', 'body', 'text', q.blocked_text))
      else '[]'::jsonb end) with ordinality as x(f, o);

  select coalesce(jsonb_agg(h order by n), '[]'::jsonb) into v_hits from (
    select jsonb_build_object('ruleId', m ->> 'ruleId', 'category', m ->> 'category', 'subcode', m ->> 'subcode', 'severity', m ->> 'severity') as h,
           min(o) as n
    from jsonb_array_elements(v_matches) with ordinality as y(m, o)
    where coalesce(m ->> 'ruleId', '') <> ''
    group by m ->> 'ruleId', m ->> 'category', m ->> 'subcode', m ->> 'severity'
    union all
    select jsonb_build_object('ruleId', r, 'category', q.category, 'subcode', 'rule', 'severity', q.severity), 100000 + o
    from jsonb_array_elements_text(q.rule_ids) with ordinality as z(r, o)
    where q.category is not null and not exists (select 1 from jsonb_array_elements(v_matches) m2 where m2 ->> 'ruleId' = r)
  ) hits;

  if q.entity_id is not null then
    v_context := public.ts_staff_context(q.entity_type, q.entity_id);
    if q.entity_type = 'message' and not p_after_action then
      perform public.ts_audit_once_per_day(p_viewer, p_role, 'dm_context_viewed', q);
    end if;
  end if;

  -- reporters: never named on Buzz content, for any role; on public content to admins only, audited
  v_reveal := v_admin and not v_anon;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'subReason', r.sub_reason,
      'note', case when v_anon then public.ts_scrub(r.details) else r.details end,
      'reporterTrust', public.ts_reporter_trust(r.reporter_id),
      'reporter', case when v_reveal then public.ts_user_summary_json(r.reporter_id) end,
      'createdAt', public.ts_ms(r.created_at)) order by r.created_at desc), '[]'::jsonb)
  into v_reports
  from (
    select * from public.reports r
    where q.entity_id is not null and r.target_id = q.entity_id
      and r.target_type in (q.entity_type, case when q.entity_type = 'buzz_reply' then 'buzz_comment' end)
    order by r.created_at desc limit 50
  ) r;
  if v_reveal and jsonb_array_length(v_reports) > 0 and not p_after_action then
    perform public.ts_audit_once_per_day(p_viewer, p_role, 'reporter_viewed', q);
  end if;

  -- history: actor names on public content for admins and for your own actions; the role only on Buzz content
  select coalesce(jsonb_agg(jsonb_build_object(
      'action', a.action,
      'actorRole', a.actor_role,
      'actorName', case when v_anon then null when a.actor_id is null then 'System'
                        when v_admin or a.actor_id = p_viewer then coalesce((select p.full_name from public.profiles p where p.id = a.actor_id), 'Staff') end,
      'note', case when v_anon then public.ts_scrub(a.note) else a.note end,
      'createdAt', public.ts_ms(a.created_at)) order by a.created_at, a.id), '[]'::jsonb)
  into v_history
  from (
    select * from public.moderation_actions a
    where a.queue_id = q.id or (q.entity_id is not null and a.entity_type = q.entity_type and a.entity_id = q.entity_id)
    order by a.created_at, a.id limit 100
  ) a;

  v_author := coalesce(q.author_id, case when q.entity_id is not null then public.ts_author_of(q.entity_type, q.entity_id) end);
  if not v_anon and v_author is not null and exists (select 1 from public.profiles p where p.id = v_author) then
    v_standing := public.ts_staff_standing(v_author, p_role);
    v_visible_points := (v_standing ->> 'strikePoints')::int;
    v_author_json := jsonb_build_object(
      'kind', 'public',
      'user', public.ts_user_summary_json(v_author),
      'accountAgeDays', greatest(0, floor(extract(epoch from (now() - (select p.created_at from public.profiles p where p.id = v_author))) / 86400))::int,
      'strikePoints', v_visible_points,
      'sanctions', v_standing -> 'sanctions');
  elsif v_author is not null then
    v_author_json := public.ts_blind_standing(v_author, q.id);
  else
    v_author_json := jsonb_build_object('kind', 'blind', 'accountAge', '30d+', 'strikePoints', '0', 'priorByCategory', '{}'::jsonb, 'sanction', null, 'otherOpenItems', '0');
  end if;

  return public.ts_queue_item_json(q, p_viewer, v_snap) || jsonb_build_object(
    'fields', v_fields,
    'media', coalesce(case when jsonb_typeof(v_snap -> 'media') = 'array' then v_snap -> 'media' end, '[]'::jsonb),
    'href', v_snap ->> 'href',
    'ruleHits', v_hits,
    'signals', v_signals,
    'aiVerdict', q.ai_verdict,
    'context', v_context,
    'reports', v_reports,
    'history', v_history,
    'author', v_author_json,
    'suggestion', public.ts_suggestion(q, v_author, v_snap is not null, v_visible_points, p_role),
    'locked', case when q.entity_type = 'buzz' and v_context is not null then v_context #> '{root,locked}' end,
    'legalHold', q.legal_hold,
    'reference', case when v_admin then q.reference end,
    'canUnmask', v_admin and v_anon and (q.entity_id is not null or public.ts_unmaskable_blocked(q)));
end;
$$;

create or replace function public.console_queue_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
begin
  return public.ts_queue_detail(p_id, auth.uid(), v_role, false);
end;
$$;

-- A 10-minute claim. Closed, or held by someone else: refused.
create or replace function public.console_claim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  q public.mod_queue;
begin
  select * into q from public.mod_queue where id = p_id for update;
  if not found or not public.ts_queue_visible(q, v_me, v_role) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if q.status = 'closed' then
    perform public.ts_fail('conflict', 'This item is closed.');
  end if;
  if q.claimed_by is not null and q.claimed_by <> v_me and q.claimed_at > now() - interval '10 minutes' then
    perform public.ts_fail('conflict', 'Being reviewed by another staff member.');
  end if;
  update public.mod_queue set claimed_by = v_me, claimed_at = now(), status = case when status = 'open' then 'claimed' else status end
  where id = p_id returning * into q;
  return public.ts_queue_item_json(q, v_me, public.ts_snapshot(q.entity_type, q.entity_id));
end;
$$;

-- Release your claim (admins, and anyone once the 10 minutes are up, release anyone's).
create or replace function public.console_release(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  q public.mod_queue;
begin
  select * into q from public.mod_queue where id = p_id for update;
  if not found or not public.ts_queue_visible(q, v_me, v_role) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if q.claimed_by is not null then
    if q.claimed_by <> v_me and v_role <> 'admin' and q.claimed_at > now() - interval '10 minutes' then
      perform public.ts_fail('conflict', 'Being reviewed by another staff member.');
    end if;
    update public.mod_queue set claimed_by = null, claimed_at = null, status = case when status = 'claimed' then 'open' else status end
    where id = p_id returning * into q;
  end if;
  return public.ts_queue_item_json(q, v_me, public.ts_snapshot(q.entity_type, q.entity_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Staff: actions (UniVerse services/admin/actions.ts)
-- -----------------------------------------------------------------------------
-- The ladder. 'mod' actions are for moderators and admins, 'admin' ones for admins (moderators get 'forbidden').
-- needs_note: a staff-only note of 10+ characters (a ban 30+, with the typed word BAN).
create or replace function public.ts_action_def(p_action text)
returns jsonb
language sql
immutable
as $$
  select case p_action
    when 'approve' then '{"role":"mod","needsNote":false}'
    when 'dismiss_reports' then '{"role":"mod","needsNote":false}'
    when 'warn_only' then '{"role":"mod","needsNote":true}'
    when 'remove' then '{"role":"mod","needsNote":true}'
    when 'remove_and_warn' then '{"role":"mod","needsNote":true}'
    when 'remove_and_mute_24h' then '{"role":"mod","needsNote":true}'
    when 'remove_and_mute_72h' then '{"role":"mod","needsNote":true}'
    when 'remove_and_mute_7d' then '{"role":"mod","needsNote":true}'
    when 'lock_thread' then '{"role":"mod","needsNote":true}'
    when 'unlock_thread' then '{"role":"mod","needsNote":true}'
    when 'escalate' then '{"role":"mod","needsNote":true}'
    when 'restore' then '{"role":"mod","needsNote":true}'
    when 'suspend_7d' then '{"role":"admin","needsNote":true}'
    when 'suspend_30d' then '{"role":"admin","needsNote":true}'
    when 'ban' then '{"role":"admin","needsNote":true}'
    when 'lift_sanction' then '{"role":"admin","needsNote":true}'
    when 'escalate_external' then '{"role":"admin","needsNote":true}'
  end::jsonb;
$$;

-- Zero tolerance (UniVerse safety 4.3): a confirmed violation here suspends for 7 days at once, pending an admin.
create or replace function public.ts_zero_tolerance(p_category text, p_severity text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_category = 'sexual_minors' or (p_severity = 'critical' and p_category in ('threat_violence', 'sexual_explicit', 'pii_doxxing')), false);
$$;

-- One action on one item, in the caller's transaction. Buzz items are acted on blind: the author is resolved here and
-- never leaves the database. p_options: {confirmText ('BAN'), reference (escalate_external), badFaith (dismiss)}.
create or replace function public.ts_staff_act(p_id uuid, p_viewer uuid, p_role text, p_action text, p_category text, p_note text, p_options jsonb, p_batch uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.mod_queue;
  v_def jsonb := public.ts_action_def(p_action);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_opts jsonb := case when jsonb_typeof(p_options) = 'object' then p_options else '{}'::jsonb end;
  v_reference text := nullif(btrim(coalesce(v_opts ->> 'reference', '')), '');
  v_anon boolean;
  v_entity boolean;
  v_before jsonb;
  v_author uuid;
  v_severity text;
  v_action_id uuid;
  v_removing boolean := p_action in ('remove', 'remove_and_warn', 'remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d');
  v_sanctioning boolean := p_action in ('remove_and_warn', 'remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d', 'warn_only', 'suspend_7d', 'suspend_30d', 'ban');
  v_target uuid;
begin
  select * into q from public.mod_queue where id = p_id for update;
  if not found or not public.ts_queue_visible(q, p_viewer, p_role) then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if v_def is null then
    perform public.ts_fail('validation_failed', 'Unknown action.');
  end if;
  if v_def ->> 'role' = 'admin' and p_role <> 'admin' then
    perform public.ts_fail('forbidden', 'Admins only.');
  end if;
  if not public.ts_is_category(p_category) then
    perform public.ts_fail('validation_failed', 'Pick the guideline.');
  end if;
  if (v_def ->> 'needsNote')::boolean and char_length(coalesce(v_note, '')) < 10 then
    perform public.ts_fail('validation_failed', 'Add a note (at least 10 characters).');
  end if;
  if p_action = 'ban' then
    if coalesce(v_opts ->> 'confirmText', '') <> 'BAN' then
      perform public.ts_fail('validation_failed', 'Type BAN to confirm.');
    end if;
    if char_length(coalesce(v_note, '')) < 30 then
      perform public.ts_fail('validation_failed', 'A ban needs a note of at least 30 characters.');
    end if;
  end if;
  if p_action = 'escalate_external' and v_reference is null then
    perform public.ts_fail('validation_failed', 'Add the outside reference number.');
  end if;
  if v_sanctioning and (p_category = 'self_harm' or q.label = 'wellbeing') then
    perform public.ts_fail('validation_failed', 'Wellbeing items never sanction. Approve, dismiss or escalate instead.');
  end if;
  if q.status = 'closed' and p_action not in ('restore', 'lift_sanction') then
    perform public.ts_fail('conflict', 'This item is closed.');
  end if;
  if q.status <> 'closed' and q.claimed_by is not null and q.claimed_by <> p_viewer and q.claimed_at > now() - interval '10 minutes' then
    perform public.ts_fail('conflict', 'Being reviewed by another staff member.');
  end if;

  v_anon := public.ts_is_anon(q.entity_type);
  v_entity := q.entity_id is not null;
  v_before := case when v_entity then public.ts_snapshot(q.entity_type, q.entity_id) end;
  v_author := coalesce(q.author_id, case when v_entity then public.ts_author_of(q.entity_type, q.entity_id) end);
  v_severity := case when q.severity = 'none' then 'low' else q.severity end;
  v_action_id := public.ts_record_action(q.id, q.entity_type, q.entity_id, v_author, p_viewer, p_role, p_action, p_category, v_note, p_batch, null, null,
    case when v_reference is not null then jsonb_build_object('reference', v_reference) else '{}'::jsonb end);

  if v_removing then
    if v_entity and v_before is not null then
      perform public.ts_apply_content_status(q.entity_type, q.entity_id, 'removed', null, p_category, null, v_before);
      if v_author is not null then
        perform public.ts_add_strike(v_author, q.entity_type, q.entity_id, p_category, v_severity, v_action_id, v_before);
      end if;
    end if;
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'actioned');
  end if;
  if v_sanctioning and v_author is null then
    perform public.ts_fail('validation_failed', 'No account is attached to this item.');
  end if;

  if p_action = 'approve' then
    if v_entity and v_before is not null then
      perform public.ts_apply_content_status(q.entity_type, q.entity_id, 'active', true, p_category, null, v_before);
    end if;
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'dismissed');
  elsif p_action = 'dismiss_reports' then
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'dismissed', coalesce((v_opts ->> 'badFaith')::boolean, false));
  elsif p_action = 'remove_and_warn' then
    perform public.ts_apply_sanction(v_author, 'warning', null, 'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, null, v_before);
  elsif p_action in ('remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d') then
    perform public.ts_apply_sanction(v_author, 'mute',
      case p_action when 'remove_and_mute_24h' then interval '24 hours' when 'remove_and_mute_72h' then interval '72 hours' else interval '7 days' end,
      'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, null, v_before);
  elsif p_action = 'warn_only' then
    perform public.ts_apply_sanction(v_author, 'warning', null, 'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, null, v_before);
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'actioned');
  elsif p_action in ('lock_thread', 'unlock_thread') then
    if q.entity_type <> 'buzz' or not v_entity then
      perform public.ts_fail('validation_failed', 'Only Buzz threads can be locked.');
    end if;
    perform public.buzz_v2_set_locked(q.entity_id, p_action = 'lock_thread');
  elsif p_action = 'escalate' then
    update public.mod_queue set status = 'escalated', claimed_by = null, claimed_at = null where id = q.id;
    if p_category = 'sexual_minors' then
      update public.mod_queue set legal_hold = true where id = q.id;
      if v_author is not null then
        perform public.ts_apply_sanction(v_author, 'suspension', interval '7 days', 'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, false, v_before);
      end if;
    end if;
  elsif p_action = 'escalate_external' then
    update public.mod_queue set legal_hold = true, reference = left(v_reference, 200) where id = q.id;
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'actioned');
  elsif p_action in ('suspend_7d', 'suspend_30d') then
    perform public.ts_apply_sanction(v_author, 'suspension', case when p_action = 'suspend_7d' then interval '7 days' else interval '30 days' end,
      'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, false, v_before);
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'actioned');
  elsif p_action = 'ban' then
    perform public.ts_apply_sanction(v_author, 'ban', null, 'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, false, v_before);
    perform public.ts_close_reports(q.entity_type, q.entity_id, 'actioned');
  elsif p_action = 'lift_sanction' then
    select s.id into v_target
    from public.user_sanctions s join public.moderation_actions a on a.id = s.action_id
    where a.queue_id = q.id and s.lifted_at is null and s.kind in ('warning', 'mute', 'suspension', 'ban')
    order by s.created_at desc limit 1;
    if v_target is null then
      perform public.ts_fail('not_found', 'No active sanction is tied to this item.');
    end if;
    perform public.ts_lift_sanction(v_target, p_viewer, p_role);
  elsif p_action = 'restore' then
    if v_entity then
      if v_before is not null then
        perform public.ts_apply_content_status(q.entity_type, q.entity_id, 'active', null, p_category, null, v_before);
      end if;
      perform public.ts_revoke_strikes(q.entity_type, q.entity_id);
    end if;
  end if;

  -- close the item
  if p_action in ('approve', 'restore') then
    if q.status <> 'closed' then
      update public.mod_queue set status = 'closed', closed_at = now(), resolution = 'approved', claimed_by = null, claimed_at = null where id = q.id;
    else
      update public.mod_queue set resolution = 'approved' where id = q.id;
    end if;
  elsif p_action = 'dismiss_reports' then
    update public.mod_queue set status = 'closed', closed_at = now(), resolution = 'dismissed', claimed_by = null, claimed_at = null where id = q.id;
  elsif p_action = 'remove' then
    update public.mod_queue set status = 'closed', closed_at = now(), resolution = 'removed', claimed_by = null, claimed_at = null where id = q.id;
  elsif v_sanctioning then
    update public.mod_queue set status = 'closed', closed_at = now(), resolution = 'sanctioned', claimed_by = null, claimed_at = null where id = q.id;
  elsif p_action = 'escalate_external' then
    update public.mod_queue set status = 'closed', closed_at = now(), resolution = 'escalated_external', claimed_by = null, claimed_at = null where id = q.id;
  end if;

  if (v_removing or p_action = 'warn_only') and v_author is not null and public.ts_zero_tolerance(p_category, q.severity) then
    perform public.ts_apply_sanction(v_author, 'suspension', interval '7 days', 'all', p_category, q.entity_type, q.entity_id, p_viewer, p_role, v_action_id, false, v_before);
    update public.mod_queue set resolution = 'sanctioned' where id = q.id;
  end if;
end;
$$;

-- p_sanction: the action's options, {confirmText: 'BAN', reference: '…', badFaith: true}. Returns the refreshed detail.
create or replace function public.console_act(p_id uuid, p_action text, p_category text, p_note text default null, p_sanction jsonb default null, p_batch uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
begin
  perform public.ts_staff_act(p_id, auth.uid(), v_role, p_action, p_category, p_note, p_sanction, p_batch);
  return public.ts_queue_detail(p_id, auth.uid(), v_role, true);
end;
$$;

-- Up to 50 items: approve, remove or dismiss reports. Never P0, wellbeing, escalated or appeal items (sanctions are
-- always per item). Each item gets its own audit row; they share the batch id.
create or replace function public.console_bulk(p_ids uuid[], p_action text, p_category text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_batch uuid := gen_random_uuid();
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  q public.mod_queue;
begin
  if coalesce(cardinality(p_ids), 0) not between 1 and 50 then
    perform public.ts_fail('validation_failed', 'Select between 1 and 50 items.');
  end if;
  if p_action not in ('approve', 'remove', 'dismiss_reports') then
    perform public.ts_fail('validation_failed', 'Bulk actions are approve, remove and dismiss reports.');
  end if;
  for v_id in select distinct x from unnest(p_ids) x where x is not null loop
    select * into q from public.mod_queue where id = v_id;
    if not found or not public.ts_queue_visible(q, v_me, v_role) then
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_found');
      continue;
    end if;
    if q.priority = 'p0' or q.label = 'wellbeing' or q.status = 'escalated' or q.source = 'appeal' or q.appeal_id is not null then
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_bulk_eligible');
      continue;
    end if;
    begin
      perform public.ts_staff_act(v_id, v_me, v_role, p_action, p_category, p_note, null, v_batch);
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', true);
    exception when others then
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'error', public.ts_error_code(sqlerrm));
    end;
  end loop;
  return jsonb_build_object('results', v_results, 'batchId', v_batch);
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Staff: unmask (admins only)
-- -----------------------------------------------------------------------------
-- The ONLY way from Buzz content to its author (UniVerse safety 6.5). Admins only (moderators: not found). Needs a
-- queue item for the content (no unmasking arbitrary buzzes from the feed); for an escalated blocked write, which never
-- became content, p_entity_id is the queue item's own id and only a threat of violence or a self-harm risk qualifies.
-- A reason code, a written reason of 30+ characters, the typed word UNMASK; 10 a day per admin. The buzz_unmask audit
-- row is written BEFORE the author is looked up (if that fails, everything rolls back); a second row records which
-- account it was as a keyed tag (no readable id); every other admin is told. The identity is in this answer only, for
-- five minutes on screen.
create or replace function public.console_unmask(p_entity_type text, p_entity_id uuid, p_reason_code text, p_reason text, p_confirm text, p_case_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  q public.mod_queue;
  v_entity uuid := null;
  v_audit uuid;
  v_author uuid;
  v_user jsonb;
  v_admin uuid;
begin
  perform public.ts_require_admin();
  if p_entity_type is null or p_entity_type not in ('buzz', 'buzz_reply') then
    perform public.ts_fail('validation_failed', 'Only Buzz authors are ever masked.');
  end if;
  if p_reason_code is null or p_reason_code not in ('credible_threat', 'self_harm_emergency', 'child_safety', 'severe_repeat_harassment', 'legal_request', 'ban_evasion') then
    perform public.ts_fail('validation_failed', 'Pick a reason code.');
  end if;
  if char_length(v_reason) < 30 then
    perform public.ts_fail('validation_failed', 'Write at least 30 characters explaining why.');
  end if;
  if p_confirm is distinct from 'UNMASK' then
    perform public.ts_fail('validation_failed', 'Type UNMASK to confirm.');
  end if;
  select * into q from public.mod_queue x where x.entity_type = p_entity_type and x.entity_id = p_entity_id order by x.created_at desc limit 1;
  if found then
    v_entity := p_entity_id;
  else
    select * into q from public.mod_queue x where x.id = p_entity_id;
    if not found or q.entity_type <> p_entity_type or q.entity_id is not null or not public.ts_queue_visible(q, v_me, 'admin') then
      perform public.ts_fail('not_found', 'No queue item exists for this content.');
    end if;
    if not public.ts_unmaskable_blocked(q) then
      perform public.ts_fail('forbidden', 'Blocked text can be unmasked only for a threat of violence or a self-harm risk.');
    end if;
  end if;
  if (select count(*) from public.audit_log a where a.actor_id = v_me and a.action = 'buzz_unmask' and a.created_at > now() - interval '1 day') >= 10 then
    perform public.ts_fail('rate_limited', 'You''ve reached 10 unmasks today. Try again tomorrow.');
  end if;

  v_audit := public.ts_audit(v_me, 'admin', 'buzz_unmask', p_entity_type, v_entity::text, q.id, null, p_reason_code, v_reason,
                             jsonb_build_object('caseRef', nullif(left(btrim(coalesce(p_case_ref, '')), 100), '')));

  v_author := coalesce(
    case when v_entity is not null then public.ts_author_of(p_entity_type, v_entity) end,
    q.author_id,
    (select e.author_id from public.moderation_events e where e.entity_type = p_entity_type and e.entity_id = v_entity and e.author_id is not null
     order by e.created_at desc limit 1));
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'username', p.username, 'email', u.email,
                            'universityName', public.ts_university_name(p.university_id, false), 'createdAt', public.ts_ms(p.created_at))
  into v_user
  from public.profiles p left join auth.users u on u.id = p.id
  where p.id = v_author;
  if v_user is null then
    perform public.ts_fail('not_found', 'The author of this content is no longer available.');
  end if;
  perform public.ts_audit(v_me, 'admin', 'buzz_unmask_subject', p_entity_type, v_entity::text, q.id, null, p_reason_code, null,
                          jsonb_build_object('unmaskId', v_audit, 'subjectTag', left(public.ts_seal('unmask-subject', v_author::text), 32)));
  for v_admin in select x from public.ts_staff_ids(true) x where x <> v_me loop
    perform public.ts_notify(v_admin, 'staff', 'An admin unmasked a Buzz author · ' || p_reason_code, 'Every unmask is in the audit log.', '/admin/audit',
                             jsonb_build_object('event', 'unmask_alert', 'reasonCode', p_reason_code, 'auditId', v_audit));
  end loop;
  return jsonb_build_object('auditId', v_audit, 'expiresAt', public.ts_ms(now() + interval '5 minutes'), 'user', v_user);
end;
$$;

-- -----------------------------------------------------------------------------
-- 16. Staff: audit log, users, sanctions
-- -----------------------------------------------------------------------------
-- Moderators read their own rows; admins everything (filters: actor, action, targetType, from, to in ms). A 'user'
-- target tied to a Buzz queue item is left out for moderators altogether.
create or replace function public.console_audit(p_limit int default 50, p_offset int default 0, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_admin boolean := v_role = 'admin';
  v_me uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_actor uuid := public.ts_uuid(v_f ->> 'actor');
  v_action text := nullif(v_f ->> 'action', '');
  v_target text := nullif(v_f ->> 'targetType', '');
  v_from timestamptz := public.ts_from_ms(case when (v_f ->> 'from') ~ '^\d+$' then (v_f ->> 'from')::bigint end);
  v_to timestamptz := public.ts_from_ms(case when (v_f ->> 'to') ~ '^\d+$' then (v_f ->> 'to')::bigint end);
  v_items jsonb;
  v_count int;
begin
  with page as (
    select a.* from public.audit_log a
    where (case when v_admin then (v_actor is null or a.actor_id = v_actor) else a.actor_id = v_me end)
      and (v_action is null or a.action = v_action)
      and (v_target is null or a.target_type = v_target)
      and (v_from is null or a.created_at >= v_from)
      and (v_to is null or a.created_at <= v_to)
      and (v_admin or not (a.target_type = 'user' and public.ts_is_anon((select q.entity_type from public.mod_queue q where q.id = a.queue_id))))
    order by a.created_at desc, a.seq desc
    limit v_limit + 1 offset v_offset
  )
  select coalesce(jsonb_agg(public.ts_audit_row_json(r, v_admin) order by r.created_at desc, r.seq desc), '[]'::jsonb), count(*)
  into v_items, v_count
  from page r;
  if v_count > v_limit then
    v_items := v_items - v_limit;
  end if;
  return jsonb_build_object('items', v_items, 'nextOffset', case when v_count > v_limit then v_offset + v_limit end);
end;
$$;

-- Look people up by name or username (admins: and email). Never any Buzz text, and for moderators never an
-- anon-origin row or count (ts_staff_user_json).
create or replace function public.console_users(p_q text, p_limit int default 20, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text := public.ts_require_staff();
  v_admin boolean := v_role = 'admin';
  v_needle text := btrim(regexp_replace(coalesce(p_q, ''), '^\s*@', ''));
  v_like text;
  v_prefix text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_ids uuid[];
  v_items jsonb;
begin
  if char_length(v_needle) < 2 then
    return jsonb_build_object('items', '[]'::jsonb, 'nextOffset', null);
  end if;
  v_needle := replace(replace(replace(left(v_needle, 80), '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_needle || '%';
  v_prefix := v_needle || '%';
  select array_agg(id order by rank, full_name, id) into v_ids from (
    select p.id, p.full_name,
           case when p.username ilike v_prefix or p.full_name ilike v_prefix then 0 else 1 end as rank
    from public.profiles p left join auth.users u on u.id = p.id
    where p.username ilike v_like or p.full_name ilike v_like or (v_admin and u.email ilike v_like)
    order by rank, p.full_name, p.id
    limit v_limit + 1 offset v_offset
  ) s;
  select coalesce(jsonb_agg(public.ts_staff_user_json(x, v_role) order by o), '[]'::jsonb) into v_items
  from unnest(coalesce(v_ids[1:v_limit], '{}'::uuid[])) with ordinality as t(x, o);
  return jsonb_build_object('items', v_items, 'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end);
end;
$$;

create or replace function public.console_user(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_out jsonb := public.ts_staff_user_json(p_id, v_role);
begin
  if v_out is null then
    perform public.ts_fail('not_found', 'This account isn''t available.');
  end if;
  return v_out;
end;
$$;

-- A direct sanction on a named account: always public-origin, on the account's profile (Buzz sanctions go through a
-- queue item, blind). Moderators: warnings and mutes of up to 7 days, on accounts that are not staff. Note 10+.
create or replace function public.console_sanction(p_user uuid, p_kind text, p_duration_ms bigint default null, p_scope text default 'all', p_category text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_duration interval;
  v_action uuid;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform public.ts_fail('not_found', 'This account isn''t available.');
  end if;
  if p_kind is null or p_kind not in ('warning', 'mute', 'suspension', 'ban') then
    perform public.ts_fail('validation_failed', 'Pick a sanction.');
  end if;
  if not public.ts_is_category(p_category) then
    perform public.ts_fail('validation_failed', 'Pick the guideline.');
  end if;
  if char_length(v_note) < 10 then
    perform public.ts_fail('validation_failed', 'Add a note (at least 10 characters).');
  end if;
  if p_user = v_me then
    perform public.ts_fail('validation_failed', 'You can''t sanction yourself.');
  end if;
  if p_scope is not null and p_scope not in ('all', 'buzz_only', 'requests') then
    perform public.ts_fail('validation_failed', 'Unknown scope.');
  end if;
  if p_duration_ms is not null and (p_duration_ms <= 0 or p_duration_ms > 400::bigint * 86400000) then
    perform public.ts_fail('validation_failed', 'Pick a duration between a minute and 400 days.');
  end if;
  v_duration := case when p_duration_ms is null then null else make_interval(secs => p_duration_ms / 1000.0) end;
  if v_role <> 'admin' then
    if p_kind not in ('warning', 'mute') then
      perform public.ts_fail('forbidden', 'Suspensions and bans are admin only.');
    end if;
    if p_kind = 'mute' and coalesce(v_duration, interval '24 hours') > interval '7 days' then
      perform public.ts_fail('forbidden', 'Moderators can mute for up to 7 days.');
    end if;
    if public.ts_role_of(p_user) is not null then
      perform public.ts_fail('forbidden', 'Only admins can sanction staff.');
    end if;
  end if;
  v_action := public.ts_record_action(null, 'profile', p_user, p_user, v_me, v_role, 'sanction_' || p_kind, p_category, v_note, null, null, null, '{}'::jsonb);
  perform public.ts_apply_sanction(p_user, p_kind, v_duration, coalesce(p_scope, 'all'), p_category, 'profile', p_user, v_me, v_role, v_action, false,
                                   public.ts_snapshot('profile', p_user));
  return public.ts_staff_user_json(p_user, v_role);
end;
$$;

-- Admins only. p_id: a sanction id, or the sealed handle a user page shows for an anon-origin row. A RAW anon-origin
-- id (only content-targeted audit rows carry one) answers blind: returning the account would be an unmask with no
-- reason, no UNMASK and no buzz_unmask row.
create or replace function public.console_lift(p_id text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_sealed boolean := coalesce(p_id, '') like 'sx\_%';
  v_s public.user_sanctions;
begin
  perform public.ts_require_admin();
  if v_sealed then
    select * into v_s from public.user_sanctions s where s.origin = 'anon' and 'sx_' || public.ts_seal('staff-sanction', s.id::text) = p_id;
  else
    select * into v_s from public.user_sanctions s where s.id = public.ts_uuid(p_id);
  end if;
  if v_s.id is null then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  if char_length(v_note) < 10 then
    perform public.ts_fail('validation_failed', 'Add a note (at least 10 characters).');
  end if;
  perform public.ts_lift_sanction(v_s.id, v_me, 'admin');
  perform public.ts_record_action(null,
    case when v_s.origin = 'anon' then coalesce(v_s.entity_type, 'buzz') else coalesce(v_s.entity_type, 'profile') end,
    case when v_s.origin = 'anon' then v_s.entity_id else coalesce(v_s.entity_id, v_s.user_id) end,
    v_s.user_id, v_me, 'admin', 'lift_sanction', v_s.category, v_note, null, v_s.id, null, '{}'::jsonb);
  if not v_sealed and v_s.origin = 'anon' then
    return jsonb_build_object('lifted', true, 'origin', 'anon');
  end if;
  return public.ts_staff_user_json(v_s.user_id, 'admin');
end;
$$;

-- Admins only: make someone a moderator or an admin, or take it back ('user'). Audited. Never your own role.
-- Where CampConnect Admin's staff list exists, staff are managed there (invites, two-factor sign-in) and this refuses.
create or replace function public.console_grant_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_from text;
begin
  perform public.ts_require_admin();
  if to_regclass('public.staff') is not null then
    perform public.ts_fail('not_supported', 'Staff are added and removed in CampConnect Admin.');
  end if;
  if p_role is null or p_role not in ('user', 'moderator', 'admin') then
    perform public.ts_fail('validation_failed', 'Pick a role.');
  end if;
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    perform public.ts_fail('not_found', 'This account isn''t available.');
  end if;
  if p_user = v_me then
    perform public.ts_fail('validation_failed', 'You can''t change your own role.');
  end if;
  v_from := coalesce(public.ts_role_of(p_user), 'user');
  if v_from <> p_role then
    if p_role = 'user' then
      delete from public.staff_members where user_id = p_user;
    else
      insert into public.staff_members (user_id, role) values (p_user, p_role) on conflict (user_id) do update set role = excluded.role;
    end if;
    perform public.ts_audit(v_me, 'admin', case when p_role = 'user' then 'role_revoke' else 'role_grant' end, 'user', p_user::text, null, null, null, null,
                            jsonb_build_object('from', v_from, 'to', p_role));
  end if;
  return public.ts_staff_user_json(p_user, 'admin');
end;
$$;

-- -----------------------------------------------------------------------------
-- 17. Appeals
-- -----------------------------------------------------------------------------
-- Everything on your own account (SanctionNotice[], newest first; packages/shared/src/trust-safety). The only payload
-- that quotes your own content back, Buzz included, so it goes to you alone. A sanction that starts later shows once it
-- starts. A lifted one shows as ended then.
create or replace function public.my_sanctions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'kind', s.kind,
      'scope', s.scope,
      'category', s.category,
      'guidelineAnchor', public.ts_guideline_anchor(s.category),
      'contentExcerpt', s.content_excerpt,
      'contentLabel', s.content_label,
      'startsAt', public.ts_ms(s.effective_at),
      'until', public.ts_ms(case when s.lifted_at is not null then least(coalesce(s.expires_at, s.lifted_at), s.lifted_at) else s.expires_at end),
      'acknowledgedAt', public.ts_ms(s.acknowledged_at),
      'canAppeal', s.kind <> 'warning' and a.id is null and s.lifted_at is null and now() <= s.created_at + interval '14 days',
      'appealStatus', coalesce(a.status, 'none'),
      'appealDeadline', case when s.kind = 'warning' then null else public.ts_ms(s.created_at + interval '14 days') end,
      'createdAt', public.ts_ms(s.created_at)
    ) order by s.created_at desc, s.id desc), '[]'::jsonb)
  from public.user_sanctions s
  left join public.appeals a on a.sanction_id = s.id
  where s.user_id = auth.uid() and s.effective_at <= now();
$$;

-- "I understand" on a notice (a warning stops blocking posts once acknowledged).
create or replace function public.ack_sanction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    perform public.ts_fail('unauthenticated', 'Log in first.');
  end if;
  update public.user_sanctions set acknowledged_at = coalesce(acknowledged_at, now())
  where id = p_id and user_id = auth.uid() and effective_at <= now();
  if not found then
    perform public.ts_fail('not_found', 'That notice isn''t available.');
  end if;
end;
$$;

-- One appeal per sanction or removal, within 14 days, 10-1000 characters; not for warnings or lifted notices. It files
-- (or joins) the content's queue item as an appeal (an anon-origin sanction stays anon), is audited, tells you it
-- arrived and tells the staff who may review it (never who wrote it).
create or replace function public.submit_appeal(p_sanction uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_text text := btrim(coalesce(p_text, ''));
  s public.user_sanctions;
  v_type text;
  v_entity uuid;
  v_snap jsonb;
  v_uni uuid;
  v_id uuid;
  v_queue uuid;
  v_actor uuid;
  v_staff uuid;
begin
  if v_me is null then
    perform public.ts_fail('unauthenticated', 'Log in first.');
  end if;
  select * into s from public.user_sanctions x where x.id = p_sanction and x.user_id = v_me and x.effective_at <= now();
  if not found then
    perform public.ts_fail('not_found', 'That notice isn''t available.');
  end if;
  if exists (select 1 from public.appeals a where a.sanction_id = s.id) then
    perform public.ts_fail('conflict', 'You already appealed this notice.');
  end if;
  if s.kind = 'warning' then
    perform public.ts_fail('validation_failed', 'Warnings can''t be appealed.');
  end if;
  if s.lifted_at is not null then
    perform public.ts_fail('conflict', 'This notice is no longer in effect.');
  end if;
  if now() > s.created_at + interval '14 days' then
    perform public.ts_fail('validation_failed', 'The 14-day appeal window for this notice has closed.');
  end if;
  if char_length(v_text) < 10 then
    perform public.ts_fail('validation_failed', 'Tell us a bit more (at least 10 characters).');
  end if;
  if char_length(v_text) > 1000 then
    perform public.ts_fail('validation_failed', 'Keep the appeal under 1,000 characters.');
  end if;

  if s.origin = 'anon' then
    v_type := coalesce(s.entity_type, 'buzz');
    v_entity := s.entity_id;
  else
    v_type := coalesce(s.entity_type, 'profile');
    v_entity := coalesce(s.entity_id, v_me);
  end if;
  v_snap := public.ts_snapshot(v_type, v_entity);
  select p.university_id into v_uni from public.profiles p where p.id = v_me;
  insert into public.appeals (user_id, sanction_id, text) values (v_me, s.id, v_text) returning id into v_id;
  v_queue := public.ts_enqueue(v_type, v_entity, coalesce(v_snap ->> 'surface', v_type), coalesce(public.ts_uuid(v_snap ->> 'universityId'), v_uni), v_me,
                               'appeal', s.category, 'none', 'p2', null, '[]'::jsonb, null, 0, 0);
  update public.mod_queue set appeal_id = coalesce(appeal_id, v_id) where id = v_queue;
  perform public.ts_audit(null, 'system', 'appeal_create', 'appeal', v_id::text, v_queue, null, null, null, jsonb_build_object('kind', s.kind));
  perform public.ts_notify(v_me, 'moderation', 'We received your appeal.', 'A different reviewer will look at it, usually within 3 days. We''ll let you know.',
                           '/settings/account-status', jsonb_build_object('event', 'appeal_received', 'sanctionId', s.id));
  select a.actor_id into v_actor from public.moderation_actions a where a.id = s.action_id;
  for v_staff in
    select x from public.ts_staff_ids(s.kind in ('suspension', 'ban')) x
    where x <> v_me and x is distinct from v_actor and x is distinct from s.actor_id
  loop
    perform public.ts_notify(v_staff, 'staff', 'New appeal to review', 'An appeal of a ' || case s.kind when 'removal' then 'removal' else s.kind end || ' is waiting.',
                             '/admin/appeals', jsonb_build_object('event', 'appeal_new'));
  end loop;
  return jsonb_build_object('id', v_id, 'sanctionId', s.id, 'status', 'open', 'createdAt', public.ts_ms(now()));
end;
$$;

-- Appeals for staff (p_view: open, upheld, reversed, reduced, all), never your own. Blind (ts_appeal_json).
create or replace function public.console_appeals(p_view text default 'open', p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_view text := case when p_view in ('open', 'upheld', 'reversed', 'reduced', 'all') then p_view else 'open' end;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_ids uuid[];
begin
  select array_agg(id order by n) into v_ids from (
    select a.id, row_number() over (order by case when v_view = 'open' then a.created_at end asc, case when v_view <> 'open' then a.created_at end desc, a.id) as n
    from public.appeals a
    where a.user_id <> v_me and (v_view = 'all' or a.status = v_view)
    order by n
    limit v_limit + 1 offset v_offset
  ) x;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.ts_appeal_json(i, v_me, v_role) order by o) from unnest(v_ids[1:v_limit]) with ordinality as t(i, o)), '[]'::jsonb),
    'nextOffset', case when coalesce(cardinality(v_ids), 0) > v_limit then v_offset + v_limit end);
end;
$$;

-- Decide an appeal: never your own, never one you (or the action behind it) actioned, suspensions and bans for admins.
-- reversed: lifted at once, content back up, strikes gone. reduced: ends earlier (p_reduced_until, ms). The person is
-- told; the appeal's queue item closes; audited.
create or replace function public.console_decide_appeal(p_id uuid, p_outcome text, p_note text, p_reduced_until bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_me uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  a public.appeals;
  s public.user_sanctions;
  v_action_actor uuid;
  v_queue uuid;
  v_until timestamptz := public.ts_from_ms(p_reduced_until);
begin
  select * into a from public.appeals where id = p_id for update;
  if not found or a.user_id = v_me then
    perform public.ts_fail('not_found', 'Not found');
  end if;
  select * into s from public.user_sanctions where id = a.sanction_id for update;
  select m.actor_id into v_action_actor from public.moderation_actions m where m.id = s.action_id;
  if a.status <> 'open' then
    perform public.ts_fail('conflict', 'This appeal was already decided.');
  end if;
  if s.kind in ('suspension', 'ban') and v_role <> 'admin' then
    perform public.ts_fail('forbidden', 'Appeals against suspensions and bans are admin only.');
  end if;
  if v_action_actor = v_me or s.actor_id = v_me then
    perform public.ts_fail('forbidden', 'A different staff member must review this appeal.');
  end if;
  if p_outcome is null or p_outcome not in ('upheld', 'reversed', 'reduced') then
    perform public.ts_fail('validation_failed', 'Pick an outcome.');
  end if;
  if char_length(v_note) < 10 then
    perform public.ts_fail('validation_failed', 'Add a note (at least 10 characters).');
  end if;
  if p_outcome = 'reduced' then
    if v_until is null or v_until <= now() then
      perform public.ts_fail('validation_failed', 'Pick a new end time in the future.');
    end if;
    if s.expires_at is not null and v_until >= s.expires_at then
      perform public.ts_fail('validation_failed', 'A reduced sanction must end earlier than it does now.');
    end if;
  end if;
  select q.id into v_queue from public.mod_queue q where q.appeal_id = a.id order by q.created_at desc limit 1;

  update public.appeals set status = p_outcome, reviewer_id = v_me, outcome_note = v_note, decided_at = now() where id = a.id;
  if p_outcome = 'reversed' then
    perform public.ts_lift_sanction(s.id, v_me, v_role);
    if s.entity_type is not null and s.entity_id is not null and s.entity_type <> 'profile' then
      if public.ts_snapshot(s.entity_type, s.entity_id) is not null then
        perform public.ts_apply_content_status(s.entity_type, s.entity_id, 'active', null, s.category, s.id);
      end if;
      perform public.ts_revoke_strikes(s.entity_type, s.entity_id);
    end if;
  elsif p_outcome = 'reduced' then
    update public.user_sanctions set expires_at = v_until where id = s.id;
    perform public.ts_audit(v_me, v_role, 'sanction_reduce', 'appeal', a.id::text, v_queue, null, null, null,
                            jsonb_build_object('sanctionId', s.id, 'until', public.ts_ms(v_until)));
  end if;
  update public.mod_queue set status = 'closed', closed_at = now(), resolution = case when p_outcome = 'upheld' then 'dismissed' else 'approved' end,
                              claimed_by = null, claimed_at = null
  where appeal_id = a.id and status <> 'closed';
  perform public.ts_audit(v_me, v_role, 'appeal_decide', 'appeal', a.id::text, v_queue, null, null, v_note, jsonb_build_object('outcome', p_outcome));
  perform public.ts_notify(a.user_id, 'moderation',
    case p_outcome when 'reversed' then 'Your appeal was accepted.' when 'reduced' then 'Your appeal was reviewed: the sanction was reduced.'
                   else 'Your appeal was reviewed: the decision stands.' end,
    case p_outcome when 'reversed' then 'We got this one wrong. The sanction is lifted and any strike removed. Sorry about that.'
                   when 'reduced' then 'It now ends earlier. Details are in Account status.' else null end,
    '/settings/account-status', jsonb_build_object('event', 'appeal_result', 'outcome', p_outcome, 'sanctionId', s.id));
  return public.ts_appeal_json(a.id, v_me, v_role);
end;
$$;

-- -----------------------------------------------------------------------------
-- 18. Staff: metrics and rule packs
-- -----------------------------------------------------------------------------
-- Moderation metrics from the moderation tables only, never broken down by person (UniVerse safety 6.7). Range
-- default: the last 30 days (at most 365). reportsPer1k is per 1,000 moderated writes (the content the engine saw).
create or replace function public.console_metrics(p_from bigint default null, p_to bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.ts_require_staff();
  v_to timestamptz := least(coalesce(public.ts_from_ms(p_to), now()), now());
  v_from timestamptz := coalesce(public.ts_from_ms(p_from), v_to - interval '30 days');
  v_open jsonb;
  v_tta jsonb;
  v_precision jsonb;
  v_appeals jsonb;
  v_reversal jsonb;
  v_active jsonb;
  v_unmasks jsonb;
  v_reports int;
  v_writes int;
  v_per_day jsonb;
begin
  if v_from > v_to then
    v_from := v_to - interval '30 days';
  end if;
  if v_to - v_from > interval '365 days' then
    v_from := v_to - interval '365 days';
  end if;

  select jsonb_build_object('p0', count(*) filter (where priority = 'p0'), 'p1', count(*) filter (where priority = 'p1'),
                            'p2', count(*) filter (where priority = 'p2'), 'p3', count(*) filter (where priority = 'p3'))
  into v_open from public.mod_queue where status <> 'closed';

  select jsonb_object_agg(p, jsonb_build_object(
      'medianMin', (select round((percentile_cont(0.5) within group (order by extract(epoch from (q.first_action_at - q.created_at)) / 60))::numeric, 1)
                    from public.mod_queue q where q.priority = p and q.first_action_at is not null and q.created_at between v_from and v_to),
      'p90Min', (select round((percentile_disc(0.9) within group (order by extract(epoch from (q.first_action_at - q.created_at)) / 60))::numeric, 1)
                 from public.mod_queue q where q.priority = p and q.first_action_at is not null and q.created_at between v_from and v_to),
      'slaMin', extract(epoch from public.ts_sla(p))::int / 60))
  into v_tta
  from unnest(array['p0', 'p1', 'p2', 'p3']) p;

  select coalesce(jsonb_agg(jsonb_build_object('ruleId', rule_id, 'flagged', flagged, 'removed', removed, 'approved', approved) order by flagged desc, rule_id), '[]'::jsonb)
  into v_precision
  from (
    select r as rule_id, count(*) as flagged,
           count(*) filter (where q.resolution in ('removed', 'sanctioned')) as removed,
           count(*) filter (where q.resolution = 'approved') as approved
    from public.mod_queue q cross join lateral jsonb_array_elements_text(q.rule_ids) r
    where q.status = 'closed' and q.closed_at between v_from and v_to
    group by r
    order by count(*) desc, r
    limit 40
  ) x;

  select jsonb_build_object(
      'decided', count(*),
      'overturned', count(*) filter (where status in ('reversed', 'reduced')))
  into v_appeals
  from public.appeals where status <> 'open' and decided_at between v_from and v_to;

  select jsonb_build_object(
      'reports', (select round(count(*) filter (where q.resolution = 'approved')::numeric / nullif(count(*) filter (where q.resolution in ('approved', 'removed', 'sanctioned')), 0), 2)
                  from public.mod_queue q where q.status = 'closed' and q.closed_at between v_from and v_to and q.source = 'user_report' and q.report_count >= 2),
      'score', (select round(count(*) filter (where q.resolution = 'approved')::numeric / nullif(count(*) filter (where q.resolution in ('approved', 'removed', 'sanctioned')), 0), 2)
                from public.mod_queue q where q.status = 'closed' and q.closed_at between v_from and v_to and q.source = 'community_score'))
  into v_reversal;

  select jsonb_build_object(
      'warning', count(*) filter (where kind = 'warning' and acknowledged_at is null and created_at > now() - interval '30 days'),
      'mute', count(*) filter (where kind = 'mute'),
      'suspension', count(*) filter (where kind = 'suspension'),
      'ban', count(*) filter (where kind = 'ban'))
  into v_active
  from public.user_sanctions
  where kind in ('warning', 'mute', 'suspension', 'ban') and lifted_at is null and effective_at <= now() and (expires_at is null or expires_at > now());

  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) into v_unmasks from (
    select coalesce(reason_code, 'unspecified') as code, count(*) as n from public.audit_log
    where action = 'buzz_unmask' and created_at between v_from and v_to group by 1
  ) u;

  select count(*) into v_reports from public.reports where created_at between v_from and v_to;
  select count(*) into v_writes from (
    select distinct entity_type, entity_id from public.moderation_events where entity_id is not null and created_at between v_from and v_to
  ) w;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(d at time zone 'UTC', 'YYYY-MM-DD'),
      'actions', (select count(*) from public.moderation_actions a where a.created_at >= d and a.created_at < d + interval '1 day'),
      'reports', (select count(*) from public.reports r where r.created_at >= d and r.created_at < d + interval '1 day'),
      'opened', (select count(*) from public.mod_queue q where q.created_at >= d and q.created_at < d + interval '1 day')) order by d), '[]'::jsonb)
  into v_per_day
  from generate_series(date_trunc('day', v_from at time zone 'UTC') at time zone 'UTC', v_to, interval '1 day') d;

  return jsonb_build_object(
    'range', jsonb_build_object('from', public.ts_ms(v_from), 'to', public.ts_ms(v_to)),
    'openByPriority', v_open,
    'oldestOpenMin', (select round(extract(epoch from (now() - min(created_at))) / 60)::int from public.mod_queue where status <> 'closed'),
    'timeToFirstAction', v_tta,
    'rulePrecision', v_precision,
    'appealOverturnRate', case when (v_appeals ->> 'decided')::int > 0 then round((v_appeals ->> 'overturned')::numeric / (v_appeals ->> 'decided')::numeric, 2) end,
    'autoHideReversalRate', v_reversal,
    'activeSanctions', v_active,
    'unmasksByReason', v_unmasks,
    'wellbeingPerWeek', (select count(*) from public.mod_queue where label = 'wellbeing' and created_at > now() - interval '7 days'),
    'reportsInRange', v_reports,
    'moderatedWritesInRange', v_writes,
    'reportsPer1k', case when v_writes > 0 then round(v_reports::numeric * 1000 / v_writes, 1) else 0 end,
    'perDay', v_per_day);
end;
$$;

create or replace function public.console_rule_packs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.ts_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.pack_id, 'enabled', r.enabled, 'updatedAt', public.ts_ms(r.updated_at),
                                        'updatedBy', (select p.full_name from public.profiles p where p.id = r.updated_by)) order by r.pack_id)
    from public.ts_rule_packs_state() r), '[]'::jsonb);
end;
$$;

-- Admins only, audited. The baseline pack stays on.
create or replace function public.console_set_rule_pack(p_id text, p_enabled boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  r public.moderation_rule_state;
begin
  perform public.ts_require_admin();
  if p_id is null or p_id !~ '^[a-z][a-z0-9_.-]{1,63}$' then
    perform public.ts_fail('validation_failed', 'Unknown rule pack.');
  end if;
  if p_id = 'baseline' and p_enabled is not true then
    perform public.ts_fail('validation_failed', 'The baseline pack stays on.');
  end if;
  insert into public.moderation_rule_state (pack_id, enabled, updated_by, updated_at) values (p_id, coalesce(p_enabled, true), v_me, now())
  on conflict (pack_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into r;
  perform public.ts_audit(v_me, 'admin', 'rule_pack_toggle', 'rule_pack', p_id, null, null, null, nullif(btrim(coalesce(p_note, '')), ''),
                          jsonb_build_object('enabled', r.enabled));
  return jsonb_build_object('id', r.pack_id, 'enabled', r.enabled, 'updatedAt', public.ts_ms(r.updated_at),
                            'updatedBy', (select p.full_name from public.profiles p where p.id = r.updated_by));
end;
$$;

-- -----------------------------------------------------------------------------
-- 19. Sanctions hold on public writes too
-- -----------------------------------------------------------------------------
-- UniVerse's assertCanPost on every create: a mute ('all' scope), a suspension, a ban or a warning not yet
-- acknowledged refuses new posts, reels, comments, listings and roommate posts. Messages: muted people still answer in
-- their chats; suspended and banned accounts cannot send. The message is readable as it is; the hint carries the code.
create or replace function public.ts_guard_public_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.ts_uuid(to_jsonb(new) ->> tg_argv[0]);
  v_status jsonb;
  v_reason text;
begin
  if v_user is null or not exists (
    select 1 from public.user_sanctions s where s.user_id = v_user and s.kind <> 'removal' and s.lifted_at is null and s.effective_at <= now()
  ) then
    return new;
  end if;
  v_status := public.ts_posting_status(v_user, 'public');
  if coalesce((v_status ->> 'allowed')::boolean, true) then
    return new;
  end if;
  v_reason := v_status ->> 'reason';
  if tg_argv[1] = 'message' and v_reason in ('muted', 'warning') then
    return new;
  end if;
  raise exception using
    message = case v_reason
      when 'muted' then 'You''re muted right now, so you can''t post. Details are in Settings → Account status.'
      when 'suspended' then 'Your account is suspended, so you can''t post. Details are in Settings → Account status.'
      when 'banned' then 'Your account is banned. Details are in Settings → Account status.'
      else 'Please read and acknowledge the notice from the safety team before posting (Settings → Account status).'
    end,
    errcode = 'P0001',
    hint = 'ts:' || coalesce(v_reason, 'forbidden');
end;
$$;

drop trigger if exists ts_guard_write on public.feed_posts;
create trigger ts_guard_write before insert on public.feed_posts for each row execute function public.ts_guard_public_write('author_id', 'public');
drop trigger if exists ts_guard_write on public.post_comments;
create trigger ts_guard_write before insert on public.post_comments for each row execute function public.ts_guard_public_write('user_id', 'public');
drop trigger if exists ts_guard_write on public.apartments;
create trigger ts_guard_write before insert on public.apartments for each row execute function public.ts_guard_public_write('owner_id', 'public');
drop trigger if exists ts_guard_write on public.items;
create trigger ts_guard_write before insert on public.items for each row execute function public.ts_guard_public_write('seller_id', 'public');
drop trigger if exists ts_guard_write on public.roommate_posts;
create trigger ts_guard_write before insert on public.roommate_posts for each row execute function public.ts_guard_public_write('author_id', 'public');
drop trigger if exists ts_guard_write on public.messages;
create trigger ts_guard_write before insert on public.messages for each row execute function public.ts_guard_public_write('sender_id', 'message');

-- -----------------------------------------------------------------------------
-- 20. Who may call what
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- internal: other functions (security definer) call these; no API role does
  foreach f in array array[
    'ts_ms(timestamptz)', 'ts_day_ms(timestamptz)', 'ts_minute_ms(timestamptz)', 'ts_from_ms(bigint)', 'ts_uuid(text)', 'ts_is_anon(text)',
    'ts_is_category(text)', 'ts_category_label(text)', 'ts_guideline_anchor(text)', 'ts_severity_rank(text)', 'ts_priority_raise(text)', 'ts_sla(text)',
    'ts_reason_priority(text)', 'ts_reason_category(text)', 'ts_bucket(bigint)', 'ts_duration_text(interval)', 'ts_excerpt(jsonb, text)', 'ts_scrub(text)',
    'ts_strip_identity(jsonb)', 'ts_country_code(text)', 'ts_email_hash(text)', 'ts_fail(text, text)', 'ts_fail_for(text, text, text)', 'ts_error_code(text)',
    'ts_seal(text, text)', 'ts_audit_append_only()', 'ts_notify(uuid, text, text, text, text, jsonb, timestamptz)',
    'ts_role_of(uuid)', 'ts_staff_ids(boolean)', 'ts_mfa_ok()', 'ts_strike_points(uuid)', 'ts_reporter_trust(uuid)', 'ts_posting_status(uuid, text)', 'ts_treated_as_new(uuid)',
    'ts_public_snapshot(text, uuid)', 'ts_public_author_of(text, uuid)', 'ts_public_remove(text, uuid)', 'ts_snapshot(text, uuid)', 'ts_author_of(text, uuid)',
    'ts_set_content_status(text, uuid, text, boolean)', 'ts_staff_context(text, uuid)', 'ts_university_name(uuid, boolean)',
    'ts_enqueue(text, uuid, text, uuid, uuid, text, text, text, text, text, jsonb, text, integer, integer)',
    'ts_record_events(text, uuid, text, uuid, uuid, jsonb)', 'ts_apply_moderation(text, uuid, text, uuid, uuid, jsonb)',
    'ts_audit(uuid, text, text, text, text, uuid, uuid, text, text, jsonb)',
    'ts_record_action(uuid, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid, text, jsonb)',
    'ts_close_reports(text, uuid, text, boolean)', 'ts_add_strike(uuid, text, uuid, text, text, uuid, jsonb)', 'ts_revoke_strikes(text, uuid)',
    'ts_apply_sanction(uuid, text, interval, text, text, text, uuid, uuid, text, uuid, boolean, jsonb)', 'ts_lift_sanction(uuid, uuid, text)',
    'ts_apply_content_status(text, uuid, text, boolean, text, uuid, jsonb)', 'ts_evaluate_auto_hide(text, uuid)', 'ts_reports_before_insert()',
    'ts_reports_after_insert()', 'ts_file_report(uuid, text, uuid, text, text, uuid)', 'ts_queue_visible(public.mod_queue, uuid, text)',
    'ts_queue_item_json(public.mod_queue, uuid, jsonb)', 'ts_blind_standing(uuid, uuid)', 'ts_staff_sanction_json(public.user_sanctions, text, text)',
    'ts_staff_standing(uuid, text)', 'ts_user_summary_json(uuid)', 'ts_staff_user_json(uuid, text)', 'ts_audit_row_json(public.audit_log, boolean)',
    'ts_appeal_json(uuid, uuid, text)', 'ts_unmaskable_blocked(public.mod_queue)', 'ts_suggestion(public.mod_queue, uuid, boolean, integer, text)',
    'ts_require_staff()', 'ts_require_admin()', 'ts_audit_once_per_day(uuid, text, text, public.mod_queue)', 'ts_queue_detail(uuid, uuid, text, boolean)',
    'ts_action_def(text)', 'ts_zero_tolerance(text, text)', 'ts_staff_act(uuid, uuid, text, text, text, text, jsonb, uuid)', 'ts_guard_public_write()',
    'ts_rule_pack_ids()', 'ts_rule_packs_state()', 'ts_refuse_banned_email()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  -- the website's write API (service role) only; ts_apply_moderation also takes the engine's optional second pass
  -- (an 'ai_flag' queue entry written back with the service role)
  foreach f in array array['ts_writer_context(uuid)', 'ts_record_blocked(uuid, text, text, jsonb)', 'ts_apply_moderation(text, uuid, text, uuid, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;

  -- signed-in people (the staff functions answer non-staff 'not found' themselves)
  foreach f in array array[
    'ts_staff_role()', 'my_sanctions()', 'ack_sanction(uuid)', 'submit_appeal(uuid, text)',
    'console_queue(text, integer, integer, jsonb)', 'console_queue_counts()', 'console_queue_item(uuid)', 'console_claim(uuid)', 'console_release(uuid)',
    'console_act(uuid, text, text, text, jsonb, uuid)', 'console_bulk(uuid[], text, text, text)', 'console_unmask(text, uuid, text, text, text, text)',
    'console_audit(integer, integer, jsonb)', 'console_users(text, integer, integer)', 'console_user(uuid)',
    'console_sanction(uuid, text, bigint, text, text, text)', 'console_lift(text, text)', 'console_grant_role(uuid, text)',
    'console_appeals(text, integer, integer)', 'console_decide_appeal(uuid, text, text, bigint)', 'console_metrics(bigint, bigint)',
    'console_rule_packs()', 'console_set_rule_pack(text, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
