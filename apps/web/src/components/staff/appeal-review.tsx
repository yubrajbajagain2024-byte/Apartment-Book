"use client";

import { useState, useTransition } from "react";
import { decideAppealAction } from "@/lib/staff/actions";
import { NOTE_MIN } from "@/lib/staff/constants";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ActingAs, StaffDialog } from "./dialog";

type Outcome = "upheld" | "reduced" | "reversed";
const OUTCOMES: readonly { value: Outcome; label: string; detail: string }[] = [
  { value: "upheld", label: "Uphold", detail: "The decision stands." },
  { value: "reduced", label: "Reduce", detail: "Same sanction, ending earlier." },
  { value: "reversed", label: "Reverse", detail: "Content restored, strike removed, sanction lifted immediately." },
];
const HOUR = 3_600_000;
const REDUCE: readonly { value: number; label: string }[] = [
  { value: HOUR, label: "Ends in 1 hour" },
  { value: 6 * HOUR, label: "Ends in 6 hours" },
  { value: 24 * HOUR, label: "Ends in 24 hours" },
  { value: 72 * HOUR, label: "Ends in 3 days" },
];

/** Decide an appeal (the server enforces reviewer ≠ actor and admin-only for suspensions and bans). */
export function AppealReview({ appealId, actorName }: { appealId: string; actorName: string }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("upheld");
  const [note, setNote] = useState("");
  const [reduceMs, setReduceMs] = useState(24 * HOUR);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const valid = note.trim().length >= NOTE_MIN;

  function submit() {
    start(async () => {
      const res = await decideAppealAction({ id: appealId, outcome, note: note.trim(), reducedUntil: outcome === "reduced" ? Date.now() + reduceMs : null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setDone(`Appeal ${res.data.status} · the appellant was told`);
    });
  }

  if (done) return <span className="text-sm text-green-700">{done}</span>;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Review
      </Button>
      <StaffDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Decide appeal"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!valid} loading={pending} onClick={submit}>
              Submit decision
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Deciding" name={actorName} note="The outcome notifies the appellant and is audited." />
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={outcome === o.value}
                onClick={() => setOutcome(o.value)}
                className={cn("h-8 rounded-md text-sm font-medium", outcome === o.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">{OUTCOMES.find((o) => o.value === outcome)?.detail}</p>
          {outcome === "reduced" ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              New end time
              <Select value={reduceMs} onChange={(e) => setReduceMs(Number(e.target.value))}>
                {REDUCE.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
            Note ({NOTE_MIN}+ characters, staff only)
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-20" data-autofocus />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      </StaffDialog>
    </>
  );
}
