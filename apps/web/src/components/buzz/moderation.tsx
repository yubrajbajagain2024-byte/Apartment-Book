"use client";

/**
 * What a writer sees from moderation (UniVerse's `lib/moderation` + `ModerationHost`, Phosphor):
 *  - 422 `content_blocked` → a sheet with the engine's title and words, [Edit] [Read the guidelines]
 *    (+ [Get help reporting] when it was about naming someone), then the support sheet if resources came with it;
 *  - muted / suspended / banned / an unread warning / rate limited → a toast (with "Details" → account status);
 *  - after a write that went through: "held for review" toast, and the support sheet for self-harm resources.
 * The only moderation data a non-staff client ever receives is `AuthorNotice` / `ContentBlockedDetails`.
 */
import { useState } from "react";
import Link from "next/link";
import { BookOpen, HeartHandshake, LifeBuoy, PenLine, ShieldAlert } from "lucide-react";
import { toBuzzError, type AuthorNotice, type ContentBlockedDetails, type SupportResources } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { invalidateQueries, buzzKeys } from "./query";
import { Sheet } from "./sheet";
import { createStore, onBuzzOwnerChange, useStore } from "./store";
import { toast } from "./toast";
import { Button, buttonClass, T } from "./ui";

export const ACCOUNT_STATUS_HREF = "/settings/account-status";

export function guidelinesHref(anchor?: string | null): string {
  return anchor ? `/guidelines#${anchor}` : "/guidelines";
}

type Overlay = { kind: "blocked"; details: ContentBlockedDetails; body: string; onEdit?: () => void } | { kind: "support"; support: SupportResources };

const overlay = createStore<{ current: Overlay | null; key: number }>(() => ({ current: null, key: 0 }));
onBuzzOwnerChange(() => overlay.reset());

function open(next: Overlay): void {
  overlay.set((s) => ({ current: next, key: s.key + 1 }));
}

const HELD_BODY = "Your post is with our safety team before it goes live. This usually takes under a day. You don't need to do anything.";

function dateLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/**
 * Handles the outcomes every Buzz write can hit. Returns true when it showed something; otherwise show the error
 * yourself (`buzzErrorMessage`).
 */
export function handleBuzzWriteError(e: unknown, opts?: { onEdit?(): void }): boolean {
  const err = toBuzzError(e);
  const details = (err.details ?? {}) as Record<string, unknown>;
  const statusAction = { label: "Details", href: ACCOUNT_STATUS_HREF };
  switch (err.code) {
    case "content_blocked": {
      const d = details as Partial<ContentBlockedDetails>;
      const full: ContentBlockedDetails = {
        messageId: d.messageId ?? "M-GENERIC",
        title: d.title ?? (err.message || "This can't be posted"),
        category: d.category ?? null,
        guidelineAnchor: d.guidelineAnchor ?? null,
        support: d.support ?? null,
      };
      // The route's `message` is the sentence for the writer; `details` carries the rest.
      open({ kind: "blocked", details: full, body: err.message && err.message !== full.title ? err.message : "", onEdit: opts?.onEdit });
      return true;
    }
    case "muted": {
      const until = typeof details.until === "number" ? ` until ${dateLabel(details.until)}` : typeof details.mutedUntil === "number" ? ` until ${dateLabel(details.mutedUntil)}` : "";
      toast.error(`You're muted${until}. You can read and vote, but you can't post.`, { action: statusAction });
      invalidateQueries(buzzKeys.posting);
      return true;
    }
    case "suspended":
      toast.error("Your account is suspended, so you can't post right now.", { action: statusAction });
      invalidateQueries(buzzKeys.posting);
      return true;
    case "banned":
      toast.error("Your account has been banned from posting.", { action: statusAction });
      invalidateQueries(buzzKeys.posting);
      return true;
    case "warning_unacknowledged":
      toast.error("Read the warning on your account before you post again.", { action: statusAction });
      invalidateQueries(buzzKeys.posting);
      return true;
    case "rate_limited":
      toast.error("You're going fast. Take a breather and try again in a moment.");
      return true;
    default:
      return false;
  }
}

/** After a write that went through: the "held" notice and / or the support sheet. */
export function showModerationNotice(n: AuthorNotice | undefined | null): void {
  if (!n) return;
  if (n.status === "held") toast.info(`In review — ${n.userMessage?.body ?? HELD_BODY}`, { duration: 7000 });
  if (n.support) open({ kind: "support", support: n.support });
}

/** Mounted once per Buzz screen. */
export function BuzzModerationHost() {
  const { current, key } = useStore(overlay, (s) => s);
  if (!current) return null;
  const close = () => {
    // A block that carried resources is followed by the support sheet (same world).
    if (current.kind === "blocked" && current.details.support) open({ kind: "support", support: current.details.support });
    else overlay.set({ current: null });
  };
  return current.kind === "blocked" ? (
    <BlockedSheet key={key} details={current.details} body={current.body} onEdit={current.onEdit} onClose={close} />
  ) : (
    <SupportSheet key={key} support={current.support} onClose={close} />
  );
}

function BlockedSheet({ details, body, onEdit, onClose }: { details: ContentBlockedDetails; body: string; onEdit?: () => void; onClose(): void }) {
  const named = details.messageId === "M-NAMED";
  return (
    <Sheet open onClose={onClose} aria-label={details.title}>
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-incog-warning-soft text-incog-warning">
          <ShieldAlert size={26} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className={cn("text-incog-ink", T.title2)}>{details.title}</h2>
        {body ? <p className={cn("text-incog-ink-2", T.body)}>{body}</p> : null}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Button
          size="lg"
          fullWidth
          leftIcon={PenLine}
          data-autofocus=""
          onClick={() => {
            onClose();
            onEdit?.();
          }}
        >
          Edit
        </Button>
        <Link href={guidelinesHref(details.guidelineAnchor)} onClick={onClose} className={buttonClass("secondary", "lg", true)}>
          <BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />
          Read the guidelines
        </Link>
        {named ? (
          <Link href={guidelinesHref("enforcement")} onClick={onClose} className={buttonClass("ghost", "lg", true)}>
            <LifeBuoy size={20} strokeWidth={1.75} aria-hidden="true" />
            Get help reporting
          </Link>
        ) : null}
      </div>
    </Sheet>
  );
}

function SupportSheet({ support, onClose }: { support: SupportResources; onClose(): void }) {
  const [more, setMore] = useState(false);
  const [first, ...rest] = support.lines;
  const external = (href: string) => (/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {});
  return (
    <Sheet open onClose={onClose} aria-label={support.headline}>
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-incog-info-soft text-incog-info">
          <HeartHandshake size={26} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h2 className={cn("text-incog-ink", T.title2)}>{support.headline}</h2>
        <p className={cn("text-incog-ink-2", T.body)}>{support.body}</p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {first ? (
          <a href={first.href} {...external(first.href)} data-autofocus="" className={buttonClass("primary", "lg", true)}>
            {first.label}
          </a>
        ) : null}
        {rest.length > 0 && !more ? (
          <Button variant="secondary" size="lg" fullWidth onClick={() => setMore(true)}>
            More options
          </Button>
        ) : null}
        {more
          ? rest.map((line) => (
              <a key={line.href} href={line.href} {...external(line.href)} className={buttonClass("secondary", "lg", true)}>
                {line.label} · {line.detail}
              </a>
            ))
          : null}
        <Button variant="ghost" size="lg" fullWidth onClick={onClose}>
          I&apos;m OK, thanks
        </Button>
        <p className={cn("pt-1 text-center text-incog-ink-3", T.caption)}>{support.emergencyNote}</p>
      </div>
    </Sheet>
  );
}
