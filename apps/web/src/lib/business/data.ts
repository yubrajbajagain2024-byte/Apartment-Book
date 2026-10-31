import "server-only";
import { cache } from "react";
import { countUnreadPortalNotifications, getTotalUnread, listTeam, type BusinessMemberWithProfile } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/server";

/*
 * What several parts of one portal page ask for at once (the shell, the page, the inbox's list and its open chat all
 * render in the same request): read once per request, whoever asks first. React's cache() keeps the promise for the
 * request and no longer; nothing here outlives it or reaches another person.
 */

/** The business's team, with each member's profile. Empty when the database refuses or has no table yet. */
export const portalTeam = cache(async (businessId: string): Promise<BusinessMemberWithProfile[]> => listTeam(await createClient(), businessId).catch(() => []));

/** Unread messages across the inbox (the sidebar's badge and the tab's title start from it). */
export const portalUnreadMessages = cache(async (): Promise<number> => getTotalUnread(await createClient()).catch(() => 0));

/** Unread portal notifications (the bell). */
export const portalUnreadNotifications = cache(async (): Promise<number> => countUnreadPortalNotifications(await createClient()).catch(() => 0));
