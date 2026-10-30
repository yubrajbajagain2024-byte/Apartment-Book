"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Ban, Check, RotateCcw, StickyNote, X } from "lucide-react";
import type { BusinessDecision } from "@apartment-book/shared";
import { addBusinessNoteAction, reviewBusinessAction, verifyBusinessAction } from "@/lib/staff/business-actions";
import type { ActionResult } from "@/lib/staff/actions";
import type { BusinessStatus } from "@/lib/staff/ops-types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

/** Runs one action, shows its error, and refreshes the page's data when it worked. */
export function useConsoleAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<ActionResult<unknown>>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await work();
      if (!res.ok) setError(res.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };
  return { pending, error, run, setError };
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  ) : null;
}

const DECISIONS: Record<BusinessStatus, { decision: BusinessDecision; label: string; icon: typeof Check; variant: "primary" | "outline" | "danger"; needsNote: boolean }[]> = {
  pending: [
    { decision: "approved", label: "Approve", icon: Check, variant: "primary", needsNote: false },
    { decision: "rejected", label: "Reject", icon: X, variant: "outline", needsNote: true },
  ],
  approved: [
    { decision: "suspended", label: "Suspend", icon: Ban, variant: "danger", needsNote: true },
    { decision: "pending", label: "Back to review", icon: RotateCcw, variant: "outline", needsNote: true },
  ],
  suspended: [
    { decision: "approved", label: "Reinstate", icon: Check, variant: "primary", needsNote: false },
    { decision: "rejected", label: "Reject", icon: X, variant: "outline", needsNote: true },
  ],
  rejected: [
    { decision: "approved", label: "Approve", icon: Check, variant: "primary", needsNote: false },
    { decision: "pending", label: "Back to review", icon: RotateCcw, variant: "outline", needsNote: false },
  ],
};

/**
 * The business's standing (Business v2's review): approve once the owner confirmed the email, reject, suspend (its
 * listings, posts, ads and chats stop at once) or reinstate. The note is the business's to read; suspending and
 * rejecting need one.
 */
export function BusinessDecisionPanel({ businessId, status, ownerConfirmed }: { businessId: string; status: BusinessStatus; ownerConfirmed: boolean }) {
  const { pending, error, run } = useConsoleAction();
  const [note, setNote] = useState("");
  const options = DECISIONS[status] ?? [];
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote error={error} />
      {status === "pending" && !ownerConfirmed ? <p className="text-sm text-amber-800">The owner has not confirmed their email yet: the database approves a business only after that.</p> : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        Note to the business (they read it; needed to reject or suspend)
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.decision}
            type="button"
            size="sm"
            variant={o.variant}
            disabled={pending || (o.needsNote && note.trim().length < 5)}
            onClick={() => {
              // Leaving "approved" archives its active listings and pauses its posts (admin_review_business), and its ads and
              // chats stop; approving it again later does not bring the listings back.
              if (status === "approved" && o.decision !== "approved" && !window.confirm(`${o.label}? Its active listings are archived, its posts paused, and its ads and chats stop at once. Approving it again later does not republish the listings.`)) return;
              run(() => reviewBusinessAction(businessId, o.decision, note), () => setNote(""));
            }}
          >
            <o.icon className="h-4 w-4" aria-hidden /> {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Verified Partner: only for a business someone on the team checked, with what was checked on record. */
export function VerifyPanel({ businessId, verified, note }: { businessId: string; verified: boolean; note: string | null }) {
  const { pending, error, run } = useConsoleAction();
  const [evidence, setEvidence] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote error={error} />
      {verified ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <BadgeCheck className="h-4 w-4 text-brand-600" aria-hidden />
          <span className="min-w-0 flex-1 text-gray-800">Verified Partner. Checked: {note || "—"}</span>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyBusinessAction(businessId, false, ""))}>
            Remove the mark
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={1000} placeholder="What you checked: a licence number, a site visit, a call…" aria-label="What was checked" className="flex-1" />
          <Button type="button" size="sm" variant="outline" disabled={pending || evidence.trim().length < 10} onClick={() => run(() => verifyBusinessAction(businessId, true, evidence), () => setEvidence(""))}>
            <BadgeCheck className="h-4 w-4" aria-hidden /> Mark Verified Partner
          </Button>
        </div>
      )}
    </div>
  );
}

/** A note for the team only: the business never sees it. */
export function BusinessNoteForm({ businessId }: { businessId: string }) {
  const { pending, error, run } = useConsoleAction();
  const [body, setBody] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addBusinessNoteAction(businessId, body), () => setBody(""));
      }}
    >
      <ErrorNote error={error} />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder="A call, a contract, a warning… (the team only)" aria-label="New note" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || body.trim().length < 2} className="self-start">
        <StickyNote className="h-4 w-4" aria-hidden /> Add note
      </Button>
    </form>
  );
}
