import Link from "next/link";
import { AlertTriangle, Flag } from "lucide-react";
import { AD_OBJECTIVES, adCtaLabel, clickRate, getDailyStats, listUniversities, mediaItems, periodElapsed, type AdPlacement } from "@apartment-book/shared";
import { auditActionLabel, auditDetailLine } from "@/lib/business/audit-format";
import { stamp } from "@/lib/staff/format";
import { fetchConsoleAd, requireStaffAdmin, requireUuid, staffMetadata } from "@/lib/staff/server";
import { AdPreview } from "@/components/business/ad-preview";
import { ConsoleChart } from "@/components/staff/console-chart";
import { KeyValue, Panel, Section, StatTile } from "@/components/staff/parts";
import { PausePanel, PaymentRecorder, ReviewPanel, TermsEditor } from "@/components/staff/business/campaign-actions";
import { AdStatusPill, BusinessStatusPill, centralTime, placementLabel, placementsText, usd } from "@/components/staff/business/parts";
import { PaymentsTable } from "@/components/staff/business/payments-table";

export const generateMetadata = () => staffMetadata("Campaign · CampConnect Admin");

/** The time this request renders at (each request renders afresh). */
const renderedAt = () => Date.now();

/**
 * One campaign: the creative as students see it (the portal's own preview), who it is for, the money (budget, the rate
 * card's price, payments and how much of the paid period has run), its numbers by day, what still stops it, the
 * decisions the team can take, and its history.
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaffAdmin();
  const id = requireUuid((await params).id);
  const a = await fetchConsoleAd(id);
  const [universities, daily] = await Promise.all([
    listUniversities(me.supabase).catch(() => []),
    getDailyStats(me.supabase, a.business.id, { days: 30, adId: a.id }).catch(() => []),
  ]);
  const names = new Map(universities.map((u) => [u.id, u.name]));
  const campuses = a.universityIds.length ? a.universityIds.map((u) => names.get(u) ?? "Campus").join(", ") : "Every campus (a v1 promotion)";
  const reviewable = a.status === "pending_review";
  const live = a.status === "scheduled" || a.status === "active" || a.status === "paused";
  const elapsed = periodElapsed(a.startsAt, a.endsAt, renderedAt());
  const media = mediaItems(a.media);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs text-gray-500">
          <Link href="/admin/business/campaigns" prefetch={false} className="hover:underline">
            Campaigns
          </Link>{" "}
          /{" "}
          <Link href={`/admin/business/advertisers/${a.business.id}`} prefetch={false} className="hover:underline">
            {a.business.name}
          </Link>
        </p>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold text-gray-900">
          {a.name} <AdStatusPill status={a.status} pausedBy={a.pausedBy} />
          {a.business.status !== "approved" ? <BusinessStatusPill status={a.business.status} /> : null}
        </h2>
        <p className="text-sm text-gray-600">
          {placementsText(a.placements)}
          {a.vertical === "housing" ? " · housing ad" : ""}
          {a.draftedByTeam ? " · drafted by the UniBuzz team" : ""} · <span className="font-mono text-xs">{a.id}</span>
        </p>
      </div>

      {a.statusReason ? <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">Reason on record: {a.statusReason}</p> : null}
      {a.needsReviewReason ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Flagged when v1 promotions became ads: {a.needsReviewReason}</p> : null}
      {a.fairHousingFlags.length ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Fair Housing screen: {a.fairHousingFlags.join("; ")}
        </p>
      ) : null}
      {a.openReports ? (
        <p className="flex items-center gap-2 text-sm text-red-700">
          <Flag className="h-4 w-4" aria-hidden /> {a.openReports} open report{a.openReports === 1 ? "" : "s"} from students.{" "}
          <Link href="/admin/business/reports" prefetch={false} className="font-medium underline">
            Reports
          </Link>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Impressions" value={a.stats.impressions.toLocaleString("en-US")} hint={`${a.stats.reach.toLocaleString("en-US")} students reached`} />
        <StatTile label="Clicks" value={a.stats.clicks.toLocaleString("en-US")} hint={`click rate ${clickRate(a.stats.clicks, a.stats.impressions)}`} />
        <StatTile label="Saves · messages" value={`${a.stats.saves} · ${a.stats.inquiries}`} />
        <StatTile label="Paid" value={usd(a.paidCents)} hint={elapsed === null || !a.paidCents ? `budget ${usd(a.budgetCents)}` : `${Math.round(elapsed * 100)}% of the paid period has run · budget ${usd(a.budgetCents)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {reviewable ? (
            <Section title="Review">
              <Panel>
                <ReviewPanel adId={a.id} quoteCents={a.quote?.cents ?? null} budgetCents={a.budgetCents} housing={a.vertical === "housing"} flagged={a.fairHousingFlags.length > 0} problems={a.problems} />
              </Panel>
            </Section>
          ) : null}
          {live ? (
            <Section title="Delivery">
              <Panel>
                <PausePanel adId={a.id} status={a.status} pausedBy={a.pausedBy} />
              </Panel>
            </Section>
          ) : null}
          {reviewable || live ? (
            <Section title="Schedule and budget" hint="Central time">
              <Panel>
                <TermsEditor adId={a.id} startsAt={a.startsAt} endsAt={a.endsAt} budgetCents={a.budgetCents} />
              </Panel>
            </Section>
          ) : a.status === "draft" || a.status === "rejected" ? (
            <p className="text-sm text-gray-600">{a.status === "draft" ? "A draft is the business's to finish and submit." : "Rejected: the business can edit it and submit it again."}</p>
          ) : null}

          <Section title="Details">
            <Panel>
              <KeyValue
                rows={[
                  { k: "Objective", v: AD_OBJECTIVES.find((o) => o.value === a.objective)?.label ?? a.objective },
                  { k: "Campuses", v: campuses },
                  { k: "Runs", v: a.startsAt ? `${centralTime(a.startsAt)} to ${centralTime(a.endsAt)}` : "No dates yet" },
                  { k: "Button", v: `${adCtaLabel(a.cta)}${a.ctaUrl ? ` → ${a.ctaUrl}` : ""}` },
                  { k: "Promotes", v: a.promoted ? `${a.promoted.type === "listing" ? "Listing" : a.promoted.type === "post" ? "Post" : "Removed"}: ${a.promoted.title ?? "—"}` : "Nothing" },
                  {
                    k: "Rate card",
                    v: a.quote
                      ? a.quote.cents !== null
                        ? `${usd(a.quote.cents)}: ${a.quote.lines.map((l) => `${placementLabel(l.placement)} ${usd(l.dailyCents)}/day`).join(" + ")} × ${a.quote.days} days × ${a.quote.campuses} campus${a.quote.campuses === 1 ? "" : "es"}${a.quote.minimumCents ? `, at least ${usd(a.quote.minimumCents)}` : ""}`
                        : `no price set for ${a.quote.missing.map(placementLabel).join(", ")}`
                      : "needs dates",
                  },
                  { k: "Submitted", v: centralTime(a.submittedAt) },
                  { k: "Reviewed", v: a.reviewedAt ? `${centralTime(a.reviewedAt)}${a.reviewNote ? ` · ${a.reviewNote}` : ""}` : "—" },
                  ...(a.fairHousingCheckedAt ? [{ k: "Fair Housing check", v: centralTime(a.fairHousingCheckedAt) }] : []),
                ]}
              />
            </Panel>
          </Section>

          <Section title="By day" hint="last 30 days, UTC days">
            <Panel>
              <ConsoleChart
                label={`${a.name}: delivery`}
                series={daily.map((d) => ({ day: d.day, impressions: Number(d.impressions), reach: Number(d.reach), clicks: Number(d.clicks) }))}
                measures={[
                  { key: "impressions", label: "Impressions" },
                  { key: "reach", label: "Students reached", headline: a.stats.reach },
                  { key: "clicks", label: "Clicks" },
                ]}
                emptyText="Not seen in the last 30 days."
              />
            </Panel>
          </Section>

          <Section title="Payments">
            <div className="flex flex-col gap-3">
              <PaymentsTable payments={a.payments} showBusiness={false} />
              {live ? (
                <Panel>
                  <p className="mb-2 text-sm font-medium text-gray-900">Record a further payment</p>
                  <PaymentRecorder adId={a.id} />
                </Panel>
              ) : null}
            </div>
          </Section>

          <Section title="History">
            <Panel className="divide-y divide-gray-100 p-0">
              {a.history.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-500">Nothing logged yet.</p>
              ) : (
                a.history.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5 text-sm">
                    <span className="font-mono text-xs text-gray-500">{stamp(h.createdAt)}</span>
                    <span className="font-medium text-gray-900">{auditActionLabel(h.action)}</span>
                    <span className="text-gray-600">{h.actorKind === "admin" ? `${h.actorName ?? "Staff"} (team)` : h.actorKind === "system" ? "Automatic" : (h.actorName ?? "Former member")}</span>
                    {auditDetailLine(h.detail) ? <span className="w-full text-xs text-gray-500">{auditDetailLine(h.detail)}</span> : null}
                  </div>
                ))
              )}
            </Panel>
          </Section>
        </div>

        <div className="flex flex-col gap-3" data-surface="business" data-theme="light">
          {(a.placements as AdPlacement[]).map((p) => (
            <AdPreview
              key={p}
              placement={p}
              ad={{
                businessName: a.business.name,
                logoUrl: a.business.logoUrl,
                verified: a.business.verified,
                headline: a.headline,
                caption: a.caption,
                cta: a.cta,
                media,
                promoted: a.promoted?.title ? { title: a.promoted.title, image: null } : null,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
