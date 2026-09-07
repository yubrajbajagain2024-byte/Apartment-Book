"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/** On phones the filter sidebar folds into a button above the feed. */
export function MobileFilters({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-gray-200"
      >
        <SlidersHorizontal className="h-4 w-4" /> Filters
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}
