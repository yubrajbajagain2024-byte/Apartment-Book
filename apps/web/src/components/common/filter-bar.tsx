"use client";

import { useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";

/**
 * A GET form for list filters. Selects auto-submit; text inputs submit on Enter
 * or with the Apply button. Works without JavaScript as a normal form.
 */
export function FilterBar({ action, children, hasFilters }: { action: string; children: ReactNode; hasFilters: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      onChange={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "SELECT" || (target as HTMLInputElement).type === "checkbox") {
          formRef.current?.requestSubmit();
        }
      }}
      className="flex flex-wrap items-end gap-x-3 gap-y-4 rounded-[14px] bg-white p-4 ring-1 ring-gray-200"
    >
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="md">
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} /> Apply
        </Button>
        {hasFilters ? (
          <LinkButton href={action} variant="ghost" size="md">
            Clear
          </LinkButton>
        ) : null}
      </div>
    </form>
  );
}

/** The tracked small-caps label over one filter control. */
export function FilterLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <label className={cn("flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500", className)}>{children}</label>;
}

/**
 * A yes/no filter as a hairline capsule that fills with ink when it is on. Still a checkbox underneath (the same name
 * and value reach the server), so the form keeps working without JavaScript.
 */
export function FilterChip({ name, value, defaultChecked, label }: { name: string; value: string; defaultChecked?: boolean; label: string }) {
  const [checked, setChecked] = useState(Boolean(defaultChecked));
  return (
    <label
      className={cn(
        "ab-press inline-flex h-9 cursor-pointer select-none items-center rounded-full px-3.5 text-[13px] font-semibold ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gray-400",
        checked ? "bg-gray-900 text-white ring-gray-900" : "bg-transparent text-gray-700 ring-gray-200 hover:bg-gray-50 hover:text-gray-900",
      )}
    >
      <input type="checkbox" name={name} value={value} checked={checked} onChange={(e) => setChecked(e.target.checked)} className="sr-only" />
      {label}
    </label>
  );
}
