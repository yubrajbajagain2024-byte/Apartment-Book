import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import {
  AD_OBJECTIVES,
  AD_PLACEMENTS,
  adCtaLabel,
  adDisplayStatus,
  adIsEditable,
  clickRate,
  formatCents,
  formatPrice,
  getAd,
  getAdProblems,
  getAdStats,
  getDailyStats,
  listUniversities,
  mediaItems,
  photosFor,
  type AdPlacement,
} from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { firstParam, formatDate } from "@/lib/utils";
import { AdActions } from "@/components/business/ad-actions";
import { AdPreview, type PreviewAd } from "@/components/business/ad-preview";
import { TrendChart } from "@/components/business/trend-chart";
import { AdStatusPill, Notice, PageHeader, Panel, PanelHeader, StatTile } from "@/components/business/ui";

export const metadata: Metadata = { title: "Ad" };

/** One ad: where it stands, what still stops it, what students did with it, and what they see. */
export default async function AdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireBusiness(`/ads/${id}`);
  const supabase = await createClient();
  const ad = await getAd(supabase, id);
  if (!ad || ad.business_id !== membership.business.id) notFound();
  const status = adDisplayStatus(ad);
  const [problems, stats, daily, universities, promoted, payment] = await Promise.all([
    adIsEditable(ad) ? getAdProblems(supabase, id).catch(() => []) : Promise.resolve([]),
    getAdStats(supabase, ad.business_id).then((rows) => rows.find((r) => r.ad_id === id) ?? null).catch(() => null),
    getDailyStats(supabase, ad.business_id, { days: 30, adId: id }).catch(() => []),
    listUniversities(supabase).catch(() => []),
    ad.promoted_apartment_id
      ? supabase.from("apartments").select("title, images, image_meta, price_per_month, currency").eq("id", ad.promoted_apartment_id).maybeSingle().then(({ data }) =>
          data ? { title: data.title, image: photosFor(data.images, data.image_meta)[0]?.url ?? null, price: `${formatPrice(data.price_per_month, data.currency)}/mo` } : null,
        )
      : ad.promoted_deal_id
        ? supabase.from("deals").select("title, image_url").eq("id", ad.promoted_deal_id).maybeSingle().then(({ data }) => (data ? { title: data.title, image: data.image_url, price: null } : null))
        : Promise.resolve(null),
    supabase.from("listing_promotions").select("amount_cents, currency, payment_reference, status").eq("ad_id", id).eq("status", "active").maybeSingle().then(({ data }) => data),
  ]);
  const campusNames = ad.university_ids.length ? universities.filter((u) => ad.university_ids.includes(u.id)).map((u) => u.name) : ["Every campus"];
  const business = membership.business;
  const preview: PreviewAd = {
    businessName: business.name,
    logoUrl: business.logo_url,
    verified: business.verified_partner,
    headline: ad.headline,
    caption: ad.caption,
    cta: ad.cta,
    media: mediaItems(ad.media),
    promoted,
  };
  const placements = ad.placements as AdPlacement[];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Ads Manager"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {ad.name} <AdStatusPill ad={ad} />
          </span>
        }
        subtitle={`${placements.map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label).join(" · ")}${ad.starts_at && ad.ends_at ? ` · ${formatDate(ad.starts_at)} to ${formatDate(ad.ends_at)}` : ""}`}
      />

      <div className="flex flex-col gap-3">
        {firstParam(query.saved) ? <Notice tone="success" title="Draft saved." /> : null}
        {status === "rejected" && ad.status_reason ? <Notice tone="danger" title="Not approved">{ad.status_reason}</Notice> : null}
        {status === "paused" && ad.paused_by === "admin" ? <Notice tone="warning" title="Paused by the UniBuzz team">{ad.status_reason ?? "Write to the UniBuzz team to resume it."}</Notice> : null}
        {status === "draft" && ad.status_reason ? <Notice tone="warning">{ad.status_reason}</Notice> : null}
        {status === "pending_review" ? (
          <Notice tone="accent" title="With the UniBuzz team">
            They check every ad before it runs and send an invoice for its budget. It starts on its start date once approved and paid; you will be told here and under the bell.
          </Notice>
        ) : null}
        {ad.vertical === "housing" && ad.fair_housing_flags.length ? (
          <Notice tone="warning" title="Fair Housing: words to change">
            <ul className="mt-1 list-disc pl-5">
              {ad.fair_housing_flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {adIsEditable(ad) ? (
            <Panel className="p-6" data-testid="ad-checklist">
              <h2 className="flex items-center gap-2 text-[17px] font-semibold text-biz-ink">
                {problems.length ? <AlertTriangle className="h-5 w-5 text-biz-warning" /> : <CheckCircle2 className="h-5 w-5 text-biz-success" />}
                {problems.length ? "Before you submit" : "Ready to submit"}
              </h2>
              {problems.length ? (
                <ul className="mt-3 flex flex-col gap-1.5 text-[15px] text-biz-ink-2">
                  {problems.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-biz-warning" /> {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[15px] text-biz-ink-3">Everything the UniBuzz team needs is here. Submitting sends it for review; nothing runs before it is approved and paid.</p>
              )}
            </Panel>
          ) : null}

          <AdActions ad={ad} role={membership.role} ready={problems.length === 0} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Impressions" value={(stats?.impressions ?? 0).toLocaleString("en-US")} />
            <StatTile label="Reach" value={(stats?.reach ?? 0).toLocaleString("en-US")} sub="Students who saw it" />
            <StatTile label="Clicks" value={(stats?.clicks ?? 0).toLocaleString("en-US")} sub={`${clickRate(stats?.clicks ?? 0, stats?.impressions ?? 0)} of impressions`} />
            <StatTile label="Saves" value={(stats?.saves ?? 0).toLocaleString("en-US")} />
            <StatTile label="Profile visits" value={(stats?.profile_visits ?? 0).toLocaleString("en-US")} />
            <StatTile label="Inquiries" value={(stats?.inquiries ?? 0).toLocaleString("en-US")} />
          </div>

          <Panel className="pb-6">
            <PanelHeader title="Last 30 days" subtitle="Counted from what students actually did, once per person per hour or day. Never who." />
            <div className="px-6 pt-5">
              <TrendChart series={daily} label={ad.name} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Details" />
            <dl className="grid gap-x-6 gap-y-4 px-6 pb-6 pt-4 text-[15px] sm:grid-cols-2">
              <Detail label="Objective" value={AD_OBJECTIVES.find((o) => o.value === ad.objective)?.label ?? ad.objective} />
              <Detail label="Campuses" value={campusNames.join(", ")} />
              <Detail label="Button" value={`${adCtaLabel(ad.cta)}${ad.cta_url ? ` → ${ad.cta_url}` : ""}`} />
              <Detail label="Promotes" value={promoted?.title ?? "Nothing: it stands on its own"} />
              <Detail label="Budget" value={ad.budget_cents ? formatCents(ad.budget_cents, ad.currency) : "Not set"} />
              <Detail label="Payment" value={payment ? `${formatCents(payment.amount_cents, payment.currency)} recorded · ${payment.payment_reference}` : "Recorded by the UniBuzz team when approved"} />
              {ad.vertical === "housing" ? (
                <Detail label="Fair Housing" value={ad.fair_housing_checked_at ? `Checked ${formatDate(ad.fair_housing_checked_at)}` : "Checked by the UniBuzz team before it runs"} icon={Scale} />
              ) : null}
            </dl>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start" aria-label="What students see">
          {placements.map((p) => (
            <Panel key={p} className="p-5">
              <p className="mb-4 text-[13px] font-medium text-biz-ink-3">In {AD_PLACEMENTS.find((x) => x.value === p)?.label}</p>
              <AdPreview ad={preview} placement={p} />
            </Panel>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Scale }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[13px] text-biz-ink-3">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-biz-ink">{value}</dd>
    </div>
  );
}
