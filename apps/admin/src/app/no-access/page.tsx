import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { getStaffAccess } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { ADMIN_APP_NAME, PRODUCT_NAME } from "@/lib/brand";
import { getMainSiteUrl } from "@/lib/env";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

/** Signed in, but not staff (or suspended staff): say so plainly and offer the way out. */
export default async function NoAccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await getStaffAccess().catch(() => null);
  if (access) redirect("/");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <ShieldOff className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-gray-900">This account is not on the team</h1>
        <p className="mt-2 text-sm text-gray-600">
          {ADMIN_APP_NAME} is only for the people who run {PRODUCT_NAME}. You are signed in as <span className="font-medium text-gray-900">{user.email}</span>, and that
          account has no staff access. If it should, ask an owner to add it from the Staff page.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <form action={signOutAction}>
            <Button type="submit" className="w-full">
              Log out
            </Button>
          </form>
          <a href={getMainSiteUrl()} className="text-sm font-medium text-brand-600 hover:underline">
            Go to {PRODUCT_NAME}
          </a>
        </div>
      </div>
    </main>
  );
}
