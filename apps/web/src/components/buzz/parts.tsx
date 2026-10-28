"use client";

/**
 * Buzz item building blocks (UniVerse's `features/buzz/parts.tsx`): the alias avatar and header, text and its
 * placeholders, the community / hidden-anon fold, the vote pill, the poll, the support link, the status chip, the
 * overflow menu, share and the reply count. Nothing here ever renders a person: no photo, no name, no @handle, no
 * profile link, and no Block (blocking would let you test who wrote what).
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowBigDown, ArrowBigUp, Ellipsis, EyeOff, Flag, HeartHandshake, Link2, Share, Trash2, UserX } from "lucide-react";
import {
  BUZZ_CATEGORY_COPY,
  BUZZ_FEED_COPY,
  BUZZ_MENU_COPY,
  BUZZ_STATUS_CHIPS,
  buzzCategory,
  buzzPlaceholder,
  buzzPollCaption,
  buzzReplyCountLabel,
  type Buzz,
  type BuzzAlias,
  type BuzzItemStatus,
  type BuzzPoll,
  type BuzzReply,
} from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { castPollVote, castVote, copyBuzzLink, deleteBuzzOrReply, hideAnon, hideThread, shareBuzz } from "./actions";
import { buzzDayTime, buzzTimeAgo, useNow } from "./clock";
import { guidelinesHref } from "./moderation";
import { removeBuzzItem } from "./query";
import { ReportSheet } from "./report-sheet";
import { ActionSheet, type SheetAction } from "./sheet";
import { buzzActions, useBuzzUi } from "./store";
import { Badge, buttonClass, IconButton, OpBadge, T, type BadgeTone } from "./ui";

/* ───────────────────────────── alias ───────────────────────────── */

const AVATAR_PX = { sm: 28, md: 36 } as const;

/**
 * The emoji of an alias in a dashed ring tinted with the alias colour. Never an image, never clickable: an anonymous
 * surface can never be handed a person.
 */
export function AliasAvatar({ emoji, color, size = "md", className }: { emoji: string; color: string; size?: "sm" | "md"; className?: string }) {
  const px = AVATAR_PX[size];
  return (
    <span
      aria-hidden="true"
      style={{ width: px, height: px, fontSize: Math.round(px * 0.55), backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, borderColor: color }}
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full border-[1.5px] border-dashed leading-none", className)}
    >
      {emoji}
    </span>
  );
}

/** Live relative time ("3m"), the full day and time in the tooltip. */
export function TimeAgo({ ts, className }: { ts: number; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={new Date(ts).toISOString()} title={buzzDayTime(ts, now)} className={cn("tabular-nums", className)}>
      {buzzTimeAgo(ts, now)}
    </time>
  );
}

/** "🔥 You · Anon Ember  OP · 3m" + whatever goes on the right (badges, the menu). */
export function AliasLine({ alias, isMine, isOp, createdAt, trailing, size = "sm" }: { alias: BuzzAlias; isMine: boolean; isOp?: boolean; createdAt: number; trailing?: ReactNode; size?: "sm" | "md" }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AliasAvatar emoji={alias.emoji} color={alias.color} size={size} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={cn("truncate text-incog-ink", T.labelSm)}>
          {isMine ? <span className="text-incog-accent-ink">You</span> : null}
          {isMine ? <span className="text-incog-ink-4"> · </span> : null}
          <span data-testid="buzz-alias">{alias.label}</span>
        </span>
        {isOp ? <OpBadge /> : null}
        <span className="text-incog-ink-4" aria-hidden="true">
          ·
        </span>
        <TimeAgo ts={createdAt} className={cn("shrink-0 text-incog-ink-3", T.caption)} />
      </div>
      {trailing}
    </div>
  );
}

/** "📚 Classes" under the alias line: the category its author picked; nothing when none. Not a link yet: there is no page per category. */
export function CategoryTag({ category, className }: { category: string | null | undefined; className?: string }) {
  const c = buzzCategory(category);
  if (!c) return null;
  return (
    <span className={cn("inline-flex h-7 max-w-full items-center gap-1.5 self-start rounded-full bg-incog-surface-3 px-2.5 text-incog-ink-2", T.labelSm, className)} data-testid="buzz-category">
      <span aria-hidden="true">{c.emoji}</span>
      <span className="truncate">
        <span className="sr-only">{BUZZ_CATEGORY_COPY.label}: </span>
        {c.label}
      </span>
    </span>
  );
}

/* ───────────────────────────── text ───────────────────────────── */

/** A placeholder ("[removed by moderators]") when the words are withheld, else nothing. */
export function Placeholder({ item, className }: { item: { text: string; status: BuzzItemStatus }; className?: string }) {
  const placeholder = buzzPlaceholder(item);
  if (!placeholder) return null;
  return <p className={cn("italic text-incog-ink-4", T.body, className)}>{placeholder}</p>;
}

/** Text with an optional 6-line clamp and Show more / Show less (long texts only). */
export function BuzzText({ text, status, clamp, large, className }: { text: string; status: BuzzItemStatus; clamp?: boolean; large?: boolean; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (buzzPlaceholder({ text, status })) return <Placeholder item={{ text, status }} className={className} />;
  const long = Boolean(clamp) && text.length > 320;
  return (
    <div className={className}>
      <p className={cn(large ? T.bodyLg : T.body, "whitespace-pre-wrap text-incog-ink [overflow-wrap:anywhere]", clamp && !expanded && "line-clamp-6")}>{text}</p>
      {long ? (
        <button type="button" className={cn("mt-1 text-incog-accent-ink", T.labelSm)} onClick={() => setExpanded((e) => !e)}>
          {expanded ? BUZZ_FEED_COPY.showLess : BUZZ_FEED_COPY.showMore}
        </button>
      ) : null}
    </div>
  );
}

/** "Hidden by the community · Tap to view" (or "Hidden by you in this thread"). Opening it lasts for the session. */
export function CollapsedFold({ id, reason, children }: { id: string; reason: "community" | "anon"; children: ReactNode }) {
  const revealed = useBuzzUi((s) => s.revealed[id] === true);
  if (revealed) return <>{children}</>;
  return (
    <button type="button" onClick={() => buzzActions.reveal(id)} className={cn("flex min-h-11 w-full items-center gap-2 rounded-[14px] bg-incog-surface-2 px-3 text-left text-incog-ink-3", T.footnote)}>
      <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="flex-1 truncate">{reason === "community" ? BUZZ_FEED_COPY.collapsedCommunity : BUZZ_FEED_COPY.collapsedAnon}</span>
      <span className="shrink-0 text-incog-accent-ink">{BUZZ_FEED_COPY.tapToView}</span>
    </button>
  );
}

/* ───────────────────────────── votes ───────────────────────────── */

/** ▲ score ▼ in a pill. Own items and items that are not active cannot be voted on. */
export function VoteCluster({ item, size = "sm" }: { item: Buzz | BuzzReply; size?: "sm" | "md" }) {
  const disabled = item.isMine || item.status !== "active";
  const up = item.myVote === 1;
  const down = item.myVote === -1;
  return (
    <div className={cn("inline-flex shrink-0 items-center rounded-full bg-incog-surface-2", size === "sm" ? "h-9" : "h-11")} role="group" aria-label="Votes" data-testid="buzz-vote">
      <button
        type="button"
        aria-label={up ? "Remove upvote" : "Upvote"}
        aria-pressed={up}
        disabled={disabled}
        onClick={() => castVote(item, 1)}
        className={cn("flex h-full min-w-11 items-center justify-center rounded-l-full pl-1 text-incog-ink-3 transition-colors hover:text-incog-ink-2 disabled:opacity-45 disabled:hover:text-incog-ink-3", up && "text-incog-accent-ink hover:text-incog-accent-ink")}
      >
        <ArrowBigUp size={20} strokeWidth={1.75} fill={up ? "currentColor" : "none"} aria-hidden="true" />
      </button>
      <span aria-live="polite" className={cn("min-w-6 text-center tabular-nums", T.labelSm, up ? "text-incog-accent-ink" : down ? "text-incog-down" : "text-incog-ink-2")}>
        {item.score}
      </span>
      <button
        type="button"
        aria-label={down ? "Remove downvote" : "Downvote"}
        aria-pressed={down}
        disabled={disabled}
        onClick={() => castVote(item, -1)}
        className={cn("flex h-full min-w-11 items-center justify-center rounded-r-full pr-1 text-incog-ink-3 transition-colors hover:text-incog-ink-2 disabled:opacity-45 disabled:hover:text-incog-ink-3", down && "text-incog-down hover:text-incog-down")}
      >
        <ArrowBigDown size={20} strokeWidth={1.75} fill={down ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ───────────────────────────── poll ───────────────────────────── */

/** Options; bars and percentages once results are visible (after voting, at close, or on your own poll). */
export function PollView({ threadId, poll, isMine, disabled }: { threadId: string; poll: BuzzPoll; isMine: boolean; disabled?: boolean }) {
  const now = useNow();
  const [pending, setPending] = useState(false);
  const canVote = !poll.closed && !isMine && poll.myChoice === null && !disabled;
  const vote = (optionId: string) => {
    if (pending) return;
    setPending(true);
    void castPollVote(threadId, optionId).finally(() => setPending(false));
  };
  return (
    <div className="flex flex-col gap-1.5" role={canVote ? "group" : undefined} aria-label="Poll">
      {poll.options.map((o) => {
        const pct = o.pct ?? 0;
        const chosen = poll.myChoice === o.id;
        const inner = (
          <>
            {poll.resultsVisible ? (
              <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 rounded-[14px] transition-[width] duration-300 ease-out", chosen ? "bg-incog-accent-soft" : "bg-incog-surface-3")} style={{ width: `${pct}%` }} />
            ) : null}
            <span className="relative z-[1] flex w-full items-center gap-2">
              <span className={cn("min-w-0 flex-1 truncate", T.body, chosen ? "text-incog-accent-ink" : "text-incog-ink")}>{o.text}</span>
              {poll.resultsVisible ? <span className={cn("shrink-0 tabular-nums text-incog-ink-2", T.labelSm)}>{pct}%</span> : null}
            </span>
          </>
        );
        return canVote ? (
          <button
            key={o.id}
            type="button"
            disabled={pending}
            onClick={() => vote(o.id)}
            className="relative flex min-h-11 w-full items-center overflow-hidden rounded-[14px] border border-incog-line bg-incog-surface-2 px-3 text-left transition-colors hover:border-incog-accent-line disabled:opacity-70"
          >
            {inner}
          </button>
        ) : (
          <div key={o.id} className={cn("relative flex min-h-11 w-full items-center overflow-hidden rounded-[14px] bg-incog-surface-2 px-3", chosen && "ring-1 ring-incog-accent-line")}>
            {inner}
          </div>
        );
      })}
      <p className={cn("tabular-nums text-incog-ink-3", T.caption)}>
        {buzzPollCaption(poll, now)}
        {!poll.closed ? <span className="sr-only">{` (closes ${buzzDayTime(poll.closesAt, now)})`}</span> : null}
      </p>
    </div>
  );
}

/* ───────────────────────────── small things ───────────────────────────── */

export function SupportLink() {
  return (
    <Link href={guidelinesHref("self-harm")} className={cn("inline-flex min-h-9 items-center gap-1.5 self-start rounded-full bg-incog-accent-soft px-3 text-incog-accent-ink", T.caption)}>
      <HeartHandshake size={14} strokeWidth={1.75} aria-hidden="true" />
      {BUZZ_FEED_COPY.supportLink}
    </Link>
  );
}

const STATUS_TONE: Partial<Record<BuzzItemStatus, BadgeTone>> = { held: "warning", hidden: "warning", removed: "danger" };

/** Author-only chip on held / hidden / removed items. Nothing for active or deleted ones. */
export function ContentStatusChip({ status, className }: { status: BuzzItemStatus; className?: string }) {
  const label = BUZZ_STATUS_CHIPS[status];
  if (!label) return null;
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} className={className}>
      {label}
    </Badge>
  );
}

export function ReplyCountLink({ threadId, count }: { threadId: string; count: number }) {
  return (
    <Link href={`/buzz/${threadId}`} className={buttonClass("ghost", "sm", false, "-ml-2 text-incog-ink-2")} data-testid="buzz-replies-link">
      <span className="truncate">
        <span className="tabular-nums">{count}</span>
        <span className={cn("ml-1 text-incog-ink-3", T.footnote)}>{buzzReplyCountLabel(count)}</span>
      </span>
    </Link>
  );
}

export function ShareButton({ item }: { item: Buzz }) {
  if (item.status !== "active") return null;
  return <IconButton icon={Share} aria-label={BUZZ_MENU_COPY.share} size="sm" onClick={() => void shareBuzz(item)} />;
}

/* ───────────────────────────── overflow menu ───────────────────────────── */

/**
 * Hide this thread · Hide this anon in this thread (replies) · Share · Copy link · Report · Delete (own).
 * `onHidden`: the item left (hidden or reported) — thread pages go back. `onDeleted`: your item was deleted.
 */
export function ItemMenu({ item, onHidden, onDeleted, className }: { item: Buzz | BuzzReply; onHidden?(): void; onDeleted?(): void; className?: string }) {
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const isRoot = item.kind === "buzz";
  const actions: SheetAction[] = [];
  if (!item.isMine) actions.push({ icon: EyeOff, label: BUZZ_MENU_COPY.hideThread, onSelect: () => void hideThread(item.threadId, onHidden) });
  if (!isRoot && !item.isMine) actions.push({ icon: UserX, label: BUZZ_MENU_COPY.hideAnon, onSelect: () => void hideAnon(item) });
  if (isRoot && item.status === "active") {
    actions.push({ icon: Share, label: BUZZ_MENU_COPY.share, onSelect: () => void shareBuzz(item) });
    actions.push({ icon: Link2, label: BUZZ_MENU_COPY.copyLink, onSelect: () => void copyBuzzLink(item.threadId) });
  }
  if (!item.isMine && item.status !== "deleted") actions.push({ icon: Flag, label: BUZZ_MENU_COPY.report, onSelect: () => setReporting(true) });
  if (item.isMine && item.status !== "deleted") actions.push({ icon: Trash2, label: BUZZ_MENU_COPY.delete, destructive: true, onSelect: () => void deleteBuzzOrReply(item, onDeleted) });
  if (actions.length === 0) return null;
  return (
    <>
      <IconButton icon={Ellipsis} aria-label="More" size="sm" onClick={() => setMenu(true)} className={className} />
      <ActionSheet open={menu} onClose={() => setMenu(false)} actions={actions} />
      <ReportSheet
        open={reporting}
        onClose={() => setReporting(false)}
        itemId={item.id}
        onReported={() => {
          // It leaves your feeds and threads (the server agrees).
          removeBuzzItem(item.id);
          onHidden?.();
        }}
      />
    </>
  );
}
