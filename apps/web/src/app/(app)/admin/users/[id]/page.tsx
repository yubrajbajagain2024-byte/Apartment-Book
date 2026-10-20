import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { categoryLabel, STAFF_SANCTION_LABELS } from "@/lib/staff/constants";
import { dateTime, day } from "@/lib/staff/format";
import { fetchUser, requireStaff, requireUuid, staffMetadata } from "@/lib/staff/server";
import type { StaffSanctionRow } from "@/lib/staff/types";
import { Avatar } from "@/components/ui/avatar";
import { KeyValue, Panel, Pill, ROLE_TONE, Section } from "@/components/staff/parts";
import { LiftSanctionButton, UserActions } from "@/components/staff/user-actions";

export const generateMetadata = () => staffMetadata("Account · Trust & Safety");

/**
 * An account's standing (UniVerse UserDetailPage): role, status, strike points, open items, sanctions, direct
 * sanctions and (admins) lifts and roles. FIREWALL: moderators see public-origin standing only; admins see anon-origin
 * rows too, with a sealed id, day-floored times and never the content.
 */
export default async function StaffUserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const u = await fetchUser(requireUuid(id));
  const admin = me.role === "admin";
  const actorName = me.username ? `@${me.username}` : me.name;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/users" prefetch={false} className="inline-flex items-center gap-1 self-start text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Users
      </Link>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel className="flex items-center gap-3">
            <Avatar name={u.user.fullName} src={u.user.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <Link href={`/profile/${u.user.id}`} prefetch={false} className="block truncate text-lg font-semibold text-gray-900 hover:underline">
                {u.user.fullName}
              </Link>
              <div className="truncate text-sm text-gray-500">{u.user.username ? `@${u.user.username}` : "no username"}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill tone={ROLE_TONE[u.role] ?? "gray"}>{u.role}</Pill>
                <Pill variant="outline" tone={u.status === "active" ? "green" : "red"}>
                  {u.status}
                </Pill>
                <Pill variant="outline" tone={u.strikePoints ? "amber" : "gray"}>
                  {u.strikePoints} strike pts
                </Pill>
                {u.openQueueItems ? (
                  <Pill variant="outline" tone="blue">
                    {u.openQueueItems} open
                  </Pill>
                ) : null}
              </div>
            </div>
          </Panel>
          <KeyValue
            rows={[
              { k: "Campus", v: u.user.universityName ?? "—" },
              { k: "Joined", v: dateTime(u.user.createdAt) },
              ...(u.email ? [{ k: "Email", v: u.email }] : []),
              { k: "Account id", v: <span className="font-mono text-xs">{u.user.id}</span> },
            ]}
          />
          {!admin ? <p className="text-xs text-gray-500">Moderator view: public-origin standing only.</p> : null}

          <Section title="Sanctions" hint={u.sanctions.length}>
            {u.sanctions.length === 0 ? <p className="text-sm text-gray-500">No sanctions on this account.</p> : null}
            {u.sanctions.map((s) => (
              <SanctionRow key={s.id} s={s} canLift={admin} actorName={actorName} />
            ))}
          </Section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
          <Section title="Actions">
            <UserActions user={u} role={me.role} viewerId={me.id} actorName={actorName} />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function SanctionRow({ s, canLift, actorName }: { s: StaffSanctionRow; canLift: boolean; actorName: string }) {
  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={s.kind === "ban" || s.kind === "suspension" ? "red" : s.kind === "mute" ? "amber" : "gray"}>{STAFF_SANCTION_LABELS[s.kind] ?? s.kind}</Pill>
        <Pill variant="outline" tone={s.origin === "anon" ? "violet" : "gray"}>
          {s.origin === "anon" ? "Buzz origin" : "Public origin"}
        </Pill>
        {s.category ? <span className="text-xs text-gray-700">{categoryLabel(s.category)}</span> : null}
        {s.inEffect ? <Pill tone="red">in effect</Pill> : null}
        <span className="ml-auto text-xs text-gray-500">{s.origin === "anon" ? day(s.createdAt) : dateTime(s.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        {s.scope !== "all" ? `Scope ${s.scope} · ` : ""}
        {s.liftedAt ? `lifted ${s.origin === "anon" ? day(s.liftedAt) : dateTime(s.liftedAt)}` : s.until ? `until ${s.origin === "anon" ? day(s.until) : dateTime(s.until)}` : s.kind === "ban" ? "permanent" : "no end time"}
        {s.appealStatus !== "none" ? ` · appeal ${s.appealStatus}` : ""}
        {s.acknowledgedAt ? " · acknowledged" : ""}
        {s.origin === "anon" ? " · times shown to the day" : ""}
      </div>
      {canLift && s.liftable ? (
        <div className="mt-2">
          <LiftSanctionButton sanctionId={s.id} actorName={actorName} />
        </div>
      ) : null}
    </Panel>
  );
}
