"use client";

/**
 * Report a buzz or a reply (UniVerse's ReportSheet, Buzz reasons): pick a reason (a note is required for "Something
 * else"), send, "Report sent". Never offers Block — on Buzz that would tell you who wrote it. The item leaves your
 * feed and thread when the sheet closes; the team reviews it without seeing who wrote it.
 */
import { useState } from "react";
import { Check, Flag, ShieldCheck } from "lucide-react";
import { BUZZ_LIMITS, BUZZ_REPORT_REASONS, buzzErrorMessage, type BuzzReportReason } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { buzzApi } from "./api";
import { Sheet } from "./sheet";
import { toast } from "./toast";
import { AutoTextarea, Button, CONTROL_CHROME, FieldError, T } from "./ui";

const MIN_OTHER_NOTE = 10;

export function ReportSheet({ open, onClose, itemId, onReported }: { open: boolean; onClose(): void; itemId: string; onReported?(): void }) {
  if (!open) return null;
  return <ReportPanel onClose={onClose} itemId={itemId} onReported={onReported} />;
}

function ReportPanel({ onClose, itemId, onReported }: { onClose(): void; itemId: string; onReported?(): void }) {
  const [reason, setReason] = useState<BuzzReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const needsNote = BUZZ_REPORT_REASONS.find((r) => r.id === reason)?.noteRequired ?? false;
  const tooShort = needsNote && note.trim().length < MIN_OTHER_NOTE;

  const close = () => {
    onClose();
    if (done) onReported?.();
  };

  const submit = async () => {
    if (!reason || tooShort || sending) return;
    setSending(true);
    try {
      await buzzApi.report(itemId, reason, note.trim() ? note.trim().slice(0, BUZZ_LIMITS.reportNote) : null);
      setDone(true);
    } catch (e) {
      toast.error(buzzErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <Sheet open onClose={close} title="Report sent">
        <div className="flex flex-col items-center gap-4 pb-2 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-incog-success-soft text-incog-success">
            <ShieldCheck size={26} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <p className={cn("text-incog-ink-2", T.body)}>Thanks. Our safety team will take a look. You won&apos;t see this again.</p>
          <Button size="lg" fullWidth onClick={close} data-autofocus="">
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={close}
      title="Report"
      description="What's wrong with this? Reports are anonymous."
      footer={
        <Button size="lg" fullWidth leftIcon={Flag} disabled={!reason || tooShort} loading={sending} onClick={() => void submit()}>
          Send report
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Reason" className="overflow-hidden rounded-[20px] border border-incog-line bg-incog-surface-3">
        {BUZZ_REPORT_REASONS.map((r, i) => {
          const selected = reason === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setReason(r.id)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors duration-150 focus-visible:-outline-offset-2",
                T.body,
                i > 0 && "border-t border-incog-line-subtle",
                selected ? "bg-incog-accent-soft text-incog-ink" : "text-incog-ink-2 hover:bg-incog-surface-4",
              )}
            >
              <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-incog-accent bg-incog-accent text-incog-on-accent" : "border-incog-line-strong")}>
                {selected ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">{r.label}</span>
            </button>
          );
        })}
      </div>

      {reason ? (
        <div className="mt-3 flex flex-col">
          <label htmlFor="buzz-report-note" className={cn("mb-1.5 text-incog-ink-2", T.footnote)}>
            {needsNote ? "Tell us more" : "Anything else? (optional)"}
          </label>
          <div className={cn("rounded-[14px] px-3.5 py-3", CONTROL_CHROME)}>
            <AutoTextarea
              id="buzz-report-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={needsNote ? "What happened? At least 10 characters." : "Add context for the safety team"}
              maxLength={BUZZ_LIMITS.reportNote}
              minRows={2}
              maxRows={5}
              showCount
              className="text-base leading-[1.375rem]"
            />
          </div>
          {needsNote && note.length > 0 && tooShort ? <FieldError>A few more words help us act on this.</FieldError> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
