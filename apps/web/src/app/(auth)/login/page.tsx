import type { Metadata } from "next";
import { getAllowedEmailDomains } from "@apartment-book/shared";
import { LoginForm } from "@/components/auth/auth-forms";
import { createClient } from "@/lib/supabase/server";
import { firstParam, safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const error = firstParam(params.error);
  const domains = await getAllowedEmailDomains(await createClient()).catch(() => [] as string[]);
  return (
    <>
      <h1 className="mb-6 text-center text-2xl font-bold">Welcome back</h1>
      <LoginForm next={next} initialError={error} domains={domains} />
    </>
  );
}
