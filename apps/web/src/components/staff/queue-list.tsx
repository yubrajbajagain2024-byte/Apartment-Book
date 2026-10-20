"use client";

import { useState, useTransition } from "react";
import { SquareCheck } from "lucide-react";
import { bulkAction } from "@/lib/staff/actions";
import { BULK_ACTIONS, CATEGORY_OPTIONS, NOTE_MIN, STAFF_ACTIONS } from "@/lib/staff/constants";
import type { BulkActionId, StaffQueueItem } from "@/lib/staff/types";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ActingAs, StaffDialog } from "./dialog";
import { QueueCard } from "./queue-card";

const BULK_MAX = 50;

/**
 * The queue list with UniVerse's multi-select bulk actions: approve, remove or dismiss reports on up to 50 items, one
 * audit row each. P0, wellbeing, escalated and appeal items are skipped by the server (sanctions are always per item).
 */
export function QueueList({ items, actorName }: { items: StaffQueueItem[]; actorName: string }) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<BulkActionId>("approve");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const def = STAFF_ACTIONS.find((a) => a.id === action);
  const valid = category !== "" && (!def?.needsNote || note.trim().length >= NOTE_MIN);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_MAX) next.add(id);
      else setMessage({ tone: "error", text: `Up to ${BULK_MAX} items per bulk action.` });
      return next;
    });
  }

  function run() {
    start(async () => {
      const res = await bulkAction({ ids: [...selected], action, category, note: note.trim() || undefined });
      if (!res.ok) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      const ok = res.data.results.filter((r) => r.ok).length;
      const skipped = res.data.results.length - ok;
      setMessage({ tone: "ok", text: `${ok} ${ok === 1 ? "item" : "items"} actioned${skipped ? `, ${skipped} skipped` : ""} · batch ${res.data.batchId.slice(0, 8)}` });
      setOpen(false);
      setSelecting(false);
      setSelected(new Set());
      setNote("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setSelecting((v) => !v);
            setSelected(new Set());
          }}
          aria-pressed={selecting}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium", selecting ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-100")}
        >
          <SquareCheck className="h-4 w-4" aria-hidden />
          {selecting ? "Cancel selection" : "Select"}
        </button>
        {message ? (
          <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-green-700" : "text-red-600")}>
            {message.text}
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <QueueCard item={item} selecting={selecting} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />
          </li>
        ))}
      </ul>

      {selecting && selected.size > 0 ? (
        <div className="sticky bottom-20 z-20 flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-white shadow-lg md:bottom-4">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            Bulk action
          </Button>
        </div>
      ) : null}

      <StaffDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Bulk action · ${selected.size} ${selected.size === 1 ? "item" : "items"}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={action === "remove" ? "danger" : "primary"} disabled={!valid} loading={pending} onClick={run}>
              {def?.label ?? "Apply"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Acting" name={actorName} note="Every item gets its own audit row." />
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1" role="radiogroup" aria-label="Bulk action">
            {BULK_ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={action === a.value}
                onClick={() => setAction(a.value)}
                className={cn("h-8 rounded-md text-sm font-medium", action === a.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
              >
                {a.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
            Guideline
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Pick the guideline</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
            {def?.needsNote ? `Note (required, ${NOTE_MIN}+ characters, staff only)` : "Note (optional, staff only)"}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-20" />
          </label>
          <p className="text-xs text-gray-500">P0, Wellbeing, Escalated and Appeal items are skipped; sanctions are always per item.</p>
        </div>
      </StaffDialog>
    </div>
  );
}
