import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Bell, LogOut } from "lucide-react";
import { countUnreadPortalNotifications, standingOf, teamRoleAllows, teamRoleLabel } from "@apartment-book/shared";
import { businessSignOutAction, markPortalNotificationsReadAction } from "@/lib/actions/business";
import { requirePortalSession } from "@/lib/business/portal";
import { PORTAL_THEME_COOKIE, portalThemeOf } from "@/lib/business/theme";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { MessageAlertsSetting } from "@/components/business/message-alerts";
import { SettingsTabs } from "@/components/business/section-tabs";
import { ThemeSwitch } from "@/components/business/theme-switch";
import { BizButton, BizLink, PageHeader, Panel, PanelHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Account · Settings" };

/**
 * Account and preferences: who is signed in and in which role, the portal's appearance, the notifications, and logging
 * out. Also the UniBuzz team's Settings when they have no business of their own.
 */
export default async function AccountPage() {
  const session = await requirePortalSession("/settings/account");
  const { user, profile, membership } = session;
  const [unread, jar] = await Promise.all([membership ? countUnreadPortalNotifications(await createClient()).catch(() => 0) : Promise.resolve(0), cookies()]);
  const name = profile.full_name || user.email?.split("@")[0] || "You";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader title="Account and preferences" subtitle="Your sign-in, how the portal looks, and your notifications." />
      {membership ? <SettingsTabs active="account" team={standingOf(membership.business) !== "rejected"} /> : null}

      <Panel className="flex items-center gap-4 p-6" data-testid="account">
        <Avatar name={name} src={profile.avatar_url} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-biz-ink">{name}</p>
          <p className="truncate text-[14px] text-biz-ink-3">{user.email}</p>
          <p className="text-[13px] text-biz-ink-4">{membership ? `${teamRoleLabel(membership.role)} · ${membership.business.name}` : "UniBuzz team"}</p>
        </div>
      </Panel>

      <Panel className="pb-6">
        <PanelHeader title="Appearance" subtitle="Light, dark or your device's setting; remembered on this browser." />
        <div className="max-w-sm px-6 pt-4">
          <ThemeSwitch initial={portalThemeOf(jar.get(PORTAL_THEME_COOKIE)?.value)} />
        </div>
      </Panel>

      {membership && standingOf(membership.business) === "approved" && teamRoleAllows(membership.role, "reply") ? (
        <Panel className="pb-6">
          <PanelHeader title="Message alerts" subtitle="New messages from students show in the portal as they arrive, on the Inbox's badge and in the tab's title." />
          <div className="px-6 pt-4">
            <MessageAlertsSetting />
          </div>
        </Panel>
      ) : null}

      {membership ? (
        <Panel className="pb-6">
          <PanelHeader title="Notifications" subtitle="Reviews of your business and ads, role changes, and campaigns starting and ending appear in the portal." />
          <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
            <BizLink href="/notifications" variant="secondary">
              <Bell className="h-4 w-4" /> {unread ? `See ${unread} new` : "See notifications"}
            </BizLink>
            {unread ? (
              <form action={markPortalNotificationsReadAction}>
                <BizButton type="submit" variant="ghost">
                  Mark all as read
                </BizButton>
              </form>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[17px] font-semibold text-biz-ink">Log out</h2>
          <p className="mt-0.5 text-[13px] text-biz-ink-3">Sign out of {membership ? membership.business.name : "the portal"} on this browser.</p>
        </div>
        <form action={businessSignOutAction}>
          <BizButton type="submit" variant="outline">
            <LogOut className="h-4 w-4" /> Log out
          </BizButton>
        </form>
      </Panel>
    </div>
  );
}
