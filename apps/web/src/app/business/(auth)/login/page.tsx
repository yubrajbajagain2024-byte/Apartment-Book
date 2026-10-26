import type { Metadata } from "next";
import { BusinessLoginForm } from "@/components/business/auth-forms";
import { firstParam, safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Log in" };

export default async function BusinessLoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-center text-2xl font-bold">Business login</h1>
      <p className="mb-6 text-center text-sm text-gray-600">For businesses and their teams. Students use the UniBuzz app.</p>
      <BusinessLoginForm next={safeNextPath(firstParam(params.next))} initialError={firstParam(params.error)} />
    </>
  );
}
