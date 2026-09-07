import Link from "next/link";
import { Suspense } from "react";
import { Home } from "lucide-react";
import { APP_NAME, getTotalUnread } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:basis-72">
            <Link href="/" className="flex shrink-0 items-center gap-2 text-brand-600" aria-label={APP_NAME}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white">
                <Home className="h-6 w-6" />
              </span>
              <span className="hidden text-xl font-bold lg:inline">{APP_NAME}</span>
            </Link>
            <Suspense fallback={null}>
              <SearchBox className="min-w-0 flex-1 md:w-56 md:flex-none lg:w-64" />
            </Suspense>
          </div>

          <div className="hidden flex-1 justify-center md:flex">
            <NavTabs unread={unread} userId={user?.id ?? null} />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 md:basis-72">
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
