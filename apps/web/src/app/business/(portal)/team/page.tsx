import type { Metadata } from "next";
import { listInvites, listTeam, teamRoleAllows, teamRoleOf } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { getBusinessSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { TeamPanel } from "@/components/business/team-panel";
import { PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { user, membership } = await requireBusiness("/team");
  const supabase = await createClient();
  const manages = teamRoleAllows(membership.role, "manage_team");
  const [members, invites] = await Promise.all([listTeam(supabase, membership.business.id), manages ? listInvites(supabase, membership.business.id) : Promise.resolve([])]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader title="Team" subtitle="Owners and admins run the team, the profile and ad spend; editors post and answer students; analysts read the numbers and never see students' messages." />
      <TeamPanel
        members={members.map((m) => ({ userId: m.user_id, role: teamRoleOf(m.role), name: m.profile?.full_name ?? "Teammate", avatarUrl: m.profile?.avatar_url ?? null, joinedAt: m.created_at }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: teamRoleOf(i.role), link: `${getBusinessSiteUrl()}/join/${i.token}`, expiresAt: i.expires_at }))}
        currentUserId={user.id}
        myRole={membership.role}
      />
    </div>
  );
}
