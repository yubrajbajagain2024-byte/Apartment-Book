import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { businessConversations, getBusinessOverview, listConversations, listTeam, standingOf } from "@apartment-book/shared";
import { getPortalSession, portalPath } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DashboardView } from "@/components/business/dashboard-view";
import { PortalLink } from "@/components/business/portal-base";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getPortalSession();
  if (!session) redirect(await portalPath("/login"));
  // An admin without a business of their own lands on the review queue.
  if (!session.membership) redirect(await portalPath(session.role === "admin" ? "/admin" : "/login"));
  const { user, membership } = session;
  const business = membership.business;
  // Rejected: the banner above says why; the profile is the one thing left to do.
  if (standingOf(business) === "rejected") {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
        <h1 className="text-xl font-bold text-gray-900">{business.name}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {membership.role === "owner" ? "Update the business profile with what the UniBuzz team asked for, then write to them to look again." : "The owner can update the business profile and ask the UniBuzz team to look again."}
        </p>
        {membership.role === "owner" ? (
          <PortalLink href="/profile" className="mt-4 inline-block font-semibold text-brand-600 hover:underline">
            Edit the business profile
          </PortalLink>
        ) : null}
      </div>
    );
  }
  const supabase = await createClient();
  const [overview, conversations, team] = await Promise.all([
    getBusinessOverview(supabase, business.id).catch(() => null),
    listConversations(supabase, user.id).catch(() => []),
    listTeam(supabase, business.id).catch(() => []),
  ]);
  const inbox = businessConversations(conversations, business.id, new Set(team.map((m) => m.user_id))).slice(0, 5);
  return <DashboardView firstName={session.profile.full_name.split(" ")[0] || "there"} business={business} role={membership.role} overview={overview} teamSize={team.length} inbox={inbox} />;
}
