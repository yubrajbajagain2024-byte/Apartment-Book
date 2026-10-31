import type { Metadata } from "next";
import { Megaphone, Plus } from "lucide-react";
import { AD_PLACEMENTS, adDisplayStatus, clickRate, formatCents, getAdStats, listAds, mediaCover, mediaItems, teamRoleAllows, type Ad } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { FilteredList, FilterTabs } from "@/components/business/filter-tabs";
import { PortalLink } from "@/components/business/portal-base";
import { AdStatusPill, BizLink, EmptyPanel, PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Advertisements" };

const FILTERS = [
  { value: "all", label: "All", statuses: null },
  { value: "running", label: "Running", statuses: ["active", "scheduled"] },
  { value: "review", label: "In review", statuses: ["pending_review"] },
  { value: "drafts", label: "Drafts", statuses: ["draft", "rejected"] },
  { value: "paused", label: "Paused", statuses: ["paused"] },
  { value: "completed", label: "Completed", statuses: ["completed"] },
] as const;

const FILTER_VALUES = FILTERS.map((f) => f.value);

/** The filters an ad shows under: all, and the one for its status as it stands now. */
function filtersOf(ad: Ad): string[] {
  const status = adDisplayStatus(ad);
  return FILTERS.filter((f) => !f.statuses || (f.statuses as readonly string[]).includes(status)).map((f) => f.value);
}

/**
 * The Ads Manager's list: every ad with its status as it stands now and its numbers so far. The whole list is on the
 * page; the status filter (?status=) picks from it in the browser, so switching costs no request.
 */
export default async function AdsPage() {
  const { membership } = await requireBusiness("/ads");
  const business = membership.business;
  const supabase = await createClient();
  const [ads, stats] = await Promise.all([listAds(supabase, business.id), getAdStats(supabase, business.id).catch(() => [])]);
  const byId = new Map(stats.map((s) => [s.ad_id, s]));
  const rows = ads.map((ad) => ({ key: ad.id, filters: filtersOf(ad), node: <AdRow ad={ad} stats={byId.get(ad.id) ?? null} /> }));
  const canPublish = teamRoleAllows(membership.role, "publish");
  const newAd = canPublish ? (
    <BizLink href="/ads/new" data-testid="new-ad">
      <Plus className="h-4 w-4" /> New ad
    </BizLink>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Advertisements"
        subtitle="Sponsored posts for students at the campuses you choose. Each runs from its start date once approved, and stops by itself on its end date."
        actions={newAd}
      />
      {ads.length === 0 ? (
        <EmptyPanel
          icon={Megaphone}
          title="No ads yet"
          description="An ad looks like a post, labelled Sponsored, in For You or Reels (or in Housing, for housing). Choose your campuses, a budget and dates; the UniBuzz team reviews it before it runs."
          action={newAd}
        />
      ) : (
        <>
          <FilterTabs
            label="Filter ads"
            param="status"
            path="/ads"
            fallback="all"
            options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: rows.filter((r) => r.filters.includes(f.value)).length }))}
          />
          <FilteredList param="status" values={FILTER_VALUES} fallback="all" rows={rows} emptyText="Nothing here." className="divide-y divide-biz-line overflow-hidden" />
        </>
      )}
    </div>
  );
}

function AdRow({ ad, stats }: { ad: Ad; stats: { impressions: number; reach: number; clicks: number } | null }) {
  const thumb = mediaCover(mediaItems(ad.media));
  return (
    <PortalLink href={`/ads/${ad.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-biz-surface-2" data-testid="ad-row">
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-biz-surface-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- the business's own upload or the provider's poster
          <img src={thumb} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Megaphone className="absolute inset-0 m-auto h-5 w-5 text-biz-ink-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-biz-ink">{ad.name}</span>
          <AdStatusPill ad={ad} />
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-biz-ink-3">
          {ad.placements.map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label ?? p).join(" · ")}
          {ad.starts_at && ad.ends_at ? ` · ${formatDate(ad.starts_at)} – ${formatDate(ad.ends_at)}` : " · No dates yet"}
          {ad.budget_cents ? ` · ${formatCents(ad.budget_cents, ad.currency)}` : ""}
        </span>
      </span>
      <span className="hidden shrink-0 grid-cols-3 gap-6 text-right sm:grid">
        <Metric label="Impressions" value={stats?.impressions ?? 0} />
        <Metric label="Reach" value={stats?.reach ?? 0} />
        <Metric label="CTR" value={clickRate(stats?.clicks ?? 0, stats?.impressions ?? 0)} />
      </span>
    </PortalLink>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[15px] font-semibold tabular-nums text-biz-ink">{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
      <span className="text-[11px] text-biz-ink-4">{label}</span>
    </span>
  );
}
