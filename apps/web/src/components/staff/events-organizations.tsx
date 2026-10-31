"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BadgeCheck, Building2 } from "lucide-react";
import { ORGANIZATION_KINDS } from "@apartment-book/shared";
import { setOrganizationAction } from "@/lib/staff/actions";
import type { ConsoleOrganization } from "@/lib/staff/events";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ago } from "@/components/staff/live";
import { EmptyBox, Pill } from "@/components/staff/parts";

/**
 * Clubs, departments and organizations: the unverified ones first, each with Verify / Unverify and Hide / Restore and
 * an optional note for the audit row. Verifying publishes the organization's pending events; unverifying or hiding
 * takes them off the campus again (the database does both).
 */
export function EventOrganizationsPanel({ organizations }: { organizations: ConsoleOrganization[] }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(id: string, change: { verified?: boolean; status?: "active" | "hidden" }) {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    start(async () => {
      const res = await setOrganizationAction({ id, ...change, note: notes[id] });
      if (!res.ok) setErrors((e) => ({ ...e, [id]: res.error }));
      else setNotes((n) => ({ ...n, [id]: "" }));
      setBusy(null);
    });
  }

  if (organizations.length === 0) return <EmptyBox icon={Building2} title="No organizations yet." description="Students create clubs and organizations in the app; they appear here for verification." />;

  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      {organizations.map((o) => {
        const kind = ORGANIZATION_KINDS.find((k) => k.value === o.kind)?.label ?? o.kind;
        const rowBusy = pending && busy === o.id;
        return (
          <li key={o.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar name={o.name} src={o.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/organizations/${o.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                    {o.name}
                  </Link>
                  {o.verified ? (
                    <Pill tone="green">
                      <BadgeCheck className="h-3 w-3" aria-hidden /> verified
                    </Pill>
                  ) : (
                    <Pill tone="amber">awaiting verification</Pill>
                  )}
                  {o.status === "hidden" ? <Pill tone="red">hidden</Pill> : null}
                </div>
                <div className="text-xs text-gray-500">
                  {kind} · {o.university_name} · {o.members} {o.members === 1 ? "member" : "members"} · {o.events} {o.events === 1 ? "event" : "events"} · {o.follower_count} followers
                  {o.creator_username ? ` · made by @${o.creator_username}` : ""} · <Ago ms={Date.parse(o.created_at)} />
                </div>
                {o.website ? (
                  <a href={o.website} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
                    {o.website}
                  </a>
                ) : null}
              </div>
            </div>
            {o.description ? <p className="line-clamp-2 text-xs text-gray-600">{o.description}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Input value={notes[o.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [o.id]: e.target.value }))} placeholder="Note for the audit log (optional)" className="h-8 min-w-48 flex-1 text-xs" maxLength={2000} />
              {o.verified ? (
                <Button type="button" variant="outline" size="sm" disabled={rowBusy} onClick={() => act(o.id, { verified: false })}>
                  Unverify
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={rowBusy} onClick={() => act(o.id, { verified: true })}>
                  <BadgeCheck className="h-4 w-4" /> Verify
                </Button>
              )}
              {o.status === "hidden" ? (
                <Button type="button" variant="outline" size="sm" disabled={rowBusy} onClick={() => act(o.id, { status: "active" })}>
                  Restore
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" disabled={rowBusy} onClick={() => act(o.id, { status: "hidden" })}>
                  Hide
                </Button>
              )}
            </div>
            {errors[o.id] ? <p className="text-xs text-red-600">{errors[o.id]}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
