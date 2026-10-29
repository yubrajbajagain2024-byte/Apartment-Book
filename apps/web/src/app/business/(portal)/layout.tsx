import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Briefcase, LogOut } from "lucide-react";
import { APP_NAME, BUSINESS_PORTAL_NAME, countUnreadPortalNotifications, getTotalUnread, isBusinessRole, standingOf, teamRoleAllows } from "@apartment-book/shared";
import { businessSignOutAction } from "@/lib/actions/business";
import { getPortalSession, portalPath } from "@/lib/business/portal";
import { PORTAL_THEME_COOKIE, portalThemeOf } from "@/lib/business/theme";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { PortalSidebar } from "@/components/business/portal-sidebar";
import { StatusBanner } from "@/components/business/status-banner";
import { bizButton } from "@/components/business/ui";

/** Everything behind the portal's login: the sidebar, the business's review status, and the pages. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession();
  if (!session) redirect(await portalPath("/login"));
  const { user, profile, role, membership } = session;

  // A student who signed in here by mistake, or a business account whose team let them go: say so, offer the way out.
  if (role === "student" || (isBusinessRole(role) && !membership)) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="ab-fade-in flex w-full max-w-md flex-col items-center gap-4 rounded-[28px] bg-biz-surface p-10 text-center shadow-biz ring-1 ring-biz-line">
          <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-biz-accent text-biz-on-accent">
            <Briefcase className="h-7 w-7" />
          </span>
          {role === "student" ? (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">This is {BUSINESS_PORTAL_NAME}</h1>
              <p className="text-[15px] leading-relaxed text-biz-ink-3">Your account is a student account. Your feed, Buzz, messages, housing and the marketplace are on {APP_NAME}.</p>
              <a href={getSiteUrl()} className={bizButton({ variant: "primary" })}>
                Go to {APP_NAME}
              </a>
            </>
          ) : (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-biz-ink">You are not on a team right now</h1>
              <p className="text-[15px] leading-relaxed text-biz-ink-3">The business you worked with removed your access. Ask its owner for a new invite link if that was a mistake.</p>
            </>
          )}
          <form action={businessSignOutAction}>
            <button type="submit" className={bizButton({ variant: "ghost" })}>
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </form>
        </div>
      </main>
    );
  }

  const standing = membership ? standingOf(membership.business) : null;
  // Suspended: nothing of the business is open, only why (the database closes the rest on every request too).
  if (membership && standing === "suspended") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="flex w-full max-w-lg flex-col gap-4">
          <StatusBanner business={membership.business} />
          <form action={businessSignOutAction} className="self-center">
            <button type="submit" className={bizButton({ variant: "ghost" })}>
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </form>
        </div>
      </main>
    );
  }
  const supabase = await createClient();
  const canReply = Boolean(membership && standing === "approved" && teamRoleAllows(membership.role, "reply"));
  const [unread, notifications, jar] = await Promise.all([
    canReply ? getTotalUnread(supabase).catch(() => 0) : Promise.resolve(0),
    membership ? countUnreadPortalNotifications(supabase).catch(() => 0) : Promise.resolve(0),
    cookies(),
  ]);
  return (
    <>
      <PortalSidebar
        user={{ id: user.id, name: profile.full_name || user.email?.split("@")[0] || "You", avatarUrl: profile.avatar_url }}
        business={membership ? { name: membership.business.name, logoUrl: membership.business.logo_url, role: membership.role, standing: standing ?? "pending" } : null}
        isAdmin={role === "admin"}
        unread={unread}
        notifications={notifications}
        theme={portalThemeOf(jar.get(PORTAL_THEME_COOKIE)?.value)}
      />
      <div className="flex flex-1 flex-col lg:pl-[var(--biz-sidebar-width)] print:pl-0">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
          {membership ? <StatusBanner business={membership.business} /> : null}
          {children}
        </main>
      </div>
    </>
  );
}
