import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { getBusinessAudit } from "@apartment-book/shared";
import { auditActionLabel, auditDetailLine } from "@/lib/business/audit-format";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { PortalLink } from "@/components/business/portal-base";
import { BizLink, EmptyPanel, PageHeader, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Audit log" };

/** Who did what to which business: reviews, team changes, posts, ads and payments. Append-only in the database. */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdmin("/admin/audit");
  const before = Number(firstParam((await searchParams).before)) || null;
  const rows = await getBusinessAudit(await createClient(), null, { limit: 50, before });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" subtitle="Every review, payment, ad decision and team change, newest first. Nobody can edit or delete an entry, the database owner included." />
      {rows.length === 0 ? (
        <EmptyPanel icon={ScrollText} title="Nothing logged yet" />
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-biz-line bg-biz-surface-2 text-biz-ink-3">
              <tr>
                <th scope="col" className="px-6 py-2.5 font-medium">When</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Business</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Who</th>
                <th scope="col" className="px-3 py-2.5 font-medium">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-biz-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums text-biz-ink-3" suppressHydrationWarning>
                    {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-3 text-biz-ink">{r.business_name ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="text-biz-ink-2">{r.actor_name}</span> {r.actor_kind !== "team" ? <Pill tone={r.actor_kind === "admin" ? "accent" : "neutral"}>{r.actor_kind === "admin" ? "UniBuzz team" : "Automatic"}</Pill> : null}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-biz-ink">{auditActionLabel(r.action)}</span>
                    {auditDetailLine(r.detail) ? <span className="block text-biz-ink-3">{auditDetailLine(r.detail)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <div className="flex justify-between">
        {before ? <PortalLink href="/admin/audit" className="text-[13px] font-medium text-biz-accent-ink hover:underline">Newest</PortalLink> : <span />}
        {rows.length === 50 ? (
          <BizLink href={`/admin/audit?before=${rows[rows.length - 1].id}`} variant="secondary" size="sm">
            Older
          </BizLink>
        ) : null}
      </div>
    </div>
  );
}
