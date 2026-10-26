import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getMfaStatus, STAFF_ROLES } from "@apartment-book/shared";
import { getStaffAccess } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { ADMIN_APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "@/components/auth/password-form";

export const metadata: Metadata = { title: "Choose a password" };

/**
 * Staff only. Reached from an invitation or password-reset email (or from Security). A
 * member who already has two-factor must pass it in this session first; a new member
 * sets the password, then two-factor (mandatory) on /security.
 */
export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/password");
  const access = await getStaffAccess();
  if (!access) redirect("/no-access");
  const status = await getMfaStatus(await createClient());
  if (status.enrolled && !status.verified) redirect("/security?next=/password");
  const role = STAFF_ROLES.find((r) => r.value === access.role)?.label ?? access.role;
  const firstTime = !status.enrolled;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900">{firstTime ? `Welcome to ${ADMIN_APP_NAME}` : "Choose a new password"}</h1>
            <p className="text-sm text-gray-600">
              {firstTime ? `Your address is confirmed and you are on the team as ${role}. Choose a password, then set up two-factor authentication.` : `Signed in as ${user.email}.`}
            </p>
          </div>
        </div>
        <PasswordForm email={user.email ?? ""} firstTime={firstTime} />
      </div>
    </main>
  );
}
