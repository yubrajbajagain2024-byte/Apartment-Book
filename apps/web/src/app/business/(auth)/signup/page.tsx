import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { BusinessSignupForm } from "@/components/business/auth-forms";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign up" };

export default async function BusinessSignupPage() {
  const universities = await listUniversities(await createClient()).catch(() => []);
  return (
    <>
      <h1 className="mb-1 text-center text-2xl font-bold">List your business</h1>
      <p className="mb-6 text-center text-sm text-gray-600">
        Create your account now. The UniBuzz team reviews every business before its listings and deals go in front of students.
      </p>
      <BusinessSignupForm universities={universities} />
    </>
  );
}
