"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Eye, EyeOff, Gavel, Lock, Sparkles, Unlock } from "lucide-react";
import { actOnItemAction, claimItemAction, releaseItemAction, unmaskAction } from "@/lib/staff/actions";
import { BAN_NOTE_MIN, CATEGORY_OPTIONS, NOTE_MIN, STAFF_ACTIONS, UNMASK_REASON_CODES, UNMASK_REASON_LABELS, UNMASK_REASON_MIN } from "@/lib/staff/constants";
import { dateTime } from "@/lib/staff/format";
import type { StaffActionId, StaffQueueItemDetail, StaffRole, UnmaskReasonCode, UnmaskResponse } from "@/lib/staff/types";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ActingAs, StaffDialog } from "./dialog";
import { useNow } from "./live";
import { BlindNote, KeyValue } from "./parts";

type ItemSummary = Pick<
  StaffQueueItemDetail,
  "id" | "entityType" | "entityId" | "status" | "claimedByMe" | "claimedByOther" | "anon" | "category" | "label" | "canUnmask" | "suggestion" | "locked"
>;

const fieldLabel = "flex flex-col gap-1.5 text-sm font-medium text-gray-800";

/**
 * The right-hand panel of a queue item: the ladder suggestion, Take action (the sanctions ladder for this role), the
 * 10-minute claim, and for admins on Buzz items the unmask ritual. The unmasked identity lives in this component's
 * state only: it re-masks at `expiresAt` (five minutes), on "Re-mask now", and whenever the page is left.
 */
export function ItemActions({ item, role, actorName }: { item: ItemSummary; role: StaffRole; actorName: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const open = item.status !== "closed";

  // action sheet
  const [sheet, setSheet] = useState(false);
  const actions = useMemo(
    () => STAFF_ACTIONS.filter((a) => (a.role === "mod" || role === "admin") && (!a.buzzThreadOnly || (item.entityType === "buzz" && item.entityId !== null))),
    [role, item.entityType, item.entityId],
  );
  const [act, setAct] = useState<StaffActionId>("approve");
  const [category, setCategory] = useState(item.category ?? "");
  const [note, setNote] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [reference, setReference] = useState("");
  const [badFaith, setBadFaith] = useState(false);
  const def = actions.find((a) => a.id === act) ?? null;
  const minNote = act === "ban" ? BAN_NOTE_MIN : NOTE_MIN;
  const canSubmit =
    def !== null && category !== "" && (!def.needsNote || note.trim().length >= minNote) && (act !== "ban" || confirmText === "BAN") && (act !== "escalate_external" || reference.trim().length > 0);

  function openSheet(preset: StaffActionId | null) {
    const fallback: StaffActionId = open ? "approve" : "restore";
    const wanted = preset ?? item.suggestion?.action ?? fallback;
    setAct(actions.some((a) => a.id === wanted) ? wanted : fallback);
    setCategory(item.category ?? "");
    setNote("");
    setConfirmText("");
    setReference("");
    setBadFaith(false);
    setSheet(true);
  }

  function submit() {
    if (!def) return;
    start(async () => {
      const res = await actOnItemAction({
        id: item.id,
        action: def.id,
        category,
        note: note.trim() || undefined,
        confirmText: confirmText || undefined,
        reference: reference.trim() || undefined,
        badFaith: badFaith || undefined,
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      setSheet(false);
      setMessage({ tone: "ok", text: `${def.label} · logged${res.data.status === "closed" ? ` · item closed (${res.data.resolution ?? "closed"})` : ""}` });
    });
  }

  function claim(mode: "claim" | "release") {
    start(async () => {
      const res = mode === "claim" ? await claimItemAction(item.id) : await releaseItemAction(item.id);
      setMessage(res.ok ? { tone: "ok", text: mode === "claim" ? "Claimed for 10 minutes." : "Claim released." } : { tone: "error", text: res.error });
    });
  }

  // unmask
  const [unmaskOpen, setUnmaskOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<UnmaskReasonCode | "">("");
  const [reason, setReason] = useState("");
  const [caseRef, setCaseRef] = useState("");
  const [typed, setTyped] = useState("");
  const [unmaskError, setUnmaskError] = useState<string | null>(null);
  const [unmasked, setUnmasked] = useState<UnmaskResponse | null>(null);
  const unmaskValid = reasonCode !== "" && reason.trim().length >= UNMASK_REASON_MIN && typed === "UNMASK";

  useEffect(() => {
    if (!unmasked) return;
    const t = window.setTimeout(() => setUnmasked(null), Math.max(0, unmasked.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [unmasked]);

  function closeUnmask() {
    setUnmaskOpen(false);
    setReason("");
    setCaseRef("");
    setTyped("");
    setReasonCode("");
    setUnmaskError(null);
  }

  function runUnmask() {
    if (reasonCode === "" || (item.entityType !== "buzz" && item.entityType !== "buzz_reply")) return;
    const entityType = item.entityType;
    start(async () => {
      // blocked text never became content: the unmask is addressed by the queue item's own id
      const res = await unmaskAction({ entityType, entityId: item.entityId ?? item.id, reasonCode, reason: reason.trim(), confirm: typed, caseRef: caseRef.trim() || undefined });
      if (!res.ok) {
        setUnmaskError(res.error);
        return;
      }
      setUnmasked(res.data);
      closeUnmask();
      setMessage({ tone: "ok", text: "Unmasked and logged. Every other admin has been told." });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {unmasked ? <UnmaskPanel result={unmasked} onRemask={() => setUnmasked(null)} /> : null}

      {item.suggestion ? (
        <div className="flex items-start gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">Suggested: {STAFF_ACTIONS.find((a) => a.id === item.suggestion!.action)?.label ?? item.suggestion.action}</div>
            <p className="text-sm text-gray-600">{item.suggestion.reason}</p>
          </div>
          {open && !item.claimedByOther ? (
            <Button size="sm" variant="outline" onClick={() => openSheet(item.suggestion!.action)}>
              Use
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.claimedByOther ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">Being reviewed by another staff member. Actions unlock when their 10-minute claim ends.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" onClick={() => openSheet(null)} data-testid="staff-take-action">
            <Gavel className="h-4 w-4" aria-hidden />
            {open ? "Take action" : "Restore / lift"}
          </Button>
          {item.canUnmask ? (
            <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setUnmaskOpen(true)} data-testid="staff-unmask">
              <Eye className="h-4 w-4" aria-hidden />
              Unmask
            </Button>
          ) : null}
        </div>
      )}
      {open && !item.claimedByOther ? (
        <Button variant="ghost" size="sm" loading={pending && !sheet && !unmaskOpen} onClick={() => claim(item.claimedByMe ? "release" : "claim")} className="self-start">
          {item.claimedByMe ? <Unlock className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          {item.claimedByMe ? "Release my claim" : "Claim for 10 minutes"}
        </Button>
      ) : null}
      {message ? (
        <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-green-700" : "text-red-600")}>
          {message.text}
        </p>
      ) : null}
      <p className="text-xs text-gray-500">
        Approve and dismiss close the item · Remove strikes the author · Warnings and mutes act on the author{item.anon ? " blind" : ""} · Suspensions, bans, external escalation and lifts are admin
        only.
      </p>

      <StaffDialog
        open={sheet}
        onClose={() => setSheet(false)}
        title="Take action"
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant={def?.destructive ? "danger" : "primary"} disabled={!canSubmit} loading={pending} onClick={submit} data-testid="staff-act-submit">
              {def?.label ?? "Apply"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Acting" name={actorName} note="Written to the append-only audit log." />
          {item.anon ? <BlindNote /> : null}
          <label className={fieldLabel}>
            Action
            <Select value={act} onChange={(e) => setAct(e.target.value as StaffActionId)} data-autofocus>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </Select>
            {def ? <span className="text-xs font-normal text-gray-600">{def.detail}</span> : null}
          </label>
          <label className={fieldLabel}>
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
          <label className={fieldLabel}>
            {def?.needsNote ? `Note (required, ${minNote}+ characters, staff only)` : "Note (optional, staff only)"}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-24" />
            {item.anon ? <span className="text-xs font-normal text-gray-500">Do not write a name or handle here.</span> : null}
          </label>
          {act === "escalate_external" ? (
            <label className={fieldLabel}>
              Outside reference number
              <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
            </label>
          ) : null}
          {act === "ban" ? (
            <label className={fieldLabel}>
              Type BAN to confirm
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" autoComplete="off" />
            </label>
          ) : null}
          {act === "dismiss_reports" ? (
            <label className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
              Mark the reports as bad faith (lowers the reporters&apos; trust)
              <input type="checkbox" checked={badFaith} onChange={(e) => setBadFaith(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600" />
            </label>
          ) : null}
          {(category === "self_harm" || item.label === "wellbeing") && def && ["remove_and_warn", "remove_and_mute_24h", "remove_and_mute_72h", "remove_and_mute_7d", "warn_only", "suspend_7d", "suspend_30d", "ban"].includes(def.id) ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Wellbeing items never sanction. Approve, dismiss or escalate instead.</p>
          ) : null}
        </div>
      </StaffDialog>

      <StaffDialog
        open={unmaskOpen}
        onClose={closeUnmask}
        persistent
        tone="danger"
        icon={<Eye className="h-5 w-5" aria-hidden />}
        title="Unmask this author?"
        description="Only for a credible threat, a risk to life, child safety, severe or repeated harassment, a valid legal request or ban evasion. Every unmask is permanently logged and every other admin is alerted. The identity re-masks on screen after five minutes."
        footer={
          <>
            <Button variant="outline" onClick={closeUnmask} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!unmaskValid} loading={pending} onClick={runUnmask} data-testid="staff-unmask-submit">
              Unmask and log
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Unmasking" name={actorName} />
          <label className={fieldLabel}>
            Reason code
            <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as UnmaskReasonCode | "")} data-autofocus>
              <option value="">Pick a reason code</option>
              {UNMASK_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {UNMASK_REASON_LABELS[c]}
                </option>
              ))}
            </Select>
          </label>
          <label className={fieldLabel}>
            Written reason ({UNMASK_REASON_MIN}+ characters)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} className="min-h-28" />
            <span className={cn("self-end text-xs font-normal tabular-nums", reason.trim().length >= UNMASK_REASON_MIN ? "text-gray-500" : "text-amber-700")}>{reason.trim().length}/2000</span>
          </label>
          <label className={fieldLabel}>
            Case reference (optional)
            <Input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} maxLength={100} autoComplete="off" />
          </label>
          <label className={fieldLabel}>
            Type UNMASK to confirm
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          </label>
          {unmaskError ? (
            <p role="alert" className="text-sm text-red-600">
              {unmaskError}
            </p>
          ) : null}
        </div>
      </StaffDialog>
    </div>
  );
}

/** The identity, for five minutes, then gone. Never stored anywhere but this component's state. */
function UnmaskPanel({ result, onRemask }: { result: UnmaskResponse; onRemask: () => void }) {
  const now = useNow(1000);
  const left = Math.max(0, result.expiresAt - now);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  return (
    <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300" data-testid="staff-unmask-result">
      <div className="mb-2 flex items-center gap-2">
        <Eye className="h-4 w-4 text-amber-700" aria-hidden />
        <span className="text-sm font-semibold text-gray-900" aria-live="polite">
          Unmasked · re-masks in {mm}:{String(ss).padStart(2, "0")}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemask}>
          <EyeOff className="h-4 w-4" aria-hidden />
          Re-mask now
        </Button>
      </div>
      <KeyValue
        rows={[
          { k: "Name", v: result.user.fullName },
          { k: "Username", v: result.user.username ? `@${result.user.username}` : "—" },
          { k: "Email", v: result.user.email ?? "—" },
          { k: "Campus", v: result.user.universityName ?? "—" },
          { k: "Joined", v: dateTime(result.user.createdAt) },
          { k: "User id", v: <span className="font-mono text-xs">{result.user.id}</span> },
          { k: "Audit id", v: <span className="font-mono text-xs">{result.auditId}</span> },
        ]}
      />
      <div className="mt-2">
        <Link href={`/admin/users/${result.user.id}`} prefetch={false} className="text-sm font-semibold text-brand-700 hover:underline">
          Open account
        </Link>
      </div>
    </div>
  );
}
