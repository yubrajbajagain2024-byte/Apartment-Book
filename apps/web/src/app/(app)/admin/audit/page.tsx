import Link from "next/link";
import { ScrollText } from "lucide-react";
import { AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/staff/constants";
import { stamp } from "@/lib/staff/format";
import { fetchAudit, requireStaff, staffMetadata } from "@/lib/staff/server";
import { cn, firstParam } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyBox, Pill, ROLE_TONE } from "@/components/staff/parts";

export const generateMetadata = () => staffMetadata("Audit · Trust & Safety");

const PAGE = 50;
const UNMASK = new Set(["buzz_unmask", "buzz_unmask_subject"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The audit log (UniVerse AuditPage, safety 6.6): append-only, nothing here can be edited or deleted. Moderators see
 * their own rows; admins everything (and may filter by actor). Unmask rows are highlighted.
 */
export default async function StaffAuditPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaff();
  const admin = me.role === "admin";
  const params = await searchParams;
  const action = firstParam(params.action) ?? "";
  const target = firstParam(params.target) ?? "";
  const actor = (firstParam(params.actor) ?? "").trim();
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const filters: Record<string, string> = {};
  if (action) filters.action = action;
  if (target) filters.targetType = target;
  if (admin && UUID.test(actor)) filters.actor = actor;
  const list = await fetchAudit(page * PAGE, PAGE, filters);
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (action) sp.set("action", action);
    if (target) sp.set("target", target);
    if (admin && actor) sp.set("actor", actor);
    if (p) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/admin/audit" className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Action
          <Select name="action" defaultValue={action}>
            <option value="">Any action</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Target
          <Select name="target" defaultValue={target}>
            <option value="">Any target</option>
            {AUDIT_TARGETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        {admin ? (
          <label className="flex min-w-56 flex-[2] flex-col gap-1 text-xs font-medium text-gray-600">
            Actor id
            <Input name="actor" defaultValue={actor} placeholder="An account id (admins only)" autoComplete="off" className="font-mono" />
          </label>
        ) : null}
        <button type="submit" className={buttonClasses({ variant: "outline", size: "md" })}>
          Filter
        </button>
      </form>
      {!admin ? <p className="text-xs text-gray-500">Moderators see their own actions. Append-only: nothing here can be edited or deleted.</p> : null}

      {list.items.length === 0 ? (
        <EmptyBox icon={ScrollText} title="No actions logged yet." />
      ) : (
        <ol className="flex flex-col gap-2">
          {list.items.map((row) => {
            const unmask = UNMASK.has(row.action);
            const meta = row.metadata && Object.keys(row.metadata).length ? JSON.stringify(row.metadata, null, 2) : null;
            return (
              <li key={row.id} className={cn("rounded-xl p-3 shadow-sm ring-1", unmask ? "bg-amber-50 ring-amber-300" : "bg-white ring-gray-200")} data-testid="staff-audit-row">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-500">{stamp(row.createdAt)}</span>
                  <Pill tone={unmask ? "amber" : row.action.startsWith("remove") || row.action === "ban" || row.action.startsWith("suspend") ? "red" : "gray"}>{row.action}</Pill>
                  {row.actor ? (
                    <Pill variant="outline" tone={ROLE_TONE[row.actor.role] ?? "gray"}>
                      {row.actor.displayName}
                    </Pill>
                  ) : (
                    <Pill variant="outline">system</Pill>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {row.targetType ? (
                    <span>
                      {row.targetType}
                      {row.targetId ? <span className="font-mono"> · {row.targetId}</span> : null}
                    </span>
                  ) : null}
                  {row.queueId ? (
                    <Link href={`/admin/queue/${row.queueId}`} prefetch={false} className="font-medium text-brand-700 hover:underline">
                      queue item
                    </Link>
                  ) : null}
                  {row.batchId ? <span className="font-mono">batch {row.batchId.slice(0, 8)}</span> : null}
                  {row.reasonCode ? (
                    <Pill variant="outline" tone="amber">
                      {row.reasonCode}
                    </Pill>
                  ) : null}
                </div>
                {row.reason || meta ? (
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">Details</summary>
                    {row.reason ? <p className="mt-1 whitespace-pre-wrap text-gray-700">{row.reason}</p> : null}
                    {meta ? <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">{meta}</pre> : null}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {page > 0 || list.nextOffset !== null ? (
        <div className="flex justify-between">
          {page > 0 ? (
            <Link href={href(page - 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={href(page + 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Older
            </Link>
          ) : (
            <span className="text-xs text-gray-500">End of the log</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
