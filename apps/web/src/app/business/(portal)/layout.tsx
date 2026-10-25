import { redirect } from "next/navigation";
import { Briefcase, LogOut } from "lucide-react";
import { APP_NAME, BUSINESS_PORTAL_NAME, getTotalUnread, isBusinessRole, standingOf } from "@apartment-book/shared";
import { businessSignOutAction } from "@/lib/actions/business";
import { getPortalSession, portalPath } from "@/lib/business/portal";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PortalNav } from "@/components/business/portal-nav";
import { StatusBanner } from "@/components/business/status-banner";

/** Everything behind the portal's login: the navigation, the business's review status, and the pages. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession();
  if (!session) redirect(await portalPath("/login"));
  const { user, profile, role, membership } = session;

  // A student who signed in here by mistake, or a business account whose team let them go: say so, offer the way out.
  if (role === "student" || (isBusinessRole(role) && !membership)) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 bg-aurora text-white">
            <Briefcase className="h-6 w-6" />
          </span>
          {role === "student" ? (
            <>
              <h1 className="text-xl font-bold text-gray-900">This is {BUSINESS_PORTAL_NAME}</h1>
              <p className="text-sm text-gray-600">
                Your account is a student account. Housing, roommates, the marketplace and your messages are on {APP_NAME}.
              </p>
              <a href={getSiteUrl()} className="font-semibold text-brand-600 hover:underline">
                Go to {APP_NAME}
              </a>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900">You are not on a team right now</h1>
              <p className="text-sm text-gray-600">The business you worked with removed your access. Ask its owner for a new invite link if that was a mistake.</p>
            </>
          )}
          <form action={businessSignOutAction}>
            <Button type="submit" variant="outline">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const standing = membership ? standingOf(membership.business) : null;
  // Suspended: nothing of the business is open, only why (the database closes the rest on every request too).
  if (membership && standing === "suspended") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-lg flex-col gap-4">
          <StatusBanner business={membership.business} />
          <form action={businessSignOutAction} className="self-center">
            <Button type="submit" variant="outline">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </form>
        </div>
      </main>
    );
  }
  const unread = membership && standing === "approved" ? await getTotalUnread(await createClient()).catch(() => 0) : 0;
  return (
    <>
      <PortalNav
        user={{ id: user.id, name: profile.full_name || user.email?.split("@")[0] || "You", avatarUrl: profile.avatar_url }}
        business={membership ? { name: membership.business.name, role: membership.role, standing: standing ?? "pending" } : null}
        isAdmin={role === "admin"}
        unread={unread}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">
        {membership ? <StatusBanner business={membership.business} /> : null}
        {children}
      </main>
    </>
  );
}
