import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  adDisplayStatus,
  businessConversations,
  canSeeBilling,
  formatMoneyByCurrency,
  getAnalyticsOverview,
  listAds,
  listBusinessPayments,
  listConversations,
  paymentTotals,
  standingOf,
  teamRoleAllows,
} from "@apartment-book/shared";
import { portalTeam } from "@/lib/business/data";
import { getPortalSession, portalPath } from "@/lib/business/portal";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { DashboardView } from "@/components/business/dashboard-view";
import { BizLink, Panel } from "@/components/business/ui";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const session = await getPortalSession();
  if (!session) redirect(await portalPath("/login"));
  // An admin without a business of their own lands on the review queue.
  if (!session.membership) redirect(await portalPath(session.role === "admin" ? "/admin" : "/login"));
  const { user, membership } = session;
  const business = membership.business;
  // Rejected: the banner above says why; the profile is the one thing left to do.
  if (standingOf(business) === "rejected") {
    const canEdit = teamRoleAllows(membership.role, "edit_profile");
    return (
      <Panel className="mx-auto max-w-xl p-10 text-center">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">{business.name}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-biz-ink-3">
          {canEdit ? "Update the business profile with what the UniBuzz team asked for, then write to them to look again." : "The owner or an admin can update the business profile and ask the UniBuzz team to look again."}
        </p>
        {canEdit ? (
          <BizLink href="/profile" className="mt-6">
            Edit the business profile
          </BizLink>
        ) : null}
      </Panel>
    );
  }
  const supabase = await createClient();
  const canReply = business.status === "approved" && teamRoleAllows(membership.role, "reply");
  const billing = canSeeBilling(membership.role);
  const [overview, ads, conversations, team, payments] = await Promise.all([
    getAnalyticsOverview(supabase, business.id, 30).catch(() => null),
    listAds(supabase, business.id).catch(() => []),
    canReply ? listConversations(supabase, user.id).catch(() => []) : Promise.resolve([]),
    portalTeam(business.id),
    billing ? listBusinessPayments(supabase, business.id).catch(() => null) : Promise.resolve(null),
  ]);
  const allInquiries = canReply ? businessConversations(conversations, business.id, new Set(team.map((m) => m.user_id))) : [];
  const inbox = allInquiries.slice(0, 5);
  const statuses = ads.map((a) => adDisplayStatus(a));
  const totals = payments ? paymentTotals(payments) : null;
  return (
    <DashboardView
      firstName={session.profile.full_name.split(" ")[0] || "there"}
      business={business}
      role={membership.role}
      overview={overview}
      ads={ads.slice(0, 4)}
      inbox={inbox}
      summary={{
        running: statuses.filter((s) => s === "active").length,
        scheduled: statuses.filter((s) => s === "scheduled").length,
        waiting: statuses.filter((s) => s === "pending_review").length,
        spend: totals ? { thisMonth: formatMoneyByCurrency(totals.thisMonth), allTime: formatMoneyByCurrency(totals.allTime) } : null,
        inquiries: canReply ? { unread: allInquiries.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0), total: allInquiries.length } : null,
      }}
      canReply={canReply}
      publicProfileUrl={business.status === "approved" ? `${getSiteUrl()}/businesses/${business.id}` : null}
    />
  );
}
