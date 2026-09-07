"use client";

import { useRef, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
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
      className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
    >
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="md">
          <SlidersHorizontal className="h-4 w-4" /> Apply
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
