import type { EventCategory } from "../constants";
import { EVENTS_PAGE_SIZE } from "../constants";
import { affinityFrom, type EventOrganizationSummary, type EventSummary, type ForYouContext } from "../events";
import type { EventFormInput, OrganizationFormInput } from "../schemas/events";
import type { Client, Organization } from "../types/models";
import { isMissingRelation } from "./profile-page";

/** An event with its organization joined (PostgREST names the join by the foreign key). */
const EVENT_SELECT =
  "id, university_id, organization_id, feed_id, title, description, starts_at, ends_at, all_day, location, category, image_url, registration_url, source, status, save_count, click_count, created_by, created_at, organization:organizations!events_organization_id_fkey(id, name, kind, avatar_url, verified)";

type EventQueryRow = Omit<EventSummary, "organization" | "category" | "source" | "status"> & { category: string; source: string; status: string; organization: EventOrganizationSummary | EventOrganizationSummary[] | null };

function eventOf(row: EventQueryRow): EventSummary {
  const org = Array.isArray(row.organization) ? (row.organization[0] ?? null) : row.organization;
  return { ...row, organization: org, category: row.category as EventCategory, source: row.source as EventSummary["source"], status: row.status as EventSummary["status"] };
}

export type EventFilters = {
  universityId?: string | null;
  /** ISO instants: events starting in [from, to), plus those still running at `from`. */
  from?: string;
  to?: string;
  category?: EventCategory | null;
  /** Any of these categories (the app's filter sheet picks several); with `category` too, both must match. */
  categories?: readonly EventCategory[];
  q?: string;
  organizationId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Events in time order, as the database lets the caller see them (scheduled and cancelled ones for everyone, an
 * organization's pending ones for its members, hidden ones for staff). On a database without migration 61 there are none.
 */
export async function listEvents(supabase: Client, filters: EventFilters = {}): Promise<EventSummary[]> {
  let query = supabase.from("events").select(EVENT_SELECT).order("starts_at", { ascending: true }).order("id", { ascending: true });
  if (filters.universityId) query = query.eq("university_id", filters.universityId);
  if (filters.from) query = query.or(`starts_at.gte.${filters.from},ends_at.gte.${filters.from}`);
  if (filters.to) query = query.lt("starts_at", filters.to);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.categories && filters.categories.length > 0) query = query.in("category", [...filters.categories]);
  if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
  const q = filters.q?.trim();
  if (q) query = query.textSearch("tsv", q, { type: "websearch", config: "simple" });
  const limit = filters.limit ?? EVENTS_PAGE_SIZE;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as EventQueryRow[]).map(eventOf);
}

export async function getEvent(supabase: Client, id: string): Promise<EventSummary | null> {
  const { data, error } = await supabase.from("events").select(EVENT_SELECT).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  return data ? eventOf(data as unknown as EventQueryRow) : null;
}

export async function getEventsByIds(supabase: Client, ids: string[]): Promise<EventSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("events").select(EVENT_SELECT).in("id", ids);
  if (error) throw error;
  const byId = new Map(((data ?? []) as unknown as EventQueryRow[]).map((r) => [r.id, eventOf(r)]));
  return ids.map((id) => byId.get(id)).filter((e): e is EventSummary => Boolean(e));
}

// --- Saved ---------------------------------------------------------------------------------------------------------------

export async function getSavedEventIds(supabase: Client, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("event_saves").select("event_id").eq("user_id", userId);
  if (error) {
    if (isMissingRelation(error)) return new Set();
    throw error;
  }
  return new Set((data ?? []).map((r) => r.event_id));
}

/** The caller's saved events, the most recently saved first (an event that was deleted is simply gone). */
export async function listSavedEvents(supabase: Client, userId: string): Promise<EventSummary[]> {
  const { data, error } = await supabase.from("event_saves").select(`created_at, event:events!event_saves_event_id_fkey(${EVENT_SELECT})`).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as { event: EventQueryRow | EventQueryRow[] | null }[])
    .map((r) => (Array.isArray(r.event) ? r.event[0] : r.event))
    .filter((e): e is EventQueryRow => Boolean(e))
    .map(eventOf);
}

/** Toggle a bookmark; returns the new saved state. */
export async function toggleEventSave(supabase: Client, userId: string, eventId: string): Promise<boolean> {
  const { data, error } = await supabase.from("event_saves").select("event_id").eq("user_id", userId).eq("event_id", eventId).maybeSingle();
  if (error) throw error;
  if (data) {
    const { error: e } = await supabase.from("event_saves").delete().eq("user_id", userId).eq("event_id", eventId);
    if (e) throw e;
    return false;
  }
  const { error: e } = await supabase.from("event_saves").insert({ user_id: userId, event_id: eventId });
  if (e) throw e;
  return true;
}

// --- Interests and For you ------------------------------------------------------------------------------------------------

export async function getEventInterests(supabase: Client, userId: string): Promise<EventCategory[]> {
  const { data, error } = await supabase.from("event_interests").select("category").eq("user_id", userId);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.category as EventCategory);
}

/** Replaces the caller's interests with these. */
export async function setEventInterests(supabase: Client, userId: string, categories: EventCategory[]): Promise<void> {
  const wanted = [...new Set(categories)];
  const { error: del } = await supabase.from("event_interests").delete().eq("user_id", userId);
  if (del) throw del;
  if (wanted.length === 0) return;
  const { error } = await supabase.from("event_interests").insert(wanted.map((category) => ({ user_id: userId, category })));
  if (error) throw error;
}

/**
 * What the For you ranking knows about the caller: picked interests, followed organizations, saved events, and the
 * categories of what they saved and opened before (their own rows only; the database lets nobody read anyone else's).
 */
export async function getForYouContext(supabase: Client, userId: string): Promise<ForYouContext> {
  const [interests, follows, saves, opened] = await Promise.all([
    getEventInterests(supabase, userId),
    supabase.from("organization_follows").select("organization_id").eq("user_id", userId),
    supabase.from("event_saves").select("event_id, event:events!event_saves_event_id_fkey(category)").eq("user_id", userId),
    supabase.from("event_engagement").select("event:events!event_engagement_event_id_fkey(category)").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
  ]);
  const categoryOf = (r: { event: { category: string } | { category: string }[] | null }) => (Array.isArray(r.event) ? r.event[0]?.category : r.event?.category);
  const history = [...((saves.data ?? []) as unknown as { event: { category: string } | null }[]), ...((opened.data ?? []) as unknown as { event: { category: string } | null }[])].map(categoryOf).filter((c): c is string => Boolean(c));
  return {
    interests,
    followedOrganizationIds: (follows.data ?? []).map((r) => r.organization_id),
    affinity: affinityFrom(history),
    savedIds: new Set(((saves.data ?? []) as unknown as { event_id: string }[]).map((r) => r.event_id)),
  };
}

/** Counts an open, a registration tap or a share, once a day per person; never fails the caller. */
export async function recordEventClick(supabase: Client, eventId: string, kind: "open" | "register" | "share" = "open"): Promise<void> {
  try {
    await supabase.rpc("record_event_click", { p_event: eventId, p_kind: kind });
  } catch {
    // Analytics only.
  }
}

// --- Organizations ------------------------------------------------------------------------------------------------------

export type OrganizationMemberWithProfile = { user_id: string; role: "owner" | "editor"; profile: { id: string; full_name: string; avatar_url: string | null; username: string } };
export type MyOrganization = Organization & { role: "owner" | "editor" };

export async function getOrganization(supabase: Client, id: string): Promise<Organization | null> {
  const { data, error } = await supabase.from("organizations").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  return data;
}

/** Organizations on a campus (every campus without one), verified ones first, then by followers; `q` narrows by name. */
export async function listOrganizations(supabase: Client, opts: { universityId?: string | null; q?: string; limit?: number } = {}): Promise<Organization[]> {
  let query = supabase.from("organizations").select("*").eq("status", "active").order("verified", { ascending: false }).order("follower_count", { ascending: false }).order("name").limit(opts.limit ?? 50);
  if (opts.universityId) query = query.eq("university_id", opts.universityId);
  const q = opts.q?.trim();
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return data ?? [];
}

export async function listOrganizationMembers(supabase: Client, organizationId: string): Promise<OrganizationMemberWithProfile[]> {
  const { data, error } = await supabase.from("organization_members").select("user_id, role, profile:profiles!organization_members_user_id_fkey(id, full_name, avatar_url, username)").eq("organization_id", organizationId).order("role").order("created_at");
  if (error) throw error;
  return ((data ?? []) as unknown as { user_id: string; role: string; profile: OrganizationMemberWithProfile["profile"] | OrganizationMemberWithProfile["profile"][] | null }[])
    .map((r) => ({ user_id: r.user_id, role: r.role as "owner" | "editor", profile: Array.isArray(r.profile) ? r.profile[0] : r.profile }))
    .filter((r): r is OrganizationMemberWithProfile => Boolean(r.profile));
}

/** The organizations the caller belongs to, with their role: who they may publish events for. */
export async function listMyOrganizations(supabase: Client, userId: string): Promise<MyOrganization[]> {
  const { data, error } = await supabase.from("organization_members").select("role, organization:organizations!organization_members_organization_id_fkey(*)").eq("user_id", userId);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as { role: string; organization: Organization | Organization[] | null }[])
    .map((r) => {
      const o = Array.isArray(r.organization) ? r.organization[0] : r.organization;
      return o ? { ...o, role: r.role as "owner" | "editor" } : null;
    })
    .filter((o): o is MyOrganization => o !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function organizationColumns(input: OrganizationFormInput) {
  return { name: input.name, kind: input.kind, description: input.description ?? null, website: input.website ?? null, avatar_url: input.avatarUrl ?? null };
}

/** A new organization: the database puts it on the caller's campus, unverified, with the caller as its owner. */
export async function createOrganization(supabase: Client, input: OrganizationFormInput): Promise<Organization> {
  const { data, error } = await supabase.from("organizations").insert(organizationColumns(input)).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateOrganization(supabase: Client, id: string, input: OrganizationFormInput): Promise<Organization> {
  const { data, error } = await supabase.from("organizations").update(organizationColumns(input)).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteOrganization(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.from("organizations").delete().eq("id", id);
  if (error) throw error;
}

export async function addOrganizationMember(supabase: Client, organizationId: string, userId: string, role: "owner" | "editor" = "editor"): Promise<void> {
  const { error } = await supabase.from("organization_members").upsert({ organization_id: organizationId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
}

export async function removeOrganizationMember(supabase: Client, organizationId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("organization_members").delete().eq("organization_id", organizationId).eq("user_id", userId);
  if (error) throw error;
}

export async function listFollowedOrganizationIds(supabase: Client, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("organization_follows").select("organization_id").eq("user_id", userId);
  if (error) {
    if (isMissingRelation(error)) return new Set();
    throw error;
  }
  return new Set((data ?? []).map((r) => r.organization_id));
}

/** Toggle a follow; returns the new state. */
export async function toggleOrganizationFollow(supabase: Client, userId: string, organizationId: string): Promise<boolean> {
  const { data, error } = await supabase.from("organization_follows").select("organization_id").eq("user_id", userId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  if (data) {
    const { error: e } = await supabase.from("organization_follows").delete().eq("user_id", userId).eq("organization_id", organizationId);
    if (e) throw e;
    return false;
  }
  const { error: e } = await supabase.from("organization_follows").insert({ user_id: userId, organization_id: organizationId });
  if (e) throw e;
  return true;
}

// --- Publishing ---------------------------------------------------------------------------------------------------------

function eventColumns(input: EventFormInput) {
  return {
    organization_id: input.organizationId,
    title: input.title,
    description: input.description ?? null,
    starts_at: input.startsAt,
    ends_at: input.endsAt ?? null,
    all_day: input.allDay,
    location: input.location ?? null,
    category: input.category,
    image_url: input.imageUrl ?? null,
    registration_url: input.registrationUrl ?? null,
    status: input.cancelled ? "cancelled" : "scheduled",
  };
}

/** A member publishes an event for their organization (pending until staff verify the organization). */
export async function createEvent(supabase: Client, input: EventFormInput): Promise<EventSummary> {
  const { data, error } = await supabase.from("events").insert({ ...eventColumns(input), source: "organization" }).select(EVENT_SELECT).single();
  if (error) throw error;
  return eventOf(data as unknown as EventQueryRow);
}

export async function updateEvent(supabase: Client, id: string, input: EventFormInput): Promise<EventSummary> {
  const { data, error } = await supabase.from("events").update(eventColumns(input)).eq("id", id).select(EVENT_SELECT).single();
  if (error) throw error;
  return eventOf(data as unknown as EventQueryRow);
}

/** Deletes an event; its picture goes too when it is the caller's own upload (the bucket lets owners delete theirs). */
export async function deleteEvent(supabase: Client, event: Pick<EventSummary, "id" | "image_url">, userId: string | null): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", event.id);
  if (error) throw error;
  const path = event.image_url && userId ? /\/object\/public\/uploads\/(events\/[^/?#]+\/[^/?#]+)$/.exec(event.image_url)?.[1] : null;
  if (path && path.startsWith(`events/${userId}/`)) await supabase.storage.from("uploads").remove([path]).catch(() => undefined);
}
