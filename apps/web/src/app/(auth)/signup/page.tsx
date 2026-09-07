import type { Metadata } from "next";
import { getAllowedEmailDomains } from "@apartment-book/shared";
import { SignupForm } from "@/components/auth/auth-forms";
import { createClient } from "@/lib/supabase/server";
import { firstParam, safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next), "/settings/profile?welcome=1");
  const domains = await getAllowedEmailDomains(await createClient()).catch(() => [] as string[]);
  return (
    <>
      <h1 className="mb-2 text-center text-2xl font-bold">Create your account</h1>
      {domains.length > 0 ? (
        <p className="mb-6 text-center text-sm text-gray-600">
          Every member is a verified student: sign up with your {domains.map((d) => `@${d}`).join(" or ")} email.
        </p>
      ) : (
        <div className="mb-6" />
      )}
      <SignupForm next={next} domains={domains} />
    </>
  );
}
