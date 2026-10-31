"use client";

import { useState } from "react";
import { CalendarClock, Check, CreditCard, Pause, Play, Scale, X } from "lucide-react";
import { centsToDollarInput, zonedInputToMs, zonedInputValue } from "@apartment-book/shared";
import { approveConsoleAdAction, pauseConsoleAdAction, recordAdPaymentAction, rejectConsoleAdAction, updateAdTermsAction } from "@/lib/console/business-actions";
import type { AdStatus } from "@/lib/console/ops-types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ErrorNote, useConsoleAction } from "./advertiser-actions";
import { usd } from "./parts";

const CT = "America/Chicago";
const field = "flex flex-col gap-1 text-xs font-medium text-gray-600";

/**
 * The review of an ad waiting for it (Business v2's rules): approving records its payment (the amount received and the
 * invoice or receipt reference; the rate card's price is filled in to start from) and, for a housing ad or one the
 * screen flagged, the Fair Housing check, with a note when it was flagged. Rejecting says why; the business reads it.
 */
export function ReviewPanel({ adId, quoteCents, budgetCents, housing, flagged, problems }: { adId: string; quoteCents: number | null; budgetCents: number; housing: boolean; flagged: boolean; problems: string[] }) {
  const { pending, error, run } = useConsoleAction();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [amount, setAmount] = useState(centsToDollarInput(quoteCents ?? (budgetCents || null)));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={error} />
      {problems.length ? (
        <ul className="list-inside list-disc rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {mode === "approve" ? (
        <div className="flex flex-col gap-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className={field}>
              Amount received (USD)
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="tabular-nums" data-autofocus />
            </label>
            <label className={field}>
              Invoice or receipt reference
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-2026-0142" maxLength={200} />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Rate card: {quoteCents !== null ? usd(quoteCents) : "no price for this ad's placements"} · budget {usd(budgetCents)}. Record what was actually paid.
          </p>
          <label className={field}>
            Note {flagged ? "(required: why the flagged words are fine, at least 10 characters)" : "(optional; the business reads it)"}
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          {housing || flagged ? (
            <label className="flex items-start gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>
                <Scale className="mr-1 inline h-3.5 w-3.5" aria-hidden />I checked this ad against the Fair Housing Act: no preference by race, color, national origin, religion, sex, familial status or disability, in words or pictures.
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || problems.length > 0} onClick={() => run(() => approveConsoleAdAction(adId, { amount, currency: "USD", paymentReference: reference, note, fairHousingChecked: checked }), () => setMode(null))}>
              <Check className="h-4 w-4" aria-hidden /> Approve and record payment
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : mode === "reject" ? (
        <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
          <label className={field}>
            Why it is not approved (the business reads this)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} data-autofocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="danger" disabled={pending || reason.trim().length < 5} onClick={() => run(() => rejectConsoleAdAction(adId, reason), () => setMode(null))}>
              Reject
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setMode("approve")} disabled={problems.length > 0} title={problems.length ? "Not ready: see the list above" : undefined}>
            <Check className="h-4 w-4" aria-hidden /> Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("reject")}>
            <X className="h-4 w-4" aria-hidden /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}

/** Pause a scheduled or running ad for a policy reason (only the team resumes it), or resume one the team paused. */
export function PausePanel({ adId, status, pausedBy }: { adId: string; status: AdStatus; pausedBy: string | null }) {
  const { pending, error, run } = useConsoleAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (status === "paused" && pausedBy === "admin") {
    return (
      <div className="flex flex-col gap-2">
        <ErrorNote error={error} />
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseConsoleAdAction(adId, null))} className="self-start">
          <Play className="h-4 w-4" aria-hidden /> Resume
        </Button>
        <p className="text-xs text-gray-500">It runs again only as the kind of ad, and with the Fair Housing flags, the team approved; anything else goes back to review.</p>
      </div>
    );
  }
  if (status === "paused") return <p className="text-sm text-gray-600">Paused by the business: only they resume it.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote error={error} />
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
          <label className={field}>
            Why it is paused (the business reads this; only the team can resume it)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} data-autofocus />
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="danger" disabled={pending || reason.trim().length < 5} onClick={() => run(() => pauseConsoleAdAction(adId, reason), () => setOpen(false))}>
              Pause
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="self-start">
          <Pause className="h-4 w-4" aria-hidden /> Pause for a policy reason
        </Button>
      )}
    </div>
  );
}

/**
 * The schedule and the budget of an ad in review, scheduled, running or paused, in Central time; the business is told
 * why. Payments already recorded keep the period they paid for (record a further payment for an extension).
 */
export function TermsEditor({ adId, startsAt, endsAt, budgetCents }: { adId: string; startsAt: number | null; endsAt: number | null; budgetCents: number }) {
  const { pending, error, run } = useConsoleAction();
  const [start, setStart] = useState(startsAt === null ? "" : zonedInputValue(startsAt, CT));
  const [end, setEnd] = useState(endsAt === null ? "" : zonedInputValue(endsAt, CT));
  const [budget, setBudget] = useState(centsToDollarInput(budgetCents));
  const [reason, setReason] = useState("");
  const startMs = zonedInputToMs(start, CT);
  const endMs = zonedInputToMs(end, CT);
  const bad = !startMs || !endMs || endMs <= startMs;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateAdTermsAction({ adId, startsAt: startMs, endsAt: endMs, budget, reason }), () => setReason(""));
      }}
    >
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={field}>
          Starts (Central time)
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className={field}>
          Ends (Central time)
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className={field}>
          Budget (USD)
          <Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="tabular-nums" />
        </label>
      </div>
      <label className={field}>
        Why (the business reads this)
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Extended a week to make up for the outage on Oct 20." />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || bad || reason.trim().length < 5} className="self-start">
        <CalendarClock className="h-4 w-4" aria-hidden /> Save schedule and budget
      </Button>
    </form>
  );
}

/** A further payment for an approved ad that has not ended (an extension, a second invoice): it pays for the rest of the ad. */
export function PaymentRecorder({ adId }: { adId: string }) {
  const { pending, error, run } = useConsoleAction();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordAdPaymentAction({ adId, amount, currency: "USD", reference, note }), () => {
          setAmount("");
          setReference("");
          setNote("");
        });
      }}
    >
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <label className={field}>
          Amount received (USD)
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="tabular-nums" required />
        </label>
        <label className={field}>
          Invoice or receipt reference
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} required />
        </label>
      </div>
      <label className={field}>
        Note for the team (optional; the business does not see it)
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !amount.trim() || reference.trim().length < 3} className="self-start">
        <CreditCard className="h-4 w-4" aria-hidden /> Record payment
      </Button>
    </form>
  );
}
