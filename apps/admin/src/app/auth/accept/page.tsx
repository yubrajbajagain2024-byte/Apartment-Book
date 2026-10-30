import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ADMIN_APP_NAME } from "@/lib/brand";
import { firstParam, safeNextPath } from "@/lib/utils";
import { AcceptLink } from "@/components/auth/accept-link";

export const metadata: Metadata = { title: "Opening your link" };

export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next), "/password");
  const error = firstParam(params.error_description);
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-gray-900">{ADMIN_APP_NAME}</h1>
        <AcceptLink next={next} serverError={error ?? null} />
      </div>
    </main>
  );
}
