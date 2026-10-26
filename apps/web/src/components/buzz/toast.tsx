"use client";

/**
 * Buzz toasts (UniVerse's Toaster, Phosphor glass): top-centre under the navbar, at most two, the same message never
 * twice. Each Buzz screen mounts one `BuzzToaster`; `toast.*` can be called from anywhere (a delete on the thread page
 * still shows its "Deleted" on the feed it went back to). Wiped with the rest of Buzz when the account changes.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BuzzPortal } from "./sheet";
import { createStore, onBuzzOwnerChange, useStore } from "./store";
import { SHADOW_LG, T } from "./ui";

type Tone = "success" | "error" | "info" | "neutral";

export interface ToastAction {
  label: string;
  href?: string;
  onClick?(): void;
}

interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
  duration: number;
  createdAt: number;
  action?: ToastAction;
}

const MAX_VISIBLE = 2;
let nextId = 1;
const toasts = createStore<{ items: ToastItem[] }>(() => ({ items: [] }));
onBuzzOwnerChange(() => toasts.reset());

function push(tone: Tone, message: string, opts?: { duration?: number; action?: ToastAction }): number {
  const id = nextId++;
  const item: ToastItem = { id, tone, message, duration: opts?.duration ?? (opts?.action ? 7000 : 4000), createdAt: Date.now(), action: opts?.action };
  toasts.set((s) => ({ items: [...s.items.filter((t) => t.message !== message), item].slice(-MAX_VISIBLE) }));
  return id;
}

export function dismissToast(id: number): void {
  toasts.set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

export const toast = {
  show: (message: string, opts?: { duration?: number; action?: ToastAction }) => push("neutral", message, opts),
  success: (message: string, opts?: { duration?: number; action?: ToastAction }) => push("success", message, opts),
  error: (message: string, opts?: { duration?: number; action?: ToastAction }) => push("error", message, opts),
  info: (message: string, opts?: { duration?: number; action?: ToastAction }) => push("info", message, opts),
};

const ICON: Record<Tone, LucideIcon | null> = { success: CircleCheck, error: CircleAlert, info: Info, neutral: null };
const COLOR: Record<Tone, string> = { success: "text-incog-success", error: "text-incog-danger", info: "text-incog-info", neutral: "text-incog-ink-2" };

export function BuzzToaster() {
  const items = useStore(toasts, (s) => s.items);
  if (items.length === 0) return null;
  return (
    <BuzzPortal>
      <div className="pointer-events-none fixed inset-x-0 top-[68px] z-[90] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} />
        ))}
      </div>
    </BuzzPortal>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remaining = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    // A toast queued while no Buzz screen was on show only runs out its remaining time.
    remaining.current = Math.max(800, item.createdAt + item.duration - Date.now());
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => clearTimeout(timer.current);
  }, [item]);

  const pause = () => {
    clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismissToast(item.id), Math.max(800, remaining.current));
  };

  const Icon = ICON[item.tone];
  const actionClass = cn("relative -my-1 -mr-1 shrink-0 rounded-full px-3 py-2 text-incog-accent-ink hover:bg-incog-accent-soft", T.labelSm);
  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      onPointerEnter={pause}
      onPointerLeave={resume}
      className={cn(
        "ab-fade-in pointer-events-auto flex w-full max-w-[398px] items-center gap-3 rounded-[20px] border border-incog-line bg-incog-glass px-4 py-3 text-incog-ink backdrop-blur-xl backdrop-saturate-150",
        SHADOW_LG,
      )}
    >
      {Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden="true" className={cn("shrink-0", COLOR[item.tone])} /> : null}
      <p className={cn("line-clamp-3 min-w-0 flex-1 text-incog-ink", T.footnote)}>{item.message}</p>
      {item.action ? (
        item.action.href ? (
          <Link href={item.action.href} onClick={() => dismissToast(item.id)} className={actionClass}>
            {item.action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick?.();
              dismissToast(item.id);
            }}
            className={actionClass}
          >
            {item.action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
