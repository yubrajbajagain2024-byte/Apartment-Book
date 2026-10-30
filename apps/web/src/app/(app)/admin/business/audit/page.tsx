import Link from "next/link";
import { ScrollText } from "lucide-react";
import { getBusinessAudit } from "@apartment-book/shared";
import { auditActionLabel, auditDetailLine } from "@/lib/business/audit-format";
import { requireStaffAdmin, staffMetadata } from "@/lib/staff/server";
import { firstParam } from "@/lib/utils";
import { EmptyBox, Panel, Pill } from "@/components/staff/parts";
import { centralTime } from "@/components/staff/business/parts";
import { buttonClasses } from "@/components/ui/button";

export const generateMetadata = () => staffMetadata("Business audit · CampConnect Admin");

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The business audit log (Business v2, append-only): reviews, payments, ad decisions and team changes, by the team, the
 * businesses and the system, newest first; for every business or one (?business=<id>). The team's own notes and rate
 * changes are in the staff console's Audit tab instead.
 */
export default async function BusinessAuditPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaffAdmin();
  const params = await searchParams;
  const before = Number(firstParam(params.before)) || null;
  const rawBusiness = firstParam(params.business) ?? "";
  const businessId = UUID.test(rawBusiness) ? rawBusiness : null;
  const rows = await getBusinessAudit(me.supabase, businessId, { limit: PAGE, before });
  const href = (b: number | null) => {
    const sp = new URLSearchParams();
    if (businessId) sp.set("business", businessId);
    if (b) sp.set("before", String(b));
    const s = sp.toString();
    return s ? `/admin/business/audit?${s}` : "/admin/business/audit";
  };
  return (
    <div className="flex flex-col gap-3">
      {businessId ? (
        <p className="text-sm text-gray-600">
          One business&apos;s log.{" "}
          <Link href="/admin/business/audit" prefetch={false} className="font-medium text-brand-700 hover:underline">
            Every business
          </Link>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyBox icon={ScrollText} title="Nothing logged yet" />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{centralTime(new Date(r.created_at).getTime())}</td>
                  <td className="px-3 py-1.5">
                    {r.business_id ? (
                      <Link href={`/admin/business/advertisers/${r.business_id}`} prefetch={false} className="text-gray-900 hover:underline">
                        {r.business_name ?? "—"}
                      </Link>
                    ) : (
                      <span className="text-gray-500">{r.business_name ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-gray-800">{r.actor_name}</span> {r.actor_kind !== "team" ? <Pill tone={r.actor_kind === "admin" ? "blue" : "gray"}>{r.actor_kind === "admin" ? "UniBuzz team" : "Automatic"}</Pill> : null}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-gray-900">{auditActionLabel(r.action)}</span>
                    {auditDetailLine(r.detail) ? <span className="block text-xs text-gray-500">{auditDetailLine(r.detail)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <div className="flex justify-between">
        {before ? (
          <Link href={href(null)} prefetch={false} className="text-sm font-medium text-brand-700 hover:underline">
            Newest
          </Link>
        ) : (
          <span />
        )}
        {rows.length === PAGE ? (
          <Link href={href(rows[rows.length - 1]!.id)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
            Older
          </Link>
        ) : null}
      </div>
    </div>
  );
}
