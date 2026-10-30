"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet for the Business forms: a scrim, a panel that rises into place,
 * Escape and the scrim close it unless `persistent`, Tab stays inside, focus goes to the first field.
 */
export function StaffDialog({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "default",
  persistent,
  footer,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "danger";
  /** No closing by Escape or the scrim (the unmask ritual). */
  persistent?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current?.querySelector<HTMLElement>("select, textarea, input");
    first?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !persistent) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown} className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" onClick={persistent ? undefined : onClose} className="ab-scrim-in absolute inset-0 bg-black/50" />
      <div
        ref={panelRef}
        className={cn(
          "ab-sheet-in relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl",
          wide ? "sm:w-[560px]" : "sm:w-[460px]",
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-gray-200 px-5 py-4">
          {icon ? (
            <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone === "danger" ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700")}>{icon}</span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {description ? <div className="mt-1 text-sm text-gray-600">{description}</div> : null}
          </div>
          {persistent ? null : (
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200">
              <X className="h-5 w-5" />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex shrink-0 flex-col gap-2 border-t border-gray-200 px-5 py-3 sm:flex-row sm:justify-end">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** The "you are acting as …" strip every staff form starts with (UniVerse ComposerModeBanner, public mode). */
export function ActingAs({ verb, name, note }: { verb: string; name: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">
      <span>
        {verb} as <strong className="font-semibold text-brand-700">{name}</strong>
      </span>
      {note ? <span className="ml-auto text-xs text-gray-500">{note}</span> : null}
    </div>
  );
}
