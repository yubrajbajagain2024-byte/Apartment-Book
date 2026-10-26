"use client";

/**
 * Overlays for Buzz: `BuzzPortal` (renders on <body>, stamped Phosphor, so no card overflow or swipe transform can
 * clip or move it), `Sheet` (UniVerse's bottom sheet: a sheet from the bottom on phones, a centred card on wider
 * screens, like the site's share dialog) and `ActionSheet` (the overflow menu: grouped actions + a separate Cancel).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";
import { useHydrated } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button, IconButton, SHADOW_LG, T } from "./ui";

export function BuzzPortal({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    // display: contents keeps the wrapper out of the layout; the Phosphor custom properties still inherit through it.
    <div data-surface="incognito" style={{ backgroundColor: "transparent" }} className="contents">
      {children}
    </div>,
    document.body,
  );
}

/* Only the top sheet answers Escape; the page behind stays still while any sheet is open. */
const stack: symbol[] = [];
let locks = 0;
function lockScroll(): () => void {
  locks += 1;
  if (locks === 1) document.documentElement.style.overflow = "hidden";
  return () => {
    locks -= 1;
    if (locks === 0) document.documentElement.style.overflow = "";
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  description?: ReactNode;
  /** `auto` = as tall as its content (max 90%) · `full` = the composer's full-height sheet. */
  size?: "auto" | "full";
  footer?: ReactNode;
  /** Accessible name when there is no title. */
  "aria-label"?: string;
  /** false: no scrim tap, no Escape, no close button. */
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Sheet(props: SheetProps) {
  if (!props.open) return null;
  return (
    <BuzzPortal>
      <SheetPanel {...props} />
    </BuzzPortal>
  );
}

function SheetPanel({ onClose, title, description, size = "auto", footer, "aria-label": ariaLabel, dismissible = true, className, bodyClassName, children }: SheetProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [token] = useState(() => Symbol("sheet"));
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ id: number; y: number; t: number } | null>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    stack.push(token);
    const unlock = lockScroll();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    target?.focus({ preventScroll: true });
    return () => {
      stack.splice(stack.indexOf(token), 1);
      unlock();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [token]);

  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === token) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissible, token]);

  /** Keys stay in the sheet (Home's shortcuts are behind it), Escape closes the top sheet and Tab cycles inside it. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key === "Escape") {
      if (dismissible && stack[stack.length - 1] === token) {
        e.preventDefault();
        onClose();
      }
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && active !== panelRef.current && panelRef.current.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  }

  /* Drag the grabber / header down to dismiss (phones). */
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dismissible || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    drag.current = { id: e.pointerId, y: e.clientY, t: performance.now() };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no live pointer */
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    setDragY(Math.max(0, e.clientY - drag.current.y));
  }
  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    const dy = Math.max(0, e.clientY - d.y);
    const velocity = dy / Math.max(1, performance.now() - d.t);
    if (dy > 110 || (dy > 30 && velocity > 0.6)) onClose();
    else setDragY(0);
  }

  const hasHeader = title != null && title !== false;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div aria-hidden="true" onClick={dismissible ? onClose : undefined} className="ab-scrim-in absolute inset-0 bg-incog-scrim backdrop-blur-[6px]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasHeader ? titleId : undefined}
        aria-label={hasHeader ? undefined : (ariaLabel ?? "Sheet")}
        aria-describedby={hasHeader && description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // `translate`, not `transform`: the entrance animation holds `transform` (fill-mode both) and would win.
        style={dragY ? { translate: `0 ${dragY}px`, transition: "none" } : { transition: "translate 220ms cubic-bezier(0.22,1,0.36,1)" }}
        className={cn(
          "ab-sheet-in relative flex w-full flex-col rounded-t-[28px] border-t border-incog-line bg-incog-surface-2 text-incog-ink outline-none sm:rounded-[28px] sm:border",
          SHADOW_LG,
          size === "full" ? "h-[calc(100dvh-env(safe-area-inset-top)-12px)] sm:h-[min(840px,calc(100dvh-48px))] sm:max-w-[560px]" : "max-h-[90dvh] sm:max-h-[min(46rem,90dvh)] sm:max-w-[440px]",
          className,
        )}
      >
        <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} className={cn("relative shrink-0 select-none", dismissible && "touch-none")}>
          <div aria-hidden="true" className="flex h-5 items-end justify-center">
            <span className="h-1 w-9 rounded-full bg-incog-surface-4" />
          </div>
          {hasHeader ? (
            <div className="flex items-start gap-3 px-4 pt-3 pb-3">
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id={titleId} className={cn("text-incog-ink", T.title3)}>
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className={cn("mt-1 text-incog-ink-2", T.footnote)}>
                    {description}
                  </p>
                ) : null}
              </div>
              {dismissible ? <IconButton icon={X} aria-label="Close" variant="filled" size="sm" onClick={onClose} className="-mt-0.5 -mr-1" /> : null}
            </div>
          ) : (
            <>
              <div className="h-3" />
              {dismissible ? (
                <button type="button" className="sr-only" onClick={onClose}>
                  Close
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4", footer ? "pb-4" : "pb-[calc(16px+env(safe-area-inset-bottom))]", bodyClassName)}>{children}</div>
        {footer ? <div className="shrink-0 border-t border-incog-line-subtle px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}

export interface SheetAction {
  icon?: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect(): void;
}

/** Sheet + a grouped list of actions + a separated Cancel. Choosing an action closes the sheet first. */
export function ActionSheet({ open, onClose, actions, title }: { open: boolean; onClose(): void; actions: SheetAction[]; title?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} aria-label="Actions">
      <div role="group" className="overflow-hidden rounded-[20px] border border-incog-line bg-incog-surface-3">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <button
              key={`${action.label}-${i}`}
              type="button"
              data-autofocus={i === 0 ? "" : undefined}
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={cn(
                "flex min-h-14 w-full items-center gap-3 px-4 text-left font-medium transition-colors duration-150 hover:bg-incog-surface-4 focus-visible:-outline-offset-2",
                T.headline,
                "font-medium",
                i > 0 && "border-t border-incog-line-subtle",
                action.destructive ? "text-incog-danger" : "text-incog-ink",
              )}
            >
              {Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden="true" className={cn("shrink-0", action.destructive ? "text-incog-danger" : "text-incog-ink-2")} /> : null}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
      <Button variant="secondary" size="lg" fullWidth className="mt-3" onClick={onClose}>
        Cancel
      </Button>
    </Sheet>
  );
}
