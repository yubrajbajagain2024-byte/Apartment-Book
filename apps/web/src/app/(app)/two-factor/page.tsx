import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { staffMetadata, viewerRole } from "@/lib/staff/server";
import { StaffTwoFactor } from "@/components/staff/two-factor";

export const generateMetadata = () => staffMetadata("Two-factor sign-in");

/**
 * Before the staff console opens: confirm it's you with an authenticator app (Supabase TOTP), or add one. The same
 * account and the same app as CampConnect Admin. Everyone who is not staff gets the not-found page, like the console.
 */
export default async function TwoFactorPage() {
  if (!(await viewerRole())) notFound();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="staff-two-factor">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold leading-tight text-gray-900">Two-factor sign-in</h1>
      </header>
      <StaffTwoFactor />
    </div>
  );
}
