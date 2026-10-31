import "server-only";
import { staffFetch } from "./server";

/**
 * The Events page of the staff console reads the events_console_* functions (migration 61): staff only, moderators and
 * admins alike, through staffFetch (non-staff: not found). The shapes are the functions' JSON, snake_case as the rows.
 */

export interface ConsoleEventsCounts {
  organizations_pending: number;
  feeds_failing: number;
  events_upcoming: number;
}

export interface ConsoleFeed {
  id: string;
  university_id: string;
  university_name: string;
  organization_id: string | null;
  organization_name: string | null;
  name: string;
  url: string;
  kind: "ics" | "rss";
  enabled: boolean;
  default_category: string;
  last_synced_at: string | null;
  last_status: "ok" | "unchanged" | "error" | null;
  last_error: string | null;
  items_seen: number;
  created_at: string;
  updated_at: string;
  /** Scheduled or cancelled events of this feed still ahead. */
  upcoming: number;
}

export interface ConsoleOrganization {
  id: string;
  university_id: string;
  university_name: string;
  name: string;
  kind: string;
  description: string | null;
  avatar_url: string | null;
  website: string | null;
  verified: boolean;
  verified_at: string | null;
  status: "active" | "hidden";
  follower_count: number;
  created_at: string;
  created_by: string | null;
  creator_username: string | null;
  members: number;
  events: number;
}

export interface ConsoleEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  category: string;
  image_url: string | null;
  registration_url: string | null;
  source: "feed" | "organization";
  status: "scheduled" | "cancelled" | "pending" | "hidden";
  save_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
  university_id: string;
  university_name: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_verified: boolean | null;
  feed_id: string | null;
  feed_name: string | null;
}

export interface ConsoleEventsFilter {
  status?: string;
  source?: string;
  q?: string;
  university_id?: string;
  offset?: number;
  limit?: number;
  /** Default true: events still ahead (or ended within a day). */
  upcoming?: boolean;
}

export const fetchEventsCounts = () => staffFetch<ConsoleEventsCounts>("events_console_counts");
export const fetchEventFeeds = () => staffFetch<ConsoleFeed[]>("events_console_feeds");
export const fetchConsoleOrganizations = (filter: { verified?: boolean; status?: string; q?: string } = {}) => staffFetch<ConsoleOrganization[]>("events_console_organizations", { p_filter: filter });
export const fetchConsoleEvents = (filter: ConsoleEventsFilter = {}) => staffFetch<{ items: ConsoleEvent[]; total: number }>("events_console_events", { p_filter: filter });
