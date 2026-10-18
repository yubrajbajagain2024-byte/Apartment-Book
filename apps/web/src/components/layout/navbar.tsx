import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { APP_NAME, getTotalUnread, getUnreadNotificationCount } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LinkButton } from "@/components/ui/button";
import { BottomNav } from "./bottom-nav";
import { CreateMenu, UserMenu } from "./menus";
import { NavTabs } from "./nav-tabs";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SearchBox } from "./search-box";

export async function Navbar() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  let unread = 0;
  let unreadNotifications = 0;
  if (user) {
    const supabase = await createClient();
    [unread, unreadNotifications] = await Promise.all([
      getTotalUnread(supabase).catch(() => 0),
      getUnreadNotificationCount(supabase).catch(() => 0),
    ]);
  }
  const displayName = profile?.full_name || user?.email?.split("@")[0] || "You";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:basis-72 2xl:basis-[30rem]">
            {/* The mark: a serif monogram in an ink disc, and the wordmark in the same serif where there is room. */}
            <Link href="/" className="flex shrink-0 items-center gap-2.5 text-gray-900" aria-label={APP_NAME}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 font-display text-[17px] leading-none text-white">C</span>
              <span className="hidden font-display text-[22px] tracking-tight 2xl:inline">{APP_NAME}</span>
            </Link>
            <Suspense fallback={null}>
              {/* Phones get a magnifier in the right-hand group instead (TikTok style): four 40px buttons left this box about 100px wide. */}
              <SearchBox className="hidden min-w-0 flex-1 md:block md:w-56 md:flex-none 2xl:w-64" />
            </Suspense>
          </div>

          <div className="hidden flex-1 justify-center md:flex">
            <NavTabs unread={unread} userId={user?.id ?? null} />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 md:basis-72 2xl:basis-[30rem]">
            <Link href="/search" aria-label="Search" className="ab-press flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-900 hover:bg-gray-200 md:hidden">
              <Search className="h-5 w-5" />
            </Link>
            {user ? (
              <>
                <CreateMenu />
                <NotificationBell userId={user.id} initialCount={unreadNotifications} />
                <UserMenu userId={user.id} name={displayName} avatarUrl={profile?.avatar_url ?? null} />
              </>
            ) : (
              <>
                <LinkButton href="/login" variant="ghost" size="sm">
                  Log in
                </LinkButton>
                <LinkButton href="/signup" size="sm">
                  Sign up
                </LinkButton>
              </>
            )}
          </div>
        </div>
      </header>
      <BottomNav unread={unread} userId={user?.id ?? null} />
    </>
  );
}
