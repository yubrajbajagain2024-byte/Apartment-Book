"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  Mail,
  MailX,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { auditActionLabel, formatDate, listAuditLog, MODERATION_TARGET_TYPE_VALUES, MODERATION_TARGET_TYPES, REPORT_DECISIONS, STAFF_ROLES, type AuditEntry } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage, isUuid } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/field";
import { Time } from "@/components/common/time";

const PAGE = 50;

const LOOKS: Record<string, { icon: LucideIcon; className: string }> = {
  "owner.bootstrap": { icon: Crown, className: "bg-brand-50 text-brand-700" },
  "invite.accepted": { icon: UserPlus, className: "bg-green-100 text-green-700" },
  "invite.held": { icon: Mail, className: "bg-amber-100 text-amber-800" },
  "staff.add": { icon: UserPlus, className: "bg-green-100 text-green-700" },
  "staff.role": { icon: UserCog, className: "bg-brand-50 text-brand-700" },
  "staff.remove": { icon: UserMinus, className: "bg-red-100 text-red-700" },
  "invite.create": { icon: Mail, className: "bg-gray-100 text-gray-700" },
  "invite.revoke": { icon: MailX, className: "bg-gray-100 text-gray-700" },
  "security.mfa_enrolled": { icon: ShieldCheck, className: "bg-green-100 text-green-700" },
  "security.mfa_removed": { icon: ShieldOff, className: "bg-amber-100 text-amber-800" },
  "user.suspend": { icon: UserX, className: "bg-red-100 text-red-700" },
  "user.unsuspend": { icon: UserCheck, className: "bg-green-100 text-green-700" },
  "content.hide": { icon: EyeOff, className: "bg-amber-100 text-amber-800" },
  "content.restore": { icon: Eye, className: "bg-green-100 text-green-700" },
  "content.delete": { icon: Trash2, className: "bg-red-100 text-red-700" },
  "content.view": { icon: Eye, className: "bg-gray-100 text-gray-700" },
  "report.resolve": { icon: CheckCircle2, className: "bg-brand-50 text-brand-700" },
  "report.reopen": { icon: RotateCcw, className: "bg-gray-100 text-gray-700" },
  "media.retry": { icon: RefreshCw, className: "bg-gray-100 text-gray-700" },
};

const FALLBACK_LOOK = { icon: Activity, className: "bg-gray-100 text-gray-700" };

function roleName(value: unknown): string {
  if (typeof value !== "string") return "";
  return STAFF_ROLES.find((r) => r.value === value)?.label ?? value;
}

function typeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return MODERATION_TARGET_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Why a staff.remove row exists when a trigger wrote it rather than an admin. */
const CAUSES: Record<string, string> = { account_deleted: "deleted their own account", cascade: "account removed" };

/** One line built from `details`: "jane@uni.edu · Admin → Moderator · inviter demoted" or "Apartment listing · Looks fake". */
function auditSummary(entry: AuditEntry): string {
  const d = entry.details;
  const parts: string[] = [];
  if (typeof d.email === "string") parts.push(d.email);
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${roleName(d.from)} → ${roleName(d.to)}`);
  else if (typeof d.role === "string") parts.push(roleName(d.role));
  if (typeof d.target_type === "string") parts.push(typeName(d.target_type));
  else if (entry.action.startsWith("content.") && entry.targetType) parts.push(typeName(entry.targetType));
  if (typeof d.title === "string" && d.title) parts.push(`“${d.title.slice(0, 80)}”`);
  if (typeof d.decision === "string") parts.push(REPORT_DECISIONS.find((x) => x.value === d.decision)?.label ?? d.decision);
  if (typeof d.friendly_name === "string" && d.friendly_name) parts.push(d.friendly_name);
  if (typeof d.kind === "string" && typeof d.ref === "string") parts.push(`${d.kind} ${d.ref}`);
  if (d.pending === true) parts.push("pending confirmation");
  if (typeof d.reason === "string" && d.reason) parts.push(d.reason);
  if (typeof d.expires_at === "string") parts.push(`until ${formatDate(d.expires_at)}`);
  else if (entry.action === "user.suspend" && d.expires_at === null) parts.push("until lifted");
  if (typeof d.cause === "string" && d.cause in CAUSES) parts.push(CAUSES[d.cause]);
  if (parts.length === 0 && entry.targetType) parts.push(entry.targetType);
  return parts.join(" · ");
}

/** Where a row points: the person, the report or the content it is about. */
function auditHref(entry: AuditEntry): string | null {
  if (!isUuid(entry.targetId)) return null;
  if (entry.action.startsWith("user.") || entry.action.startsWith("staff.")) return `/users/${entry.targetId}`;
  if (entry.action.startsWith("report.")) return `/reports/${entry.targetId}`;
  if (entry.action === "content.hide" || entry.action === "content.restore" || entry.action === "content.view") {
    const type = entry.targetType ?? "";
    if ((MODERATION_TARGET_TYPE_VALUES as readonly string[]).includes(type)) return `/content/${type}/${entry.targetId}`;
  }
  return null;
}

/** One audit entry. Used on the audit page and in the overview's "Recent activity" card. */
export function AuditRow({ entry }: { entry: AuditEntry }) {
  const look = LOOKS[entry.action] ?? FALLBACK_LOOK;
  const Icon = look.icon;
  const actor = entry.actorName || entry.actorEmail || "System";
  const summary = auditSummary(entry);
  const href = auditHref(entry);
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", look.className)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          {href ? (
            <Link href={href} className="hover:underline">
              {auditActionLabel(entry.action)}
            </Link>
          ) : (
            auditActionLabel(entry.action)
          )}
        </p>
        {summary ? <p className="text-sm break-words text-gray-700">{summary}</p> : null}
        <p className="mt-0.5 text-xs text-gray-500">
          <span className="font-medium text-gray-600">{actor}</span>
          <span aria-hidden="true"> · </span>
          <Time iso={entry.createdAt} />
        </p>
      </div>
    </li>
  );
}

/** Full audit log: the first page comes from the server, older pages are fetched with the browser client. */
export function AuditList({ initial }: { initial: AuditEntry[] }) {
  const [items, setItems] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loading) return;
    setLoading(true);
    setError(null);
    try {
      const older = await listAuditLog(createClient(), { limit: PAGE, before: last.id });
      setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
      setDone(older.length < PAGE);
    } catch (e) {
      setError(`Could not load older entries. ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return <EmptyState icon={ScrollText} title="No activity yet" description="Team changes, security events and moderation actions are recorded here as they happen." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-gray-100">
          {items.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </Card>
      <FormMessage error={error} />
      {!done ? (
        <Button variant="outline" onClick={loadMore} loading={loading} className="self-center">
          Load older
        </Button>
      ) : items.length > PAGE ? (
        <p className="text-center text-xs text-gray-500">That is the whole log.</p>
      ) : null}
    </div>
  );
}
