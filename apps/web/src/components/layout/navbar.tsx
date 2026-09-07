import Link from "next/link";
import { Suspense } from "react";
import { APP_NAME, getTotalUnread } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Logo, LogoMark } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";
import { BottomNav } from "./bottom-nav";
import { CreateMenu, UserMenu } from "./menus";
import { NavTabs } from "./nav-tabs";
import { SearchBox } from "./search-box";

export async function Navbar() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  let unread = 0;
  if (user) {
    try {
      unread = await getTotalUnread(await createClient());
    } catch {
      unread = 0;
    }
  }
  const displayName = profile?.full_name || user?.email?.split("@")[0] || "You";

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-3 sm:px-4 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
            <Link href="/" className="flex shrink-0 items-center" aria-label={APP_NAME}>
              <span className="lg:hidden">
                <LogoMark />
              </span>
              <span className="hidden lg:inline-flex">
                <Logo />
              </span>
            </Link>
            <Suspense fallback={null}>
              <SearchBox className="min-w-0 flex-1 md:max-w-[260px]" />
            </Suspense>
          </div>

          <div className="hidden justify-center md:flex">
            <NavTabs unread={unread} userId={user?.id ?? null} />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {user ? (
              <>
                <CreateMenu />
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
