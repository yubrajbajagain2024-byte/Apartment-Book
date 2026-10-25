"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Ban, Check, ExternalLink, Megaphone, RotateCcw, X } from "lucide-react";
import { businessCategoryLabel, formatPrice, type AdminBusinessRow, type AdminPromotionRow, type BusinessDecision, type PromotionTarget } from "@apartment-book/shared";
import { adminCancelPromotionAction, adminRecordPromotionAction, adminReviewAction, adminVerifyAction } from "@/lib/actions/business";
import { cn, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

const TONE: Record<string, "amber" | "green" | "red" | "gray"> = { pending: "amber", approved: "green", rejected: "red", suspended: "red" };
type Extras = Record<string, { targets: PromotionTarget[]; promotions: AdminPromotionRow[] }>;
type Run = (work: () => Promise<{ error?: string }>) => void;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Verified Partner: what was checked, on record; or the mark taken away. */
function Verification({ b, run, busy }: { b: AdminBusinessRow; run: Run; busy: boolean }) {
  const [evidence, setEvidence] = useState("");
  if (b.verified_partner) {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900 sm:flex-row sm:items-center">
        <BadgeCheck className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          Verified Partner since {b.verified_at ? formatDate(b.verified_at) : "?"}. Checked: <span className="font-medium">{b.verification_note}</span>
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => adminVerifyAction(b.id, false))}>
          Remove the mark
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="What you checked: a licence number, a site visit, a call to the office…" maxLength={1000} aria-label="Verification evidence" className="flex-1" />
      <Button size="sm" variant="outline" disabled={busy || evidence.trim().length < 10} onClick={() => run(() => adminVerifyAction(b.id, true, evidence))}>
        <BadgeCheck className="h-4 w-4" /> Mark Verified Partner
      </Button>
    </div>
  );
}

/** Paid promotions: the ones on record, and a form to record a new one once it is paid. */
function Promotions({ extras, run, busy }: { extras: Extras[string] | undefined; run: Run; busy: boolean }) {
  const targets = extras?.targets ?? [];
  const promotions = extras?.promotions ?? [];
  const [target, setTarget] = useState(targets[0] ? `${targets[0].target_type}:${targets[0].target_id}` : "");
  const [startsOn, setStartsOn] = useState(today());
  const [endsOn, setEndsOn] = useState(inDays(30));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const now = new Date().toISOString();
  return (
    <div className="flex flex-col gap-2" data-testid="promotions">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <Megaphone className="h-3.5 w-3.5" /> Paid promotions
      </p>
      {promotions.length === 0 ? <p className="text-sm text-gray-500">None yet. A listing or deal shows “Sponsored” only while a paid promotion recorded here runs.</p> : null}
      <ul className="flex flex-col gap-1">
        {promotions.map((p) => {
          const running = p.status === "active" && p.starts_at <= now && p.ends_at > now;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-gray-900">{p.title ?? "(deleted)"}</span>
                <span className="text-gray-500">
                  {" "}
                  · {formatDate(p.starts_at)} to {formatDate(p.ends_at)} · {formatPrice(p.amount_cents / 100, p.currency)} · ref {p.payment_reference}
                </span>
              </span>
              <Badge tone={p.status === "cancelled" ? "gray" : running ? "green" : "amber"}>{p.status === "cancelled" ? "cancelled" : running ? "running" : p.ends_at <= now ? "ended" : "scheduled"}</Badge>
              {p.status === "active" && p.ends_at > now ? (
                <button type="button" disabled={busy} onClick={() => run(() => adminCancelPromotionAction(p.id))} className="text-xs font-semibold text-red-600 hover:underline">
                  Cancel
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {targets.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr_auto] sm:items-end">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Listing or deal to promote">
            {targets.map((t) => (
              <option key={`${t.target_type}:${t.target_id}`} value={`${t.target_type}:${t.target_id}`}>
                {t.target_type === "apartment" ? "Listing" : "Deal"}: {t.title} ({t.status})
              </option>
            ))}
          </Select>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label="Starts" />
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="Ends" />
          <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Paid" aria-label="Amount paid" />
          <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} aria-label="Currency" />
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice or receipt number" aria-label="Payment reference" maxLength={200} />
          <Button
            size="sm"
            disabled={busy || !target || !amount || reference.trim().length < 3}
            onClick={() =>
              run(async () => {
                const result = await adminRecordPromotionAction({ target, startsOn, endsOn, amount, currency, paymentReference: reference });
                if (!result.error) {
                  setAmount("");
                  setReference("");
                }
                return result;
              })
            }
          >
            Record paid promotion
          </Button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">It has no listings or deals to promote yet.</p>
      )}
    </div>
  );
}

function BusinessCard({ b, universityNames, extras, run, busy }: { b: AdminBusinessRow; universityNames: Record<string, string>; extras: Extras[string] | undefined; run: Run; busy: boolean }) {
  const [note, setNote] = useState(b.review_note ?? "");
  const campuses = b.university_ids.map((id) => universityNames[id] ?? "Campus");
  const decide = (decision: BusinessDecision) => run(() => adminReviewAction(b.id, decision, note));
  return (
    <article className={cn("flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200", busy && "opacity-60")} data-testid="admin-business">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={b.name} src={b.logo_url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-gray-900">{b.name}</span>
            <Badge tone={TONE[b.status] ?? "gray"}>{b.status}</Badge>
            {b.verified_partner ? (
              <Badge tone="green">
                <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Verified Partner
              </Badge>
            ) : null}
            {b.active_promotions > 0 ? <Badge tone="blue">{b.active_promotions} paid {b.active_promotions === 1 ? "promotion" : "promotions"}</Badge> : null}
            {!b.owner_confirmed ? <Badge tone="amber">Email not confirmed</Badge> : null}
          </p>
          <p className="text-sm text-gray-600">
            {businessCategoryLabel(b.category)}
            {b.city ? ` · ${b.city}` : ""} · applied {formatDate(b.created_at)}
          </p>
          <p className="text-sm text-gray-600">
            Owner: <span className="font-medium text-gray-900">{b.owner_name}</span>
            {b.owner_email ? ` · ${b.owner_email}` : ""}
            {b.phone ? ` · ${b.phone}` : ""}
          </p>
          <p className="text-sm text-gray-600">
            {b.website ? (
              <a href={b.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                {b.website} <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              "No website"
            )}
            {" · "}
            {campuses.length ? campuses.join(", ") : "Every campus"} · {b.members} on the team · {b.listings} listings · {b.deals} deals
          </p>
          {b.description ? <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{b.description}</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the business (optional)" maxLength={1000} aria-label="Review note" className="flex-1" />
        {b.status !== "approved" ? (
          <Button size="sm" disabled={busy || !b.owner_confirmed} title={b.owner_confirmed ? undefined : "The owner has not confirmed their email yet"} onClick={() => decide("approved")}>
            <Check className="h-4 w-4" /> Approve
          </Button>
        ) : null}
        {b.status === "pending" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("rejected")}>
            <X className="h-4 w-4" /> Reject
          </Button>
        ) : null}
        {b.status === "approved" ? (
          <Button size="sm" variant="outline" className="text-red-600" disabled={busy} onClick={() => decide("suspended")}>
            <Ban className="h-4 w-4" /> Suspend
          </Button>
        ) : null}
        {b.status === "suspended" || b.status === "rejected" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("pending")}>
            <RotateCcw className="h-4 w-4" /> Back to review
          </Button>
        ) : null}
      </div>

      {b.status === "approved" ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
          <Verification b={b} run={run} busy={busy} />
          <Promotions extras={extras} run={run} busy={busy} />
        </div>
      ) : null}
    </article>
  );
}

export function AdminReview({ businesses, universityNames, extras }: { businesses: AdminBusinessRow[]; universityNames: Record<string, string>; extras: Extras }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runFor = (id: string): Run => (work) => {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await work();
      setError(result.error ?? null);
      setBusyId(null);
      router.refresh();
    });
  };
  const groups: { title: string; rows: AdminBusinessRow[] }[] = [
    { title: "Waiting for review", rows: businesses.filter((b) => b.status === "pending") },
    { title: "Approved", rows: businesses.filter((b) => b.status === "approved") },
    { title: "Suspended or rejected", rows: businesses.filter((b) => b.status === "suspended" || b.status === "rejected") },
  ];
  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {g.title} <span className="font-normal normal-case">({g.rows.length})</span>
          </h2>
          {g.rows.length === 0 ? <p className="text-sm text-gray-500">Nothing here.</p> : null}
          {g.rows.map((b) => (
            <BusinessCard key={b.id} b={b} universityNames={universityNames} extras={extras[b.id]} run={runFor(b.id)} busy={pending && busyId === b.id} />
          ))}
        </section>
      ))}
    </div>
  );
}
