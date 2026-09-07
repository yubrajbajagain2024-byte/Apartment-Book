"use client";

import { useRef, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/ui/button";

/**
 * Vertical filter sidebar (a GET form). Selects and checkboxes apply on change;
 * text inputs apply on Enter or with the Apply button. Works without JavaScript.
 */
export function FilterBar({ action, title = "Filters", children, hasFilters }: { action: string; title?: string; children: ReactNode; hasFilters: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      onChange={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "SELECT" || (target as HTMLInputElement).type === "checkbox" || (target as HTMLInputElement).type === "radio") {
          formRef.current?.requestSubmit();
        }
      }}
      className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {hasFilters ? (
          <LinkButton href={action} variant="ghost" size="sm">
            Clear
          </LinkButton>
        ) : null}
      </div>
      {children}
      <Button type="submit" variant="secondary" size="md" className="w-full">
        Apply
      </Button>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
      {label}
      {children}
    </label>
  );
}
