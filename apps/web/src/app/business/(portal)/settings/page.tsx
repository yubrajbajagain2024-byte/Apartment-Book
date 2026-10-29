import type { Metadata } from "next";
import { BadgeCheck, Bell, ChevronRight, Store, UserRound, Users, type LucideIcon } from "lucide-react";
import { businessCategoryLabel, countUnreadPortalNotifications, listInvites, listTeam, standingOf, teamRoleAllows, teamRoleLabel } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { PortalLink } from "@/components/business/portal-base";
import { SettingsTabs } from "@/components/business/section-tabs";
import { PageHeader, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Settings" };

const STANDING: Record<string, string> = { pending: "Waiting for review", approved: "Approved", rejected: "Not approved", suspended: "Suspended" };

/** Settings: the business's profile, its team, its verification, and the signed-in person's account, each a page. */
export default async function SettingsPage() {
  const { user, membership } = await requireBusiness("/settings", ["pending", "approved", "rejected"]);
  const business = membership.business;
  const standing = standingOf(business);
  const supabase = await createClient();
  const manages = teamRoleAllows(membership.role, "manage_team");
  const teamOpen = standing !== "rejected";
  const [team, invites, unread] = await Promise.all([
    teamOpen ? listTeam(supabase, business.id).catch(() => []) : Promise.resolve([]),
    teamOpen && manages ? listInvites(supabase, business.id).catch(() => []) : Promise.resolve([]),
    countUnreadPortalNotifications(supabase).catch(() => 0),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader title="Settings" subtitle="Your business's public profile, its team, its verification, and your own account." />
      <SettingsTabs active="overview" team={teamOpen} />
      <Panel className="divide-y divide-biz-line overflow-hidden" data-testid="settings">
        <Row
          href="/profile"
          icon={Store}
          title="Business profile"
          detail={`${business.name} · ${businessCategoryLabel(business.category)}`}
          note={teamRoleAllows(membership.role, "edit_profile") ? "Edit what students see on your public page." : "Only the owner and admins edit it."}
        />
        {teamOpen ? (
          <Row
            href="/team"
            icon={Users}
            title="Team"
            detail={`${team.length} ${team.length === 1 ? "member" : "members"}${manages && invites.length ? ` · ${invites.length} ${invites.length === 1 ? "invite" : "invites"} pending` : ""}`}
            note={manages ? "Invite people, change roles, remove access." : "Who works on this business, and their roles."}
          />
        ) : null}
        <Row
          href="/settings/verification"
          icon={BadgeCheck}
          title="Verification"
          detail={STANDING[standing]}
          badge={standing === "approved" && business.verified_partner ? <Pill tone="accent">Verified Partner</Pill> : null}
          note="Your review by the UniBuzz team, and the Verified Partner badge."
        />
        <Row href="/settings/account" icon={UserRound} title="Account and preferences" detail={`${user.email ?? "Your account"} · ${teamRoleLabel(membership.role)}`} note="Appearance, notifications, logging out." />
        <Row
          href="/notifications"
          icon={Bell}
          title="Notifications"
          detail={unread ? `${unread} new` : "All read"}
          note="Reviews of your business and ads, role changes, campaigns starting and ending."
        />
      </Panel>
    </div>
  );
}

function Row({ href, icon: Icon, title, detail, note, badge }: { href: string; icon: LucideIcon; title: string; detail: string; note: string; badge?: React.ReactNode }) {
  return (
    <PortalLink href={href} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-biz-surface-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-biz-surface-3 text-biz-ink-2">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-biz-ink">{title}</span>
          {badge}
        </span>
        <span className="block truncate text-[13px] text-biz-ink-2">{detail}</span>
        <span className="block text-[13px] text-biz-ink-4">{note}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-biz-ink-4" aria-hidden="true" />
    </PortalLink>
  );
}
