"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { searchProfiles, type ProfileSummary } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/** Search people by name and pick one or more of them. */
export function MemberPicker({
  selected,
  onChange,
  excludeIds,
  autoFocus,
}: {
  selected: ProfileSummary[];
  onChange: (next: ProfileSummary[]) => void;
  excludeIds: string[];
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const excludedKey = [...excludeIds, ...selected.map((s) => s.id)].join(",");
  const q = query.trim();

  // Debounced search; state updates happen inside the timer callback.
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await searchProfiles(createClient(), q, { excludeIds: excludedKey.split(",").filter(Boolean), limit: 8 });
        if (!cancelled) {
          setResults(found);
          setSearched(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, excludedKey]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearched(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-1 pr-2 text-sm font-medium text-brand-800">
              <Avatar name={p.full_name} src={p.avatar_url} size="xs" />
              {p.full_name}
              <button type="button" onClick={() => onChange(selected.filter((s) => s.id !== p.id))} aria-label={`Remove ${p.full_name}`} className="rounded-full p-0.5 hover:bg-brand-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input value={query} onChange={(e) => handleQueryChange(e.target.value)} placeholder="Search people by name…" className="pl-9" autoFocus={autoFocus} />
        {loading ? <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /> : null}
      </div>
      {results.length > 0 ? (
        <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, p]);
                  handleQueryChange("");
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      ) : searched && !loading && q.length >= 2 ? (
        <p className="text-sm text-gray-500">No one found with that name.</p>
      ) : null}
    </div>
  );
}
