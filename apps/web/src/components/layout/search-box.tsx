"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

/** Global search. A plain GET form, so it works without JavaScript too. */
export function SearchBox({ className }: { className?: string }) {
  const params = useSearchParams();
  return (
    <form action="/search" role="search" className={className}>
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder="Search apartments, items, roommates"
          className="h-10 w-full rounded-full bg-gray-100 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </label>
    </form>
  );
}
