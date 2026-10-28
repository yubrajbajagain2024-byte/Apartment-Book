"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, Scale, X } from "lucide-react";
import { adminPauseAdAction, approveAdAction, rejectAdAction } from "@/lib/actions/business";
import { cn } from "@/lib/utils";
import { bizButton, bizField, Notice } from "./ui";

/**
 * The UniBuzz team's decision on one ad. Approving records its payment (amount received and the invoice or receipt
 * reference; no payment provider yet) and, for a housing ad, that it was checked against the Fair Housing rules, with
 * a note when the screen flagged its words. Rejecting and pausing say why: the business reads it.
 */
export function AdReviewActions({ adId, status, pausedBy, housing, flagged, budgetCents }: { adId: string; status: string; pausedBy: string | null; housing: boolean; flagged: boolean; budgetCents: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"approve" | "reject" | "pause" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(budgetCents ? String(budgetCents / 100) : "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const run = (work: () => Promise<{ error?: string }>) => {
    setError(null);
    start(async () => {
      const result = await work();
      if (result.error) setError(result.error);
      else {
        setMode(null);
        router.refresh();
      }
    });
  };

  if (status === "pending_review") {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="danger" title={error} /> : null}
        {mode === "approve" ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-biz-surface-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label className="flex flex-col gap-1 text-[13px] font-medium text-biz-ink-2">
                Amount received (USD)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={cn(bizField, "h-10 bg-biz-surface tabular-nums")} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-medium text-biz-ink-2">
                Invoice or receipt reference
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-2026-0142" className={cn(bizField, "h-10 bg-biz-surface")} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[13px] font-medium text-biz-ink-2">
              Note {flagged ? "(required: why the flagged words are fine)" : "(optional)"}
              <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(bizField, "h-10 bg-biz-surface")} />
            </label>
            {housing ? (
              <label className="flex items-start gap-2.5 text-[13px] text-biz-ink-2">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--biz-accent)]" />
                <span>
                  <Scale className="mr-1 inline h-3.5 w-3.5" /> I checked this housing ad against the Fair Housing Act: no preference by race, color, national origin, religion, sex, familial status or disability, in words or pictures.
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => approveAdAction(adId, { amount, currency: "USD", paymentReference: reference, note, fairHousingChecked: checked }))} className={bizButton({ variant: "primary" })} data-testid="approve-ad">
                <Check className="h-4 w-4" /> Approve and record payment
              </button>
              <button type="button" onClick={() => setMode(null)} className={bizButton({ variant: "ghost" })}>
                Cancel
              </button>
            </div>
          </div>
        ) : mode === "reject" ? (
          <ReasonForm label="Why it is not approved (the business reads this)" reason={reason} setReason={setReason} pending={pending} confirm="Reject" onConfirm={() => run(() => rejectAdAction(adId, reason))} onCancel={() => setMode(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("approve")} className={bizButton({ variant: "primary" })}>
              <Check className="h-4 w-4" /> Approve
            </button>
            <button type="button" onClick={() => setMode("reject")} className={bizButton({ variant: "secondary" })}>
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        )}
      </div>
    );
  }
  if (status === "scheduled" || status === "active" || status === "paused") {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="danger" title={error} /> : null}
        {mode === "pause" ? (
          <ReasonForm label="Why it is paused (the business reads this; only the UniBuzz team can resume it)" reason={reason} setReason={setReason} pending={pending} confirm="Pause" onConfirm={() => run(() => adminPauseAdAction(adId, reason))} onCancel={() => setMode(null)} />
        ) : status === "paused" && pausedBy === "admin" ? (
          <button type="button" disabled={pending} onClick={() => run(() => adminPauseAdAction(adId, null))} className={bizButton({ variant: "secondary", className: "self-start" })}>
            <Play className="h-4 w-4" /> Resume
          </button>
        ) : status !== "paused" ? (
          <button type="button" onClick={() => setMode("pause")} className={bizButton({ variant: "secondary", className: "self-start" })}>
            <Pause className="h-4 w-4" /> Pause for a policy reason
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}

function ReasonForm({ label, reason, setReason, pending, confirm, onConfirm, onCancel }: { label: string; reason: string; setReason: (v: string) => void; pending: boolean; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-biz-surface-3 p-4">
      <label className="flex flex-col gap-1 text-[13px] font-medium text-biz-ink-2">
        {label}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={cn(bizField, "bg-biz-surface py-2.5")} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || reason.trim().length < 5} onClick={onConfirm} className={bizButton({ variant: "danger" })}>
          {confirm}
        </button>
        <button type="button" onClick={onCancel} className={bizButton({ variant: "ghost" })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
