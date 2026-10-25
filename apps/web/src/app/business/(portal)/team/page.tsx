import type { Metadata } from "next";
import { listInvites, listTeam } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { getBusinessSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { TeamPanel } from "@/components/business/team-panel";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { user, membership } = await requireBusiness("/team");
  const supabase = await createClient();
  const isOwner = membership.role === "owner";
  const [members, invites] = await Promise.all([listTeam(supabase, membership.business.id), isOwner ? listInvites(supabase, membership.business.id) : Promise.resolve([])]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-600">Everyone on the team sees every inquiry and can post and edit listings and deals. Only the owner edits the business profile and the team.</p>
      </div>
      <TeamPanel
        members={members.map((m) => ({ userId: m.user_id, role: m.role === "owner" ? "owner" : "staff", name: m.profile?.full_name ?? "Teammate", avatarUrl: m.profile?.avatar_url ?? null, joinedAt: m.created_at }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, link: `${getBusinessSiteUrl()}/join/${i.token}`, expiresAt: i.expires_at }))}
        currentUserId={user.id}
        isOwner={isOwner}
      />
    </div>
  );
}
