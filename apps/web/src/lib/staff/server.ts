import "server-only";
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getStaffRole, type Client } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffRpc, toStaffError } from "./rpc";
import type {
  AuditRow, ModerationMetrics, QueueCounts, QueueView, RulePackState, StaffAppeal, StaffPage, StaffQueueItem, StaffQueueItemDetail, StaffRole,
  StaffUserDetail,
} from "./types";

export interface StaffViewer {
  id: string;
  role: StaffRole;
  name: string;
  username: string | null;
  supabase: Client;
}

/**
 * The signed-in staff member, or Next's notFound() for everyone else (signed out included): the console answers
 * "not found" like the database does, never "forbidden". Cached per request.
 */
export const requireStaff = cache(async (): Promise<StaffViewer> => {
  const user = await getCurrentUser();
  if (!user) notFound();
  const supabase = await createClient();
  const role = await viewerRole();
  if (!role) notFound();
  const profile = await getCurrentProfile();
  return { id: user.id, role, name: profile?.full_name || "Staff", username: profile?.username ?? null, supabase };
});

/** The caller's staff role, or null (signed out, or not staff). Cached per request. */
const viewerRole = cache(async (): Promise<StaffRole | null> => {
  if (!(await getCurrentUser())) return null;
  const role = await getStaffRole(await createClient()).catch(() => null);
  return role === "moderator" || role === "admin" ? role : null;
});

/**
 * Page metadata that names the console only to staff: everyone else gets the plain not-found page, and its title must
 * not say "Trust & Safety" either (the console answers like a page that does not exist).
 */
export async function staffMetadata(title: string): Promise<Metadata> {
  const robots = { index: false, follow: false };
  return (await viewerRole()) ? { title, robots } : { robots };
}

/** A staff function's answer, with "not found" turned into Next's notFound() (an item you may not see does not exist). */
export async function staffFetch<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabase } = await requireStaff();
  try {
    return await staffRpc<T>(supabase, fn, args);
  } catch (e) {
    if (toStaffError(e).code === "not_found") notFound();
    throw e;
  }
}

export interface QueueFilters {
  surface?: string;
  category?: string;
  source?: string;
  universityId?: string;
  q?: string;
}

export const fetchQueue = (view: QueueView, offset: number, limit: number, filters: QueueFilters) =>
  staffFetch<StaffPage<StaffQueueItem>>("staff_queue", { p_view: view, p_limit: limit, p_offset: offset, p_filters: filters });
export const fetchQueueCounts = cache(() => staffFetch<QueueCounts>("staff_queue_counts"));
export const fetchQueueItem = (id: string) => staffFetch<StaffQueueItemDetail>("staff_queue_item", { p_id: id });
export const fetchAudit = (offset: number, limit: number, filters: Record<string, string | number>) =>
  staffFetch<StaffPage<AuditRow>>("staff_audit", { p_limit: limit, p_offset: offset, p_filters: filters });
export const fetchUsers = (q: string, offset: number, limit: number) => staffFetch<StaffPage<StaffUserDetail>>("staff_users", { p_q: q, p_limit: limit, p_offset: offset });
export const fetchUser = (id: string) => staffFetch<StaffUserDetail>("staff_user", { p_id: id });
export const fetchAppeals = (view: string, offset: number, limit: number) => staffFetch<StaffPage<StaffAppeal>>("staff_appeals", { p_view: view, p_limit: limit, p_offset: offset });
export const fetchMetrics = (from: number, to: number) => staffFetch<ModerationMetrics>("staff_metrics", { p_from: from, p_to: to });
export const fetchRulePacks = () => staffFetch<RulePackState[]>("staff_rule_packs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route params that cannot be an id are simply not found (the database would refuse the cast). */
export function requireUuid(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}
