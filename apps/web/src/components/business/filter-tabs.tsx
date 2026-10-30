"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePortalHref } from "./portal-base";
import { Panel } from "./ui";

export type FilterOption = { value: string; label: string; count: number };

/** The filter a page's list is on: the address's parameter when it names one of the options, the default otherwise. */
export function useListFilter(param: string, values: readonly string[], fallback: string): string {
  const value = useSearchParams().get(param);
  return value && values.includes(value) ? value : fallback;
}

/**
 * A row of filter pills over a list whose rows are all on the page already (ads, payments, posts): choosing one changes
 * the address (history.replaceState, which Next's router follows into useSearchParams) and the list at once, with no
 * request to the server and no loading state in between. The pills stay real links: opened in a new tab, or shared, the
 * address brings the same filter from the server.
 */
export function FilterTabs({ label, param, path, options, fallback }: { label: string; param: string; path: string; options: FilterOption[]; fallback: string }) {
  const active = useListFilter(
    param,
    options.map((o) => o.value),
    fallback,
  );
  const href = usePortalHref();
  return (
    <nav aria-label={label} className="-mb-2 flex gap-1 overflow-x-auto no-scrollbar">
      {options.map((o) => {
        const on = o.value === active;
        const url = o.value === fallback ? href(path) : `${href(path)}?${param}=${encodeURIComponent(o.value)}`;
        return (
          <a
            key={o.value}
            href={url}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              // A modified click (a new tab, a download) is the browser's; a plain one changes the filter here.
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              window.history.replaceState(null, "", url);
            }}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors",
              on ? "bg-biz-ink text-biz-surface" : "bg-biz-surface text-biz-ink-2 ring-1 ring-biz-line hover:text-biz-ink",
            )}
          >
            {o.label} <span className={cn("tabular-nums", on ? "opacity-70" : "text-biz-ink-4")}>{o.count}</span>
          </a>
        );
      })}
    </nav>
  );
}

export type FilteredRow = {
  key: string;
  /** The filters this row shows under (every row shows under the default one). */
  filters: string[];
  node: ReactNode;
};

/**
 * The rows of a filtered list, rendered on the server with the filters each belongs to; the ones under the active
 * filter show, in a Panel (as rows, or as a list with `list`), with `header` above them and `emptyText` when none
 * does. The rows never leave the page, so switching filters is a re-render, not a request.
 */
export function FilteredList({
  param,
  values,
  fallback,
  rows,
  emptyText,
  header,
  list = false,
  className,
  testId,
}: {
  param: string;
  values: readonly string[];
  fallback: string;
  rows: FilteredRow[];
  emptyText: string;
  header?: ReactNode;
  list?: boolean;
  className?: string;
  testId?: string;
}) {
  const active = useListFilter(param, values, fallback);
  const shown = rows.filter((r) => r.filters.includes(active));
  if (shown.length === 0) return <p className="py-10 text-center text-[15px] text-biz-ink-3">{emptyText}</p>;
  return (
    <Panel className={className} data-testid={testId}>
      {header}
      {list ? (
        <ul className="divide-y divide-biz-line">
          {shown.map((r) => (
            <li key={r.key}>{r.node}</li>
          ))}
        </ul>
      ) : (
        shown.map((r) => <div key={r.key}>{r.node}</div>)
      )}
    </Panel>
  );
}
