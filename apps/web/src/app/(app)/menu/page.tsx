import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Bookmark, Building2, ChevronRight, FileText, LogOut, Settings, Shield, ShoppingBag, User, Users } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export const metadata: Metadata = { title: "Menu" };

function MenuLink({ href, icon: Icon, children }: { href: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 text-gray-400" />
    </Link>
  );
}

/** Phone "Menu" tab: profile, shortcuts, settings and legal pages. */
export default async function MenuPage() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Menu</h1>
      {user ? (
        <Card>
          <Link href={`/profile/${user.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50">
            <Avatar name={profile?.full_name ?? "You"} src={profile?.avatar_url} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold text-gray-900">
                <span className="truncate">{profile?.full_name ?? user.email}</span>
                {profile?.university?.email_domain ? <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Verified student" /> : null}
              </span>
              <span className="block truncate text-sm text-gray-500">{profile?.university?.name ?? "View your profile"}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="font-semibold text-gray-900">Texas State students only</p>
            <p className="text-sm text-gray-600">Log in or sign up with your @txstate.edu email to message, save and post.</p>
            <LinkButton href="/login">Log in</LinkButton>
            <LinkButton href="/signup" variant="secondary">
              Create account
            </LinkButton>
          </CardBody>
        </Card>
      )}

      <Card className="divide-y divide-gray-100 overflow-hidden">
        <MenuLink href="/" icon={Building2}>
          Apartments
        </MenuLink>
        <MenuLink href="/roommates" icon={Users}>
          Roommates
        </MenuLink>
        <MenuLink href="/marketplace" icon={ShoppingBag}>
          Marketplace
        </MenuLink>
        {user ? (
          <>
            <MenuLink href="/profile/me" icon={User}>
              My listings
            </MenuLink>
            <MenuLink href="/saved" icon={Bookmark}>
              Saved
            </MenuLink>
            <MenuLink href="/settings/profile" icon={Settings}>
              Settings
            </MenuLink>
          </>
        ) : null}
      </Card>

      <Card className="divide-y divide-gray-100 overflow-hidden">
        <MenuLink href="/privacy" icon={Shield}>
          Privacy policy
        </MenuLink>
        <MenuLink href="/terms" icon={FileText}>
          Terms of use
        </MenuLink>
      </Card>

      {user ? (
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </form>
      ) : null}
    </div>
  );
}
