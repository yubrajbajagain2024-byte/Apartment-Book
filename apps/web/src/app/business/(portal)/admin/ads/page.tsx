import type { Metadata } from "next";
import { AlertTriangle, Flag, Megaphone } from "lucide-react";
import { AD_OBJECTIVES, AD_PLACEMENTS, adCtaLabel, adminListAds, businessCategoryLabel, formatCents, listUniversities, mediaItems, type AdminAdRow, type AdPlacement } from "@apartment-book/shared";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, formatDate } from "@/lib/utils";
import { AdPreview } from "@/components/business/ad-preview";
import { AdReviewActions } from "@/components/business/ad-review-actions";
import { PortalLink } from "@/components/business/portal-base";
import { AdStatusPill, EmptyPanel, Notice, PageHeader, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Review ads" };

const FILTERS = [
  { value: "pending_review", label: "In review" },
  { value: "active", label: "Running" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "all", label: "All" },
] as const;

/**
 * Every ad that wants to run, oldest submission first: the creative as students would see it, who it is for, the money,
 * the Fair Housing screen's flags and students' open reports; approve with the payment, reject or pause with a reason.
 */
export default async function AdminAdsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [, params] = await Promise.all([requireAdmin("/admin/ads"), searchParams]);
  const filter = FILTERS.find((f) => f.value === firstParam(params.status)) ?? FILTERS[0];
  const supabase = await createClient();
  const [ads, universities] = await Promise.all([adminListAds(supabase, filter.value === "all" ? null : filter.value), listUniversities(supabase).catch(() => [])]);
  const names = new Map(universities.map((u) => [u.id, u.name]));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ads" subtitle="Approve an ad once its content is right and its payment has arrived: approving records the payment, and only paid ads ever show as Sponsored." />
      <nav aria-label="Filter" className="flex gap-1 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <PortalLink
            key={f.value}
            href={f.value === "pending_review" ? "/admin/ads" : `/admin/ads?status=${f.value}`}
            aria-current={f.value === filter.value ? "page" : undefined}
            className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors", f.value === filter.value ? "bg-biz-ink text-biz-surface" : "text-biz-ink-3 hover:text-biz-ink")}
          >
            {f.label}
          </PortalLink>
        ))}
      </nav>
      {ads.length === 0 ? (
        <EmptyPanel icon={Megaphone} title="Nothing here" description={filter.value === "pending_review" ? "No ad is waiting for review." : "No ads with this status."} />
      ) : (
        ads.map((ad) => <ReviewCard key={ad.id} ad={ad} campusNames={names} />)
      )}
    </div>
  );
}

function ReviewCard({ ad, campusNames }: { ad: AdminAdRow; campusNames: Map<string, string> }) {
  const placements = ad.placements as AdPlacement[];
  const campuses = ad.university_ids.length ? ad.university_ids.map((id) => campusNames.get(id) ?? "Campus").join(", ") : "Every campus (a v1 promotion)";
  return (
    <Panel className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="review-ad">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-biz-ink">{ad.name}</h2>
          <AdStatusPill ad={ad} />
          {ad.vertical === "housing" ? <Pill tone="accent">Housing</Pill> : null}
          {ad.open_reports ? (
            <Pill tone="danger">
              <Flag className="h-3 w-3" /> {ad.open_reports} open {ad.open_reports === 1 ? "report" : "reports"}
            </Pill>
          ) : null}
        </div>
        <p className="text-[15px] text-biz-ink-2">
          <span className="font-semibold text-biz-ink">{ad.business_name}</span> · {businessCategoryLabel(ad.business_category)}
          {ad.business_status !== "approved" ? <span className="text-biz-danger"> · business {ad.business_status}</span> : null}
        </p>
        {ad.needs_review_reason ? <Notice tone="warning" title="Flagged by the migration">{ad.needs_review_reason}</Notice> : null}
        {ad.fair_housing_flags.length ? (
          <Notice tone="warning" title="Fair Housing screen">
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {ad.fair_housing_flags.join("; ")}
            </span>
          </Notice>
        ) : null}
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          {[
            ["Objective", AD_OBJECTIVES.find((o) => o.value === ad.objective)?.label ?? ad.objective],
            ["Placement", placements.map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label).join(", ")],
            ["Campuses", campuses],
            ["Dates", ad.starts_at ? `${formatDate(ad.starts_at)} to ${ad.ends_at ? formatDate(ad.ends_at) : "no end date"}` : "No dates"],
            ["Budget", formatCents(ad.budget_cents, ad.currency)],
            ["Paid", ad.paid_cents ? `${formatCents(ad.paid_cents, ad.currency)} · ${ad.payment_reference}` : "Nothing recorded yet"],
            ["Button", `${adCtaLabel(ad.cta)}${ad.cta_url ? ` → ${ad.cta_url}` : ""}`],
            ["Promotes", ad.promoted_title ?? "Nothing"],
            ["Submitted", ad.submitted_at ? formatDate(ad.submitted_at) : "—"],
            ...(ad.status_reason ? [["Reason on record", ad.status_reason]] : []),
            ...(ad.review_note ? [["Review note", ad.review_note]] : []),
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-biz-ink-4">{label}</dt>
              <dd className="mt-0.5 break-words text-biz-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <AdReviewActions adId={ad.id} status={ad.status} pausedBy={ad.paused_by} housing={ad.vertical === "housing"} flagged={ad.fair_housing_flags.length > 0} budgetCents={ad.budget_cents} />
      </div>
      <div className="flex flex-col gap-4">
        {placements.map((p) => (
          <AdPreview
            key={p}
            placement={p}
            ad={{
              businessName: ad.business_name,
              logoUrl: ad.business_logo_url,
              verified: false,
              headline: ad.headline,
              caption: ad.caption,
              cta: ad.cta,
              media: mediaItems(ad.media),
              promoted: ad.promoted_title ? { title: ad.promoted_title, image: null } : null,
            }}
          />
        ))}
      </div>
    </Panel>
  );
}
