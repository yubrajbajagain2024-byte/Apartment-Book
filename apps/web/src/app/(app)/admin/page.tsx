import Link from "next/link";
import { Inbox } from "lucide-react";
import { CATEGORY_OPTIONS, QUEUE_VIEWS, SOURCE_LABEL, SURFACE_LABEL } from "@/lib/staff/constants";
import { fetchQueue, fetchQueueCounts, requireStaff, type QueueFilters } from "@/lib/staff/server";
import type { QueueView } from "@/lib/staff/types";
import { firstParam } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { EmptyBox } from "@/components/staff/parts";
import { QueueList } from "@/components/staff/queue-list";
import { Select, Input } from "@/components/ui/input";
import { buttonClasses } from "@/components/ui/button";

const PAGE = 30;
const VIEW_IDS = new Set<string>(QUEUE_VIEWS.map((v) => v.id));
type Params = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The queue (UniVerse QueuePage): the nine views as count chips, filters (guideline, surface, source), the cards
 * (priority first, then oldest; SLA timers; who is reviewing what) and select-mode bulk actions.
 */
export default async function QueuePage({ searchParams }: { searchParams: Params }) {
  const me = await requireStaff();
  const params = await searchParams;
  const raw = firstParam(params.view) ?? "priority";
  const view = (VIEW_IDS.has(raw) ? raw : "priority") as QueueView;
  const filters: QueueFilters = {};
  const category = firstParam(params.category) ?? "";
  const surface = firstParam(params.surface) ?? "";
  const source = firstParam(params.source) ?? "";
  const q = (firstParam(params.q) ?? "").trim();
  if (category) filters.category = category;
  if (surface) filters.surface = surface;
  if (source) filters.source = source;
  if (view === "closed" && q) filters.q = q;
  const page = Math.max(0, Math.floor(Number(firstParam(params.page)) || 0));
  const [list, counts] = await Promise.all([fetchQueue(view, page * PAGE, PAGE, filters), fetchQueueCounts()]);
  const views = QUEUE_VIEWS.filter((v) => !v.adminOnly || me.role === "admin");
  const activeFilters = [category, surface, source].filter(Boolean).length;

  const hrefWith = (next: Record<string, string | number | null>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | number | null> = { view, category, surface, source, q: view === "closed" ? q : "", page: null, ...next };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && !(k === "view" && v === "priority") && !(k === "page" && v === 0)) sp.set(k, String(v));
    const s = sp.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Queue view" className="no-scrollbar -mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {views.map((v) => {
            const active = v.id === view;
            return (
              <li key={v.id}>
                <Link
                  href={hrefWith({ view: v.id, q: "" })}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset transition-colors",
                    active ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
                  )}
                >
                  {v.label}
                  <span className="ml-1 tabular-nums text-gray-500">· {counts[v.id] ?? 0}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form method="get" action="/admin" className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
        {view !== "priority" ? <input type="hidden" name="view" value={view} /> : null}
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Guideline
          <Select name="category" defaultValue={category}>
            <option value="">Any guideline</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Surface
          <Select name="surface" defaultValue={surface}>
            <option value="">Any surface</option>
            {Object.entries(SURFACE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Source
          <Select name="source" defaultValue={source}>
            <option value="">Any source</option>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {view === "closed" ? (
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
            Queue id
            <Input name="q" defaultValue={q} placeholder="First characters of the id" autoComplete="off" />
          </label>
        ) : null}
        <button type="submit" className={buttonClasses({ variant: "outline", size: "md" })}>
          Apply
        </button>
        {activeFilters || q ? (
          <Link href={hrefWith({ category: "", surface: "", source: "", q: "" })} prefetch={false} className={buttonClasses({ variant: "ghost", size: "md" })}>
            Clear
          </Link>
        ) : null}
      </form>

      {list.items.length === 0 ? (
        <EmptyBox icon={Inbox} title={page > 0 ? "Nothing more in this view." : "Queue clear. Nothing needs review right now."} description={activeFilters ? "Try clearing a filter." : undefined} />
      ) : (
        <QueueList items={list.items} actorName={me.username ? `@${me.username}` : me.name} />
      )}

      {page > 0 || list.nextOffset !== null ? (
        <div className="flex items-center justify-between">
          {page > 0 ? (
            <Link href={hrefWith({ page: page - 1 })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {list.nextOffset !== null ? (
            <Link href={hrefWith({ page: page + 1 })} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          ) : (
            <span className="text-xs text-gray-500">End of this view</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
