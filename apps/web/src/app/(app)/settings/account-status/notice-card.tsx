"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BookOpen, MicOff, Scale, ShieldAlert, ShieldCheck, ShieldX, Trash2, type LucideIcon } from "lucide-react";
import { MODERATION_CATEGORY_LABELS, SANCTION_KIND_LABELS, type SanctionNotice } from "@apartment-book/shared";
import { useHydrated } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { acknowledgeAction, appealAction } from "./actions";

const KIND: Record<SanctionNotice["kind"], { icon: LucideIcon; tone: "warning" | "danger" | "neutral" }> = {
  warning: { icon: ShieldAlert, tone: "warning" },
  mute: { icon: MicOff, tone: "warning" },
  suspension: { icon: ShieldX, tone: "danger" },
  ban: { icon: ShieldX, tone: "danger" },
  removal: { icon: Trash2, tone: "neutral" },
};

const APPEAL: Record<SanctionNotice["appealStatus"], string | null> = {
  none: null,
  open: "Appeal under review",
  upheld: "Appeal reviewed: decision stands",
  reversed: "Appeal accepted",
  reduced: "Appeal reviewed: reduced",
};

const APPEAL_MIN = 10;
const APPEAL_MAX = 1000;

/** Local date and time, once in the browser (the server does not know the reader's time zone). */
function When({ ms, withTime }: { ms: number; withTime?: boolean }) {
  const hydrated = useHydrated();
  const d = new Date(ms);
  const text = hydrated
    ? withTime
      ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** One notice (UniVerse AccountStatusPage NoticeCard): what was actioned, which rule, until when, and the appeal. */
export function NoticeCard({ notice }: { notice: SanctionNotice }) {
  const [appealing, setAppealing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const [now] = useState(() => Date.now());
  const kind = KIND[notice.kind];
  const Icon = kind.icon;
  const category = notice.category ? MODERATION_CATEGORY_LABELS[notice.category] : null;
  const appealLabel = sent ? APPEAL.open : APPEAL[notice.appealStatus];
  const ended = notice.until !== null && notice.until <= now;

  function ack() {
    setError(null);
    start(async () => {
      const res = await acknowledgeAction(notice.id);
      if (!res.ok) setError(res.error);
    });
  }

  function appeal() {
    setError(null);
    start(async () => {
      const res = await appealAction(notice.id, text.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent(true);
      setAppealing(false);
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200" data-testid="sanction-notice">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            kind.tone === "danger" ? "bg-red-50 text-red-600" : kind.tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-700",
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">{SANCTION_KIND_LABELS[notice.kind]}</h2>
            {notice.scope !== "all" ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300">{notice.scope === "buzz_only" ? "Buzz only" : "Requests only"}</span>
            ) : null}
            {appealLabel ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  notice.appealStatus === "reversed" ? "bg-green-50 text-green-800" : notice.appealStatus === "open" || sent ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-700",
                )}
              >
                {appealLabel}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-600">
            {category ? `Guideline: ${category}` : "Community Guidelines"}
            {notice.contentLabel ? ` · your ${notice.contentLabel}` : ""}
          </p>
          <p className="text-xs tabular-nums text-gray-500">
            <When ms={notice.startsAt} />
            {notice.until ? (
              <>
                {" – "}
                <When ms={notice.until} withTime />
              </>
            ) : notice.kind === "ban" ? (
              " – permanent"
            ) : null}
            {ended ? " · ended" : ""}
          </p>
        </div>
      </div>

      {notice.contentExcerpt ? <blockquote className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">“{notice.contentExcerpt}”</blockquote> : null}

      <div className="flex flex-wrap items-center gap-2">
        {notice.guidelineAnchor ? (
          <Link href={`/guidelines#${notice.guidelineAnchor}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100">
            <BookOpen className="h-4 w-4" aria-hidden />
            Read the guideline
          </Link>
        ) : null}
        {notice.acknowledgedAt === null ? (
          <Button size="sm" variant="secondary" loading={pending && !appealing} onClick={ack}>
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Got it
          </Button>
        ) : null}
        {notice.canAppeal && notice.appealStatus === "none" && !sent && !appealing ? (
          <Button size="sm" onClick={() => setAppealing(true)}>
            <Scale className="h-4 w-4" aria-hidden />
            Appeal
          </Button>
        ) : null}
        {notice.canAppeal && notice.appealStatus === "none" && !sent && notice.appealDeadline ? (
          <span className="text-xs text-gray-500">
            Appeal by <When ms={notice.appealDeadline} />
          </span>
        ) : null}
      </div>

      {appealing ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">Appealing · read by the Trust &amp; Safety team only. A different person than the one who acted reviews it.</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
            Why should this be reviewed?
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={APPEAL_MAX} placeholder="Tell us what we got wrong. Be specific." className="min-h-24" />
            <span className="self-end text-xs font-normal tabular-nums text-gray-500">
              {text.trim().length}/{APPEAL_MAX}
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAppealing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" loading={pending} disabled={text.trim().length < APPEAL_MIN} onClick={appeal}>
              <Scale className="h-4 w-4" aria-hidden />
              Send appeal
            </Button>
          </div>
        </div>
      ) : null}
      {sent ? <p className="text-sm text-green-700">Appeal sent. A different reviewer will look at it.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </article>
  );
}
