import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ADMIN_APP_NAME, PRODUCT_NAME } from "@/lib/brand";
import { getMainSiteUrl } from "@/lib/env";
import { firstParam, safeNextPath } from "@/lib/utils";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const error = firstParam(params.error);
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
          <ShieldCheck className="h-8 w-8" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{ADMIN_APP_NAME}</h1>
          <p className="mt-1 text-sm text-gray-600">Staff sign-in for {PRODUCT_NAME}. A verified two-factor code is required after this step.</p>
        </div>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">
        <LoginForm next={next} initialError={error} google={process.env.NEXT_PUBLIC_GOOGLE_LOGIN !== "off"} />
      </div>
      <p className="mt-6 max-w-md text-center text-xs text-gray-500">
        Use the account an owner added to the team. Accounts are created on{" "}
        <a href={getMainSiteUrl()} className="font-medium text-brand-600 hover:underline">
          {PRODUCT_NAME}
        </a>
        ; there is no sign-up here. Forgot your password? Ask an owner or admin to send you a reset email from the Staff page.
      </p>
    </main>
  );
}
