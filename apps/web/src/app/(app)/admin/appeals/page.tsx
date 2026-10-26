import Link from "next/link";
import { Scale } from "lucide-react";
import { categoryLabel, STAFF_SANCTION_LABELS } from "@/lib/staff/constants";
import { dateTime, day } from "@/lib/staff/format";
import { fetchAppeals, requireStaff, staffMetadata } from "@/lib/staff/server";
import { cn, firstParam } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { AppealReview } from "@/components/staff/appeal-review";
import { Ago } from "@/components/staff/live";
import { EmptyBox, ExcerptBlock, Pill } from "@/components/staff/parts";

export const generateMetadata = () => staffMetadata("Appeals · Trust & Safety");

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "upheld", label: "Upheld" },
  { value: "reversed", label: "Reversed" },
  { value: "reduced", label: "Reduced" },
  { value: "all", label: "All" },
] as const;
const PAGE = 30;

/**
 * Appeals (UniVerse AppealsPage, safety 4.5), reviewed blind: the sanction, the appealed content and the appeal
 * text, never a person. For Buzz the sanction's id is the appeal's and times are cut to the day. Whether you may
 * decide one comes from the server (never your own action; suspensions and bans for admins).
 */
export default async function StaffAppealsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaff();
  const params = await searchParams;
  const raw = firstParam(params.status) ?? "open";
  const status = STATUSES.some((s) => s.value === raw) ? raw : "open";
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const list = await fetchAppeals(status, page * PAGE, PAGE);
  const actorName = me.username ? `@${me.username}` : me.name;
  const href = (s: string, p = 0) => `/admin/appeals?status=${s}${p ? `&page=${p}` : ""}`;

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Appeal status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={href(s.value)}
            prefetch={false}
            aria-current={s.value === status ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset",
              s.value === status ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {list.items.length === 0 ? (
        <EmptyBox icon={Scale} title={status === "open" ? "No open appeals." : `No ${status === "all" ? "" : `${status} `}appeals.`} description="Appeals are reviewed by someone other than the person who acted." />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.items.map((a) => {
            const anon = a.sanction.origin === "anon";
            return (
              <li key={a.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200" data-testid="staff-appeal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={a.sanction.kind === "ban" || a.sanction.kind === "suspension" ? "red" : "amber"}>{STAFF_SANCTION_LABELS[a.sanction.kind] ?? a.sanction.kind}</Pill>
                  <Pill variant="outline" tone={anon ? "violet" : "gray"}>
                    {anon ? "Buzz origin" : "Public origin"}
                  </Pill>
                  {a.sanction.category ? <span className="text-xs text-gray-700">{categoryLabel(a.sanction.category)}</span> : null}
                  {anon ? <span className="ml-auto text-xs text-gray-500">{day(a.createdAt)}</span> : <Ago ms={a.createdAt} className="ml-auto text-xs text-gray-500" />}
                </div>
                {a.contentExcerpt ? (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-gray-500">Appealed {a.contentLabel ?? "content"}</div>
                    <ExcerptBlock text={a.contentExcerpt} anon={anon} />
                  </div>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">“{a.text}”</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{a.sanction.until ? `Sanction until ${anon ? day(a.sanction.until) : dateTime(a.sanction.until)}` : a.sanction.kind === "ban" ? "Permanent" : "No end time"}</span>
                  {a.queueId ? (
                    <Link href={`/admin/queue/${a.queueId}`} prefetch={false} className="font-medium text-brand-700 hover:underline">
                      queue item
                    </Link>
                  ) : null}
                  {a.status !== "open" ? (
                    <Pill variant="outline" tone={a.status === "upheld" ? "gray" : "green"}>
                      {a.status}
                    </Pill>
                  ) : null}
                  {a.status === "open" ? <span className="ml-auto">{a.canReview ? <AppealReview appealId={a.id} actorName={actorName} /> : <span>Not yours to review</span>}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {page > 0 || list.nextOffset !== null ? (
        <div className="flex justify-between">
          {page > 0 ? (
            <Link href={href(status, page - 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={href(status, page + 1)} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
