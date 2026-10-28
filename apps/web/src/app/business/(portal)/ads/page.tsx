import type { Metadata } from "next";
import { Megaphone, Plus } from "lucide-react";
import { AD_PLACEMENTS, adDisplayStatus, clickRate, formatCents, getAdStats, listAds, mediaCover, mediaItems, teamRoleAllows, type Ad } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, firstParam, formatDate } from "@/lib/utils";
import { PortalLink } from "@/components/business/portal-base";
import { AdStatusPill, BizLink, EmptyPanel, PageHeader, Panel } from "@/components/business/ui";

export const metadata: Metadata = { title: "Ads" };

const FILTERS = [
  { value: "all", label: "All", statuses: null },
  { value: "running", label: "Running", statuses: ["active", "scheduled"] },
  { value: "review", label: "In review", statuses: ["pending_review"] },
  { value: "drafts", label: "Drafts", statuses: ["draft", "rejected"] },
  { value: "paused", label: "Paused", statuses: ["paused"] },
  { value: "completed", label: "Completed", statuses: ["completed"] },
] as const;

/** The Ads Manager's list: every ad with its status as it stands now and its numbers so far. */
export default async function AdsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ membership }, params] = await Promise.all([requireBusiness("/ads"), searchParams]);
  const business = membership.business;
  const supabase = await createClient();
  const [ads, stats] = await Promise.all([listAds(supabase, business.id), getAdStats(supabase, business.id).catch(() => [])]);
  const byId = new Map(stats.map((s) => [s.ad_id, s]));
  const filter = FILTERS.find((f) => f.value === firstParam(params.status)) ?? FILTERS[0];
  const shown = filter.statuses ? ads.filter((a) => (filter.statuses as readonly string[]).includes(adDisplayStatus(a))) : ads;
  const canPublish = teamRoleAllows(membership.role, "publish");
  const newAd = canPublish ? (
    <BizLink href="/ads/new" data-testid="new-ad">
      <Plus className="h-4 w-4" /> New ad
    </BizLink>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Ads"
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
          <nav aria-label="Filter ads" className="-mb-2 flex gap-1 overflow-x-auto no-scrollbar">
            {FILTERS.map((f) => {
              const count = f.statuses ? ads.filter((a) => (f.statuses as readonly string[]).includes(adDisplayStatus(a))).length : ads.length;
              const active = f.value === filter.value;
              return (
                <PortalLink
                  key={f.value}
                  href={f.value === "all" ? "/ads" : `/ads?status=${f.value}`}
                  aria-current={active ? "page" : undefined}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors", active ? "bg-biz-ink text-biz-surface" : "bg-biz-surface text-biz-ink-2 ring-1 ring-biz-line hover:text-biz-ink")}
                >
                  {f.label} <span className={cn("tabular-nums", active ? "opacity-70" : "text-biz-ink-4")}>{count}</span>
                </PortalLink>
              );
            })}
          </nav>
          {shown.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-biz-ink-3">Nothing here.</p>
          ) : (
            <Panel className="divide-y divide-biz-line overflow-hidden">
              {shown.map((ad) => (
                <AdRow key={ad.id} ad={ad} stats={byId.get(ad.id) ?? null} />
              ))}
            </Panel>
          )}
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
          <img src={thumb} alt="" className="h-full w-full object-cover" />
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
