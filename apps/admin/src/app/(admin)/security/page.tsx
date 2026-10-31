import type { Metadata } from "next";
import { getMfaStatus } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { firstParam, safeNextPath } from "@/lib/utils";
import { MfaPanel } from "@/components/security/mfa-panel";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  // Enrolment and verification happen before the session is aal2, so this page must not require it.
  await requireStaff("/security", { mfa: false });
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const status = await getMfaStatus(await createClient());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title="Security" description="Two-factor authentication for your staff account. It is mandatory for every action in this app." />
      <MfaPanel status={status} next={next} />
    </div>
  );
}
