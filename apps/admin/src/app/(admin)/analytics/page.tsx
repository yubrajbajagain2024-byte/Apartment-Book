import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Database } from "lucide-react";
import { AD_PLACEMENTS, businessCategoryLabel, changeRatio, clickRate, formatCents, listUniversities } from "@apartment-book/shared";
import { percent, plural } from "@/lib/console/format";
import type { AdsAnalytics, AnalyticsOverview, RevenueAnalytics } from "@/lib/console/ops-types";
import {
  fetchAdsAnalytics, fetchAnalyticsOverview, fetchRevenueAnalytics, hasBusinessRole, maybeDeployed, requireConsoleAdmin,
} from "@/lib/console/server";
import { cn, firstParam } from "@/lib/utils";
import { BarList } from "@/components/console/bar-list";
import { ConsoleChart } from "@/components/console/console-chart";
import { CsvButton } from "@/components/console/csv-button";
import { LiveRefresh } from "@/components/console/live-refresh";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyBox, KeyValue, Panel, Section, StatTile } from "@/components/console/parts";
import { buttonClasses } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export const metadata: Metadata = { title: "Analytics" };

const VIEWS = [
  { value: "overview", label: "Platform" },
  { value: "ads", label: "Ads" },
  { value: "revenue", label: "Revenue" },
] as const;
const RANGES = [7, 30, 90, 365] as const;
type View = (typeof VIEWS)[number]["value"];
type Params = Promise<{ [key: string]: string | string[] | undefined }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placementLabel = (p: string) => AD_PLACEMENTS.find((x) => x.value === p)?.label ?? (p === "listing" ? "Listing (v1)" : p === "post" ? "Post (v1)" : p === "profile" ? "Profile" : p === "deals" ? "Deals page" : "Other");
const money = (c: number) => formatCents(c, "USD");
const count = (n: number) => n.toLocaleString("en-US");

/** "↑ 12% vs the previous 30 days", in words and an arrow (never color alone); nothing when there is nothing to compare. */
function Delta({ current, previous, days, upIsGood = true }: { current: number; previous: number; days: number; upIsGood?: boolean }) {
  const r = changeRatio(current, previous);
  if (r === null) return <span className="text-xs text-gray-500">no earlier {days} days to compare</span>;
  const up = r >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", r === 0 ? "text-gray-600" : good ? "text-green-700" : "text-red-700")}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "up" : "down"} {percent(Math.abs(r))} <span className="font-normal text-gray-500">vs the previous {days} days</span>
    </span>
  );
}

/**
 * Analytics for the UniBuzz team (admins of the staff): the platform's growth, active and engaged students and what
 * they do; ad delivery and the review queue; and revenue from recorded payments. Numbers only, from the database, as
 * they stand now ("Live" asks again every 30 seconds). Days are Central time.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Params }) {
  const me = await requireConsoleAdmin("/analytics");
  const params = await searchParams;
  const view = (VIEWS.find((v) => v.value === firstParam(params.view))?.value ?? "overview") as View;
  const days = RANGES.find((r) => String(r) === firstParam(params.range)) ?? 30;
  const rawCampus = firstParam(params.campus) ?? "";
  const campus = view !== "revenue" && UUID.test(rawCampus) ? rawCampus : null;
  const [universities, businessRole] = await Promise.all([
    view === "revenue" ? Promise.resolve([]) : listUniversities(me.supabase).catch(() => []),
    hasBusinessRole(),
  ]);
  const data =
    view === "overview" ? await maybeDeployed(fetchAnalyticsOverview(days, campus))
    : view === "ads" ? await maybeDeployed(fetchAdsAnalytics(days, campus))
    : await maybeDeployed(fetchRevenueAnalytics(days));

  const href = (next: Partial<{ view: View; range: number; campus: string | null }>) => {
    const merged = { view, range: days, campus, ...next };
    const sp = new URLSearchParams();
    if (merged.view !== "overview") sp.set("view", merged.view);
    if (merged.range !== 30) sp.set("range", String(merged.range));
    if (merged.campus && merged.view !== "revenue") sp.set("campus", merged.campus);
    const s = sp.toString();
    return s ? `/analytics?${s}` : "/analytics";
  };

  return (
    <div className="flex flex-col gap-5" data-testid="console-analytics">
      <PageHeader title="Analytics" description="Students, engagement, ads and revenue, from the database as it stands now. Numbers only: nothing here says who did what." />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Report" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-200/70 p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={href({ view: v.value })}
              prefetch={false}
              aria-current={v.value === view ? "page" : undefined}
              className={cn("flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium", v.value === view ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Date range" className="flex gap-1 rounded-xl bg-gray-200/70 p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={href({ range: r })}
              prefetch={false}
              aria-current={r === days ? "page" : undefined}
              className={cn("flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium tabular-nums", r === days ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
            >
              {r === 365 ? "1 year" : `${r} days`}
            </Link>
          ))}
        </nav>
        {view !== "revenue" && universities.length ? (
          <form method="get" action="/analytics" className="flex items-center gap-1.5">
            {view !== "overview" ? <input type="hidden" name="view" value={view} /> : null}
            {days !== 30 ? <input type="hidden" name="range" value={days} /> : null}
            <label className="sr-only" htmlFor="campus">
              Campus
            </label>
            <Select id="campus" name="campus" defaultValue={campus ?? ""} className="h-9 max-w-56 text-sm">
              <option value="">Every campus</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
              Apply
            </button>
          </form>
        ) : null}
        {data ? (
          <span className="ml-auto">
            <LiveRefresh generatedAt={data.generatedAt} />
          </span>
        ) : null}
      </div>

      {!data ? (
        <EmptyBox
          icon={Database}
          title="Analytics needs migration 59"
          description="This database does not have the Analytics functions yet (20261112000000_console_business.sql). They arrive with the next database release; nothing here works without them."
        />
      ) : view === "overview" ? (
        <Overview a={data as AnalyticsOverview} />
      ) : view === "ads" ? (
        <Ads a={data as AdsAnalytics} linkAds={businessRole} />
      ) : (
        <Revenue a={data as RevenueAnalytics} linkBusinesses={businessRole} />
      )}
    </div>
  );
}

function Scope({ a, children }: { a: { range: { days: number; from: string; to: string }; campus?: { name: string } | null }; children?: ReactNode }) {
  return (
    <p className="text-xs text-gray-500">
      {a.campus ? `${a.campus.name} · ` : ""}
      {a.range.from} to {a.range.to}, Central time. {children}
    </p>
  );
}

const ENGAGEMENT_ROWS: { key: keyof AnalyticsOverview["engagement"]["totals"]; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "reels", label: "Reels" },
  { key: "comments", label: "Comments" },
  { key: "likes", label: "Likes" },
  { key: "messages", label: "Messages sent" },
  { key: "follows", label: "Follows" },
  { key: "buzzes", label: "Buzzes" },
  { key: "buzzReplies", label: "Buzz replies" },
  { key: "listings", label: "Housing listings" },
  { key: "items", label: "Marketplace items" },
];

function Overview({ a }: { a: AnalyticsOverview }) {
  const d = a.range.days;
  const e = a.engagement;
  return (
    <>
      <Scope a={a}>Students only: business accounts and the UniBuzz team are not counted.</Scope>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Students" value={count(a.totals.students)} hint={`${count(a.growth.signups)} joined in ${d} days`}>
          <Delta current={a.growth.signups} previous={a.growth.signupsPrev} days={d} />
        </StatTile>
        <StatTile label="Engaged students" value={count(a.engaged.inRange)} hint={`posted, commented, liked, messaged or followed in ${d} days`}>
          <Delta current={a.engaged.inRange} previous={a.engaged.inPrevRange} days={d} />
        </StatTile>
        <StatTile label="Active now" value={count(a.active.now.online15m)} hint={`in the last 15 minutes · ${count(a.lastHour.posts)} posts, ${count(a.lastHour.messages)} messages in the last hour`} />
        <StatTile label="Active today · 7 days · 30 days" value={`${count(a.active.now.dau)} · ${count(a.active.now.wau)} · ${count(a.active.now.mau)}`} hint="opened the app or the site (students who show their activity status)" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Growth" hint="sign-ups and students, by day">
          <Panel>
            <ConsoleChart
              label="Growth"
              series={a.growth.perDay}
              measures={[
                { key: "signups", label: "Sign-ups" },
                { key: "total", label: "Students", headline: "last" },
              ]}
            />
          </Panel>
        </Section>
        <Section title="Active students" hint={a.active.since ? `counted every 15 minutes since ${a.active.since}` : "counting starts once the migration is applied"}>
          <Panel>
            <ConsoleChart
              label="Active students"
              series={a.active.perDay}
              measures={[{ key: "dau", label: "Active students", headline: "last" }]}
              emptyText="No count yet for these days."
            />
            <p className="mt-2 text-xs text-gray-500">
              Only students who show their activity status leave a time to count, so these are lower bounds. Engaged students (above) are counted from what students wrote.
            </p>
          </Panel>
        </Section>
      </div>

      <Section
        title="Engagement"
        hint="what students wrote, by day"
        action={
          <CsvButton
            filename={`unibuzz-engagement-${a.range.from}-${a.range.to}.csv`}
            header={["day", "signups", "students", "engaged", "posts", "reels", "comments", "likes", "messages", "follows", "buzzes", "active"]}
            rows={e.perDay.map((x, i) => [x.day, a.growth.perDay[i]?.signups ?? null, a.growth.perDay[i]?.total ?? null, x.engaged, x.posts, x.reels, x.comments, x.likes, x.messages, x.follows, x.buzzes, a.active.perDay[i]?.dau ?? null])}
          />
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel>
            <ConsoleChart
              label="Engagement"
              series={e.perDay}
              measures={[
                { key: "engaged", label: "Engaged students", headline: a.engaged.inRange },
                { key: "posts", label: "Posts" },
                { key: "reels", label: "Reels" },
                { key: "comments", label: "Comments" },
                { key: "likes", label: "Likes" },
                { key: "messages", label: "Messages" },
                { key: "follows", label: "Follows" },
                { key: "buzzes", label: "Buzzes" },
              ]}
            />
          </Panel>
          <Panel className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Engagement in this range and the one before</caption>
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 text-right font-medium">{d} days</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ENGAGEMENT_ROWS.map((r) => {
                  const ch = changeRatio(e.totals[r.key] ?? 0, e.prev[r.key] ?? 0);
                  return (
                    <tr key={r.key}>
                      <td className="px-3 py-1.5 text-gray-700">{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">{count(e.totals[r.key] ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{ch === null ? "—" : `${ch >= 0 ? "+" : "−"}${percent(Math.abs(ch))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 pb-2 text-xs text-gray-500">Buzz is counted as posts only, never as people: it stays anonymous here too.</p>
          </Panel>
        </div>
      </Section>

      {a.campuses.length ? (
        <Section title="Campuses" hint="students who joined, by campus">
          <Panel className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Campus</th>
                  <th className="px-3 py-2 text-right font-medium">Students</th>
                  <th className="px-3 py-2 text-right font-medium">Joined in {d} days</th>
                  <th className="px-3 py-2 text-right font-medium">Active in 30 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {a.campuses.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-1.5">
                      <Link href={`/analytics?campus=${c.id}${d !== 30 ? `&range=${d}` : ""}`} prefetch={false} className="text-gray-900 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{count(c.students)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{count(c.signups)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{count(c.mau)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Section>
      ) : null}
    </>
  );
}

function Ads({ a, linkAds }: { a: AdsAnalytics; linkAds: boolean }) {
  const d = a.range.days;
  const t = a.totals;

  return (
    <>
      <Scope a={a}>Ad events only: students&apos; impressions (once an hour per ad), taps, saves and messages from an ad.</Scope>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Impressions" value={count(t.impressions)} hint={`${count(t.reach)} students reached`}>
          <Delta current={t.impressions} previous={a.prev.impressions} days={d} />
        </StatTile>
        <StatTile label="Clicks" value={count(t.clicks)} hint={`click rate ${clickRate(t.clicks, t.impressions)}${a.prev.impressions ? `, was ${clickRate(a.prev.clicks, a.prev.impressions)}` : ""}`}>
          <Delta current={t.clicks} previous={a.prev.clicks} days={d} />
        </StatTile>
        <StatTile label="Saves · messages" value={`${count(t.saves)} · ${count(t.inquiries)}`} hint="from ads" />
        <StatTile label="Business profile visits" value={count(t.profileVisits)} hint={`in ${d} days, from anywhere`}>
          <Delta current={t.profileVisits} previous={a.prev.profileVisits} days={d} />
        </StatTile>
      </div>

      <Section
        title="Delivery"
        hint="by day"
        action={<CsvButton filename={`unibuzz-ads-${a.range.from}-${a.range.to}.csv`} header={["day", "impressions", "reach", "clicks"]} rows={a.perDay.map((x) => [x.day, x.impressions, x.reach, x.clicks])} />}
      >
        <Panel>
          <ConsoleChart
            label="Ad delivery"
            series={a.perDay}
            measures={[
              { key: "impressions", label: "Impressions" },
              { key: "reach", label: "Students reached", headline: t.reach },
              { key: "clicks", label: "Clicks" },
            ]}
          />
        </Panel>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="By placement" hint="impressions, with the click rate">
          <Panel>
            <BarList
              rows={a.byPlacement.map((p) => {
                return { key: p.placement, label: placementLabel(p.placement), value: p.impressions, hint: `${count(p.clicks)} clicks · ${clickRate(p.clicks, p.impressions)}` };
              })}
              format={count}
              empty="No ad was seen in this range."
            />
          </Panel>
        </Section>
        <Section title="Campaigns and review">
          <Panel>
            <KeyValue
              rows={[
                { k: "Running", v: count(a.adsByStatus.active) },
                { k: "Scheduled", v: count(a.adsByStatus.scheduled) },
                { k: "In review", v: `${count(a.review.pending)}${a.review.oldestPendingAt ? `, oldest since ${new Date(a.review.oldestPendingAt).toISOString().slice(0, 10)}` : ""}` },
                { k: "Paused", v: count(a.adsByStatus.paused) },
                { k: "Ended · rejected", v: `${count(a.adsByStatus.completed)} · ${count(a.adsByStatus.rejected)}` },
                { k: "Drafts", v: count(a.adsByStatus.draft) },
                { k: `Decided in ${d} days`, v: `${plural(a.review.decided, "ad")}${a.review.medianHoursToDecision === null ? "" : `, median ${a.review.medianHoursToDecision} h from submission`}` },
              ]}
            />
          </Panel>
        </Section>
      </div>

      <Section
        title="Top campaigns"
        hint={`by impressions in ${d} days`}
        action={
          <CsvButton
            filename={`unibuzz-top-ads-${a.range.from}-${a.range.to}.csv`}
            header={["ad", "business", "status", "placements", "impressions", "reach", "clicks", "click rate", "paid (cents)", "currency"]}
            rows={a.topAds.map((x) => [x.name, x.businessName, x.status, x.placements.join(" "), x.impressions, x.reach, x.clicks, x.impressions ? x.clicks / x.impressions : null, x.paidCents, x.currency])}
          />
        }
      >
        {a.topAds.length === 0 ? (
          <p className="text-sm text-gray-500">No ad was seen in this range.</p>
        ) : (
          <Panel className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Business</th>
                  <th className="px-3 py-2 text-right font-medium">Impressions</th>
                  <th className="px-3 py-2 text-right font-medium">Reach</th>
                  <th className="px-3 py-2 text-right font-medium">Clicks</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {a.topAds.map((x) => {
                  return (
                    <tr key={x.id}>
                      <td className="px-3 py-1.5">
                        {linkAds ? (
                          <Link href={`/business/campaigns/${x.id}`} prefetch={false} className="font-medium text-gray-900 hover:underline">
                            {x.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-900">{x.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">{x.businessName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{count(x.impressions)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{count(x.reach)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{count(x.clicks)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{clickRate(x.clicks, x.impressions)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCents(x.paidCents, x.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>
    </>
  );
}

function Revenue({ a, linkBusinesses }: { a: RevenueAnalytics; linkBusinesses: boolean }) {
  const d = a.range.days;
  const t = a.totals;
  return (
    <>
      <Scope a={a}>
        Payments the team recorded (no payment provider yet), in US dollars. Booked: recorded in the range. Earned: each payment in force spread over the days it paid for.
      </Scope>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Booked" value={money(t.bookedCents)} hint={`${plural(t.payments, "payment")} from ${plural(t.advertisers, "business", "businesses")}`}>
          <Delta current={t.bookedCents} previous={a.prev.bookedCents} days={d} />
        </StatTile>
        <StatTile label="Earned" value={money(t.recognizedCents)} hint="delivered in this range">
          <Delta current={t.recognizedCents} previous={a.prev.recognizedCents} days={d} />
        </StatTile>
        <StatTile label="Net of voided" value={money(t.netCents)} hint={`${money(t.voidedCents)} voided in this range`}>
          <Delta current={t.netCents} previous={a.prev.netCents} days={d} />
        </StatTile>
        <StatTile label="Average payment" value={money(t.avgPaymentCents)} hint={`${plural(t.activeAdvertisers, "business", "businesses")} running ads now`} />
      </div>

      <Section
        title="By day"
        action={
          <CsvButton
            filename={`unibuzz-revenue-${a.range.from}-${a.range.to}.csv`}
            header={["day", "booked (cents)", "voided (cents)", "earned (cents)"]}
            rows={a.perDay.map((x) => [x.day, x.bookedCents, x.voidedCents, x.recognizedCents])}
          />
        }
      >
        <Panel>
          <ConsoleChart
            label="Revenue"
            series={a.perDay}
            measures={[
              { key: "recognizedCents", label: "Earned", format: "cents" },
              { key: "bookedCents", label: "Booked", format: "cents" },
              { key: "voidedCents", label: "Voided", format: "cents" },
            ]}
            emptyText="No payment in this range."
          />
        </Panel>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="By placement" hint="booked; an ad in two placements counts half in each">
          <Panel>
            <BarList rows={a.byPlacement.map((p) => ({ key: p.placement, label: placementLabel(p.placement), value: p.bookedCents }))} format={money} />
          </Panel>
        </Section>
        <Section title="By category" hint="booked">
          <Panel>
            <BarList rows={a.byCategory.map((c) => ({ key: c.category, label: c.category === "deleted" ? "Deleted businesses" : businessCategoryLabel(c.category), value: c.bookedCents }))} format={money} />
          </Panel>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Top advertisers" hint={`booked in ${d} days`}>
          <Panel>
            <BarList
              rows={a.topBusinesses.map((b) => ({
                key: b.id,
                label: linkBusinesses ? (
                  <Link href={`/business/advertisers/${b.id}`} prefetch={false} className="hover:underline">
                    {b.name}
                  </Link>
                ) : (
                  b.name
                ),
                value: b.bookedCents,
                hint: plural(b.payments, "payment"),
              }))}
              format={money}
            />
          </Panel>
        </Section>
        <Section title="Pipeline">
          <Panel>
            <KeyValue
              rows={[
                { k: "Ads in review", v: count(a.pipeline.pendingAds) },
                { k: "Their budgets", v: money(a.pipeline.pendingBudgetCents) },
                ...a.otherCurrencies.map((c) => ({ k: `Booked in ${c.currency}`, v: formatCents(c.bookedCents, c.currency) })),
              ]}
            />
            <p className="mt-2 text-xs text-gray-500">A budget is what a business means to spend; money counts once its payment is recorded at approval.</p>
          </Panel>
        </Section>
      </div>
    </>
  );
}
