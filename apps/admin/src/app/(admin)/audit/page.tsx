import type { Metadata } from "next";
import { listAuditLog } from "@apartment-book/shared";
import { requireStaff } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { AuditList } from "@/components/audit/audit-list";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireStaff("/audit");
  const entries = await listAuditLog(await createClient(), { limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        description="Every team change, security event and moderation action, newest first, with who did it and why. Entries cannot be edited or deleted. Moderators see moderation activity and their own rows."
      />
      <AuditList initial={entries} />
    </div>
  );
}
