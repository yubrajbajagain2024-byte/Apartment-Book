import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Plus } from "lucide-react";
import { BUSINESS_REPORT_REASONS, businessCategoryLabel, clickRate, listUniversities } from "@apartment-book/shared";
import { businessAuditLabel, businessAuditDetail } from "@/lib/console/audit-format";
import { stamp } from "@/lib/console/format";
import { fetchConsoleBusiness, requireConsoleAdmin, requireUuid } from "@/lib/console/server";
import { KeyValue, Panel, Pill, Section, StatTile } from "@/components/console/parts";
import { BusinessDecisionPanel, BusinessNoteForm, VerifyPanel } from "@/components/business/advertiser-actions";
import { AdStatusPill, BusinessStatusPill, centralDay, centralTime, period, placementsText, usd } from "@/components/business/parts";
import { PaymentsTable } from "@/components/business/payments-table";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Advertiser" };

const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", analyst: "Analyst" } as const;

/**
 * One advertiser in full: standing and Verified Partner, the profile, the owner and team (each a link to their user
 * page, where sanctions live), its campaigns with their numbers, payments, students' reports, the team's notes and the
 * latest of its audit log.
 */
export default async function AdvertiserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireConsoleAdmin("/business/advertisers");
  const id = requireUuid((await params).id);
  const [d, universities] = await Promise.all([fetchConsoleBusiness(id), listUniversities(me.supabase).catch(() => [])]);
  const b = d.business;
  const campusNames = new Map(universities.map((u) => [u.id, u.name]));
  const campuses = b.universityIds.length ? b.universityIds.map((u) => campusNames.get(u) ?? "Campus").join(", ") : "Every campus";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">
            <Link href="/business/advertisers" prefetch={false} className="hover:underline">
              Advertisers
            </Link>{" "}
            /
          </p>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-gray-900">
            {b.name}
            {b.verified ? <BadgeCheck className="h-5 w-5 text-brand-600" aria-label="Verified Partner" /> : null}
            <BusinessStatusPill status={b.status} />
          </h2>
          <p className="text-sm text-gray-600">
            {businessCategoryLabel(b.category)} · joined {centralDay(b.createdAt)} · <span className="font-mono text-xs">{b.id}</span>
          </p>
        </div>
        {b.status === "approved" ? (
          <Link href={`/business/campaigns/new?business=${b.id}`} prefetch={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
            <Plus className="h-4 w-4" aria-hidden /> Draft a campaign for them
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Paid, in force" value={usd(d.totals.paidCents)} hint={`${usd(d.totals.voidedCents)} voided`} />
        <StatTile label="Impressions · 30 days" value={d.stats30d.impressions.toLocaleString("en-US")} hint={`${d.stats30d.reach.toLocaleString("en-US")} students reached`} />
        <StatTile label="Clicks · 30 days" value={d.stats30d.clicks.toLocaleString("en-US")} hint={`click rate ${clickRate(d.stats30d.clicks, d.stats30d.impressions)}`} />
        <StatTile label="Messages · profile visits" value={`${d.stats30d.inquiries} · ${d.stats30d.profileVisits}`} hint="30 days" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Standing" hint={b.reviewedAt ? `last reviewed ${centralTime(b.reviewedAt)}` : "never reviewed"}>
          <Panel className="flex flex-col gap-4">
            {b.reviewNote ? <p className="text-sm text-gray-700">Note on record: {b.reviewNote}</p> : null}
            <BusinessDecisionPanel businessId={b.id} status={b.status} ownerConfirmed={d.owner?.confirmed ?? false} />
            {b.status === "approved" ? (
              <div className="border-t border-gray-100 pt-3">
                <VerifyPanel businessId={b.id} verified={b.verified} note={b.verificationNote} />
              </div>
            ) : null}
          </Panel>
        </Section>
        <Section title="Profile">
          <Panel>
            <KeyValue
              rows={[
                { k: "Campuses", v: campuses },
                { k: "Website", v: b.website ?? "—" },
                { k: "Contact", v: [b.contactEmail, b.phone].filter(Boolean).join(" · ") || "—" },
                { k: "Address", v: [b.address, b.city].filter(Boolean).join(", ") || "—" },
                { k: "Listings · posts", v: `${d.totals.listings} · ${d.totals.posts}` },
                { k: "About", v: b.description ? <span className="line-clamp-4">{b.description}</span> : "—" },
              ]}
            />
          </Panel>
        </Section>
      </div>

      <Section title="Advertiser accounts" hint={`${d.team.length} on the team${d.pendingInvites ? `, ${d.pendingInvites} invite${d.pendingInvites === 1 ? "" : "s"} open` : ""}`}>
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {d.team.map((m) => (
                <tr key={m.userId}>
                  <td className="px-3 py-1.5">
                    <Link href={`/users/${m.userId}`} prefetch={false} className="text-gray-900 hover:underline">
                      {m.name ?? "—"}
                    </Link>
                    {m.username ? <span className="ml-1 text-xs text-gray-500">@{m.username}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">{m.email ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <Pill tone={m.role === "owner" ? "violet" : "gray"}>{ROLE_LABEL[m.role] ?? m.role}</Pill>
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">{centralDay(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 pb-2 text-xs text-gray-500">The owner manages the team in the portal. To restrict a person, open their user page: warnings, mutes and suspensions work for business accounts too.</p>
        </Panel>
      </Section>

      <Section title="Campaigns" hint={`${d.ads.length}`}>
        {d.ads.length === 0 ? (
          <p className="text-sm text-gray-500">No ads yet.</p>
        ) : (
          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 text-right font-medium">Budget · paid</th>
                  <th className="px-3 py-2 text-right font-medium">Impressions · clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.ads.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-1.5">
                      <Link href={`/business/campaigns/${a.id}`} prefetch={false} className="font-medium text-gray-900 hover:underline">
                        {a.name}
                      </Link>
                      <p className="text-xs text-gray-500">{placementsText(a.placements)}</p>
                    </td>
                    <td className="px-3 py-1.5">
                      <AdStatusPill status={a.status} pausedBy={a.pausedBy} />
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">{period(a.startsAt, a.endsAt)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {usd(a.budgetCents)} · {usd(a.paidCents)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {a.impressions.toLocaleString("en-US")} · {a.clicks.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>

      <Section title="Payments" hint={`${d.payments.length}`}>
        <PaymentsTable payments={d.payments} showBusiness={false} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Students' reports" hint={`${d.reports.open} open`} action={<Link href="/business/reports" prefetch={false} className="text-xs font-medium text-brand-700 hover:underline">Reports</Link>}>
          <Panel className="flex flex-col gap-2">
            {d.reports.recent.length === 0 ? (
              <p className="text-sm text-gray-500">None.</p>
            ) : (
              d.reports.recent.map((r) => (
                <div key={r.id} className="text-sm">
                  <Pill tone={r.status === "open" ? "amber" : "gray"}>{BUSINESS_REPORT_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</Pill>{" "}
                  <span className="text-xs text-gray-500">
                    {centralDay(r.createdAt)} · {r.status}
                    {r.adId ? " · about an ad" : r.dealId ? " · about a post" : ""}
                  </span>
                  {r.details ? <p className="mt-0.5 text-gray-700">{r.details}</p> : null}
                </div>
              ))
            )}
          </Panel>
        </Section>
        <Section title="Team notes" hint="never shown to the business">
          <Panel className="flex flex-col gap-3">
            <BusinessNoteForm businessId={b.id} />
            {d.notes.map((n) => (
              <div key={n.id} className="border-t border-gray-100 pt-2 text-sm">
                <p className="whitespace-pre-wrap text-gray-800">{n.body}</p>
                <p className="text-xs text-gray-500">
                  {n.authorName ?? "Former staff"} · {centralTime(n.createdAt)}
                </p>
              </div>
            ))}
          </Panel>
        </Section>
      </div>

      <Section title="Audit log" hint="latest 20" action={<Link href={`/business/audit?business=${b.id}`} prefetch={false} className="text-xs font-medium text-brand-700 hover:underline">All</Link>}>
        <Panel className="divide-y divide-gray-100 p-0">
          {d.audit.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">Nothing logged yet.</p>
          ) : (
            d.audit.map((l) => (
              <div key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-gray-500">{stamp(l.createdAt)}</span>
                <span className="font-medium text-gray-900">{businessAuditLabel(l.action)}</span>
                <span className="text-gray-600">{l.actorKind === "admin" ? `${l.actorName ?? "Staff"} (team)` : l.actorKind === "system" ? "Automatic" : (l.actorName ?? "Former member")}</span>
                {businessAuditDetail(l.detail) ? <span className="w-full text-xs text-gray-500">{businessAuditDetail(l.detail)}</span> : null}
              </div>
            ))
          )}
        </Panel>
      </Section>
    </div>
  );
}
