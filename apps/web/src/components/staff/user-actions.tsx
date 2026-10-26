"use client";

import { useState, useTransition } from "react";
import { directSanctionAction, grantRoleAction, liftSanctionAction } from "@/lib/staff/actions";
import { CATEGORY_OPTIONS, DIRECT_SANCTION_PRESETS, NOTE_MIN, SCOPE_OPTIONS } from "@/lib/staff/constants";
import type { StaffRole, StaffUserDetail } from "@/lib/staff/types";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ActingAs, StaffDialog } from "./dialog";

const fieldLabel = "flex flex-col gap-1.5 text-sm font-medium text-gray-800";

/**
 * A named account's actions: a direct sanction (always public-origin; moderators: warnings and mutes up to 7 days),
 * lifting one (admins; an anon-origin row is addressed by its sealed handle), and the role (admins, audited).
 */
export function UserActions({ user, role, viewerId, actorName }: { user: StaffUserDetail; role: StaffRole; viewerId: string; actorName: string }) {
  const admin = role === "admin";
  const self = user.user.id === viewerId;
  const presets = DIRECT_SANCTION_PRESETS.filter((p) => admin || !p.adminOnly);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [sheet, setSheet] = useState(false);
  const [preset, setPreset] = useState(presets[0]?.id ?? "warning");
  const [scope, setScope] = useState<"all" | "buzz_only" | "requests">("all");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const chosen = presets.find((p) => p.id === preset) ?? null;
  const valid = chosen !== null && category !== "" && note.trim().length >= NOTE_MIN;

  function apply() {
    if (!chosen) return;
    start(async () => {
      const res = await directSanctionAction({ userId: user.user.id, kind: chosen.kind, durationMs: chosen.durationMs, scope: chosen.kind === "mute" ? scope : "all", category, note: note.trim() });
      if (!res.ok) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      setSheet(false);
      setNote("");
      setMessage({ tone: "ok", text: `${chosen.label} applied · logged` });
    });
  }

  const [roleDraft, setRoleDraft] = useState<"user" | StaffRole>(user.role);
  function saveRole() {
    start(async () => {
      const res = await grantRoleAction({ userId: user.user.id, role: roleDraft });
      setMessage(res.ok ? { tone: "ok", text: `Role set to ${roleDraft} · logged` } : { tone: "error", text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="danger"
        disabled={self}
        onClick={() => {
          setPreset(presets[0]?.id ?? "warning");
          setCategory("");
          setNote("");
          setSheet(true);
        }}
      >
        Apply sanction
      </Button>
      {admin ? (
        <div className="flex items-end gap-2">
          <label className={cn(fieldLabel, "flex-1")}>
            Role
            <Select value={roleDraft} onChange={(e) => setRoleDraft(e.target.value as "user" | StaffRole)} disabled={self}>
              <option value="user">User</option>
              <option value="moderator">Moderator: queues and actions, blind on Buzz</option>
              <option value="admin">Admin: everything, including suspensions, bans and unmask</option>
            </Select>
          </label>
          <Button variant="outline" disabled={self || roleDraft === user.role} loading={pending && !sheet} onClick={saveRole}>
            Save role
          </Button>
        </div>
      ) : null}
      {self ? <p className="text-xs text-gray-500">You cannot sanction yourself or change your own role.</p> : null}
      {message ? (
        <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-green-700" : "text-red-600")}>
          {message.text}
        </p>
      ) : null}

      <StaffDialog
        open={sheet}
        onClose={() => setSheet(false)}
        title="Apply sanction"
        footer={
          <>
            <Button variant="outline" onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!valid} loading={pending} onClick={apply}>
              {chosen?.label ?? "Apply"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Acting" name={actorName} note="Direct sanctions are public-origin and audited." />
          <label className={fieldLabel}>
            Sanction
            <Select value={preset} onChange={(e) => setPreset(e.target.value)} data-autofocus>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          {chosen?.kind === "mute" ? (
            <label className={fieldLabel}>
              Scope
              <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
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
            Note (required, {NOTE_MIN}+ characters, staff only)
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-20" />
          </label>
        </div>
      </StaffDialog>
    </div>
  );
}

/** "Lift" on one sanction row (admins). */
export function LiftSanctionButton({ sanctionId, actorName }: { sanctionId: string; actorName: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function lift() {
    start(async () => {
      const res = await liftSanctionAction({ sanctionId, note: note.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setDone("Lifted · logged");
    });
  }
  if (done) return <span className="text-xs text-green-700">{done}</span>;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Lift
      </Button>
      <StaffDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Lift this sanction?"
        description="It ends at once. A lifted suspension leaves the account treated as new for 72 hours."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={note.trim().length < NOTE_MIN} loading={pending} onClick={lift}>
              Lift and log
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ActingAs verb="Acting" name={actorName} />
          <label className={fieldLabel}>
            Note ({NOTE_MIN}+ characters)
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
