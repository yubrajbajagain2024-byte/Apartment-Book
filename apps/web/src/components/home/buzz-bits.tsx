"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronDown, CircleHelp, Flame, Forward, GraduationCap, Hash, House, LifeBuoy, Lightbulb, UserRound, type LucideIcon } from "lucide-react";
import { BUZZ_TOPICS, shortAge, type BuzzTopic } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { useShare } from "@/components/common/share-button";

// Small Reddit-style pieces shared by the Buzz feed and the thread page.
// Buzz is anonymous: nothing here may show a real name, a photo of a person or a link to a profile.

export const BUZZ_HOME = "/?tab=buzz";
/** The id of the feed's search box, and the note a thread leaves so the feed puts the cursor in it. */
export const BUZZ_SEARCH_ID = "buzz-search";
export const BUZZ_FOCUS_SEARCH = "buzz-focus-search";

/** The outlined pill used for every action under a thread (votes, replies, share). */
export const BUZZ_PILL = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-800 transition-colors hover:bg-gray-100";

export function buzzTopicLabel(topic: BuzzTopic): string {
  return BUZZ_TOPICS.find((t) => t.value === topic)?.label ?? "Other";
}

const TOPIC_LOOK: Record<BuzzTopic, { icon: LucideIcon; color: string }> = {
  thoughts: { icon: Lightbulb, color: "bg-amber-500" },
  experience: { icon: BookOpen, color: "bg-violet-500" },
  advice: { icon: LifeBuoy, color: "bg-emerald-500" },
  question: { icon: CircleHelp, color: "bg-sky-500" },
  housing: { icon: House, color: "bg-brand-600" },
  campus: { icon: GraduationCap, color: "bg-rose-500" },
  rant: { icon: Flame, color: "bg-orange-600" },
  other: { icon: Hash, color: "bg-gray-500" },
};

/** The round coloured icon that stands where Reddit shows a community's picture. */
export function BuzzTopicIcon({ topic, size = "sm", className }: { topic: BuzzTopic; size?: "sm" | "md"; className?: string }) {
  const look = TOPIC_LOOK[topic] ?? TOPIC_LOOK.other;
  const Icon = look.icon;
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full text-white", look.color, size === "sm" ? "h-6 w-6" : "h-9 w-9", className)}>
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"} strokeWidth={2.25} />
    </span>
  );
}

const AVATAR_COLORS = [
  "bg-rose-100 text-rose-600",
  "bg-orange-100 text-orange-600",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-600",
  "bg-teal-100 text-teal-600",
  "bg-sky-100 text-sky-600",
  "bg-violet-100 text-violet-600",
  "bg-pink-100 text-pink-600",
];

function aliasColor(alias: string): string {
  let hash = 5381;
  for (let i = 0; i < alias.length; i++) hash = ((hash << 5) + hash + alias.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** A generic person in a soft colour picked from the alias, so one person is easy to follow inside a thread. */
export function BuzzAvatar({ alias, className }: { alias: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", aliasColor(alias), className)}>
      <UserRound className="h-4 w-4" strokeWidth={2.25} />
    </span>
  );
}

/** "OP" (started the thread) and "You" (only you can see it). */
export function BuzzBadges({ isOp, isMine }: { isOp?: boolean; isMine?: boolean }) {
  return (
    <>
      {isOp ? <span className="rounded bg-brand-600 px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide text-white">OP</span> : null}
      {isMine ? (
        <span className="rounded bg-green-600 px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide text-white" title="Only you can see this marker">
          You
        </span>
      ) : null}
    </>
  );
}

/** "6d", "3h", "now". */
export function BuzzAge({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {shortAge(iso)}
    </time>
  );
}

/** Share pill: the phone's share sheet where there is one, otherwise it copies the link. */
export function BuzzSharePill({ path, title, className }: { path: string; title: string; className?: string }) {
  const { share, copied } = useShare(path, title);
  return (
    <button type="button" onClick={share} aria-label="Share" className={cn(BUZZ_PILL, className)}>
      {copied ? <Check className="h-[18px] w-[18px] text-brand-600" /> : <Forward className="h-[18px] w-[18px]" />}
      {copied ? <span>Copied</span> : null}
    </button>
  );
}

export type BuzzSortOption = { value: string; label: string; href?: string };

/**
 * Reddit's "Best ⌄" chooser. Options with an `href` are plain links (the feed keeps its filters in the address);
 * without one they call `onSelect` (the thread sorts its replies on the page).
 */
export function BuzzSortMenu({ label, value, options, onSelect, variant = "quiet", align = "left" }: { label: string; value: string; options: BuzzSortOption[]; onSelect?: (value: string) => void; variant?: "quiet" | "pill"; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const item = "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-100";
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        className={cn("inline-flex h-8 items-center gap-1 rounded-full text-[13px] font-semibold transition-colors", variant === "pill" ? "bg-gray-100 px-3 text-gray-900 hover:bg-gray-200" : "px-2 text-gray-600 hover:bg-gray-100")}
      >
        {current.label}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div role="menu" aria-label={label} className={cn("absolute top-full z-50 mt-1 w-40 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200", align === "left" ? "left-0" : "right-0")}>
            <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-gray-500">{label}</p>
            {options.map((o) => {
              const active = o.value === current.value;
              const inner = (
                <>
                  {o.label}
                  {active ? <Check className="h-4 w-4 text-brand-600" /> : null}
                </>
              );
              return o.href ? (
                <Link key={o.value} role="menuitem" href={o.href} scroll={false} aria-current={active ? "true" : undefined} onClick={() => setOpen(false)} className={item}>
                  {inner}
                </Link>
              ) : (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onSelect?.(o.value);
                  }}
                  className={item}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
