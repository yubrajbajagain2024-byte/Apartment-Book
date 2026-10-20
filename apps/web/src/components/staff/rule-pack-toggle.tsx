"use client";

import { useState, useTransition } from "react";
import { setRulePackAction } from "@/lib/staff/actions";
import { cn } from "@/lib/utils";

/** One rule pack's switch (admins; every toggle is audited). The baseline pack stays on. */
export function RulePackToggle({ id, enabled, locked }: { id: string; enabled: boolean; locked?: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function flip() {
    const next = !on;
    setOn(next);
    setError(null);
    start(async () => {
      const res = await setRulePackAction({ id, enabled: next });
      if (!res.ok) {
        setOn(!next);
        setError(res.error);
      }
    });
  }
  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${id} enabled`}
        disabled={locked || pending}
        onClick={flip}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50",
          on ? "bg-brand-600" : "bg-gray-300",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </button>
    </span>
  );
}
