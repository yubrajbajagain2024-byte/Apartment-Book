import { BadgeCheck, Building2, Eye, Inbox, Megaphone, MousePointerClick, Plus, Store, UserPlus, Users } from "lucide-react";
import { businessCategoryLabel, clickRate, teamRoleAllows, type Ad, type Business, type BusinessAnalyticsOverview, type BusinessTeamRole, type ConversationSummary } from "@apartment-book/shared";
import { timeAgo } from "@/lib/utils";
import { ConversationAvatar } from "@/components/messages/conversation-list";
import { CopyLink } from "./copy-link";
import { PortalLink } from "./portal-base";
import { AdStatusPill, BizLink, Panel, PanelHeader, Pill, StatTile } from "./ui";

/** What a complete profile has; a pending business is nudged to finish it (the UniBuzz team reviews it). */
function missingFromProfile(b: Business): string[] {
  const out: string[] = [];
  if (!b.logo_url) out.push("a logo");
  if (!b.description || b.description.length < 40) out.push("a description");
  if (!b.website) out.push("a website");
  if (!b.address && !b.city) out.push("where you are");
  if (!b.university_ids.length) out.push("the campuses you serve");
  return out;
}

/** The portal's front page: the business, its last 30 days, its campaigns, the newest inquiries and what to do next. */
export function DashboardView({
  firstName,
  business,
  role,
  overview,
  ads,
  inbox,
  canReply,
  publicProfileUrl,
}: {
  firstName: string;
  business: Business;
  role: BusinessTeamRole;
  overview: BusinessAnalyticsOverview | null;
  ads: Ad[];
  /** The newest inquiries, already titled after the students (businessInboxView). */
  inbox: ConversationSummary[];
  canReply: boolean;
  publicProfileUrl: string | null;
}) {
  const approved = business.status === "approved";
  const publish = teamRoleAllows(role, "publish");
  const missing = teamRoleAllows(role, "edit_profile") ? missingFromProfile(business) : [];
  const fmt = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-8">
      <header className="ab-fade-in flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-biz-ink-3">Good to see you, {firstName}</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[32px] font-semibold tracking-[-0.025em] text-biz-ink">
            {business.name}
            <Pill tone="neutral">Business</Pill>
            {approved && business.verified_partner ? (
              <Pill tone="accent">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified Partner
              </Pill>
            ) : null}
          </h1>
          <p className="mt-1 text-[15px] text-biz-ink-3">{businessCategoryLabel(business.category)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {publish ? (
            <BizLink href="/ads/new">
              <Megaphone className="h-4 w-4" /> New ad
            </BizLink>
          ) : null}
          {publish ? (
            <BizLink href="/deals/new" variant="secondary">
              <Plus className="h-4 w-4" /> New post
            </BizLink>
          ) : null}
          {approved && publish && business.category === "housing" ? (
            <BizLink href="/listings/new" variant="secondary">
              <Building2 className="h-4 w-4" /> Post a listing
            </BizLink>
          ) : null}
          {teamRoleAllows(role, "manage_team") ? (
            <BizLink href="/team" variant="ghost">
              <UserPlus className="h-4 w-4" /> Invite
            </BizLink>
          ) : null}
        </div>
      </header>

      {missing.length ? (
        <Panel className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-[17px] font-semibold text-biz-ink">Finish your profile</h2>
            <p className="mt-0.5 text-[15px] text-biz-ink-3">Add {missing.join(", ")}. Students and the UniBuzz team read it first.</p>
          </div>
          <BizLink href="/profile" variant="secondary">
            <Store className="h-4 w-4" /> Edit profile
          </BizLink>
        </Panel>
      ) : null}

      <section aria-labelledby="last-30" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="last-30" className="text-[17px] font-semibold text-biz-ink">
            Last 30 days
          </h2>
          <PortalLink href="/analytics" className="text-[13px] font-medium text-biz-accent-ink hover:underline">
            All analytics
          </PortalLink>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="overview">
          <StatTile icon={Eye} label="Impressions" value={fmt(overview?.impressions)} sub={`${fmt(overview?.reach)} students reached`} href="/analytics" />
          <StatTile icon={MousePointerClick} label="Clicks" value={fmt(overview?.clicks)} sub={`${clickRate(overview?.clicks ?? 0, overview?.impressions ?? 0)} of impressions`} href="/analytics" />
          <StatTile icon={Users} label="Profile visits" value={fmt(overview?.profile_visits)} href="/analytics" />
          <StatTile icon={Inbox} label="Inquiries" value={fmt(overview?.inquiries)} href={canReply ? "/inbox" : "/analytics"} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="pb-2">
          <PanelHeader
            title="Campaigns"
            subtitle="Your newest ads and where each stands."
            action={
              <PortalLink href="/ads" className="text-[13px] font-medium text-biz-accent-ink hover:underline">
                All ads
              </PortalLink>
            }
          />
          {ads.length === 0 ? (
            <p className="px-6 py-8 text-[15px] text-biz-ink-3">
              No ads yet. {publish ? "Start one: pick your campuses, a budget and dates, and see it as students will before you submit." : null}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-biz-line">
              {ads.map((a) => (
                <li key={a.id}>
                  <PortalLink href={`/ads/${a.id}`} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-biz-surface-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-biz-ink">{a.name}</span>
                    <AdStatusPill ad={a} />
                  </PortalLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="pb-2">
          <PanelHeader
            title="Recent inquiries"
            subtitle="Students write first; anyone who replies on your team can answer."
            action={
              canReply ? (
                <PortalLink href="/inbox" className="text-[13px] font-medium text-biz-accent-ink hover:underline">
                  Open inbox
                </PortalLink>
              ) : undefined
            }
          />
          {!canReply ? (
            <p className="px-6 py-8 text-[15px] text-biz-ink-3">
              {approved ? "Your role reads the numbers, not students' messages." : "Inquiries start once your business is approved and something of it is live."}
            </p>
          ) : inbox.length === 0 ? (
            <p className="px-6 py-8 text-[15px] text-biz-ink-3">No inquiries yet. Students message you from your profile, posts, listings and ads.</p>
          ) : (
            <ul className="mt-3 divide-y divide-biz-line">
              {inbox.map((c) => (
                <li key={c.id}>
                  <PortalLink href={`/inbox/${c.id}`} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-biz-surface-2">
                    <ConversationAvatar conversation={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={c.unreadCount > 0 ? "truncate text-[15px] font-semibold text-biz-ink" : "truncate text-[15px] font-medium text-biz-ink-2"}>{c.title}</span>
                        <span className="shrink-0 text-[11px] text-biz-ink-4" suppressHydrationWarning>
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="block truncate text-[13px] text-biz-ink-3">{c.lastMessagePreview ?? "New inquiry"}</span>
                    </span>
                    {c.unreadCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-biz-accent px-1.5 text-[10px] font-bold text-white">{c.unreadCount}</span> : null}
                  </PortalLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {publicProfileUrl ? (
        <Panel className="flex flex-wrap items-center justify-between gap-4 p-6">
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold text-biz-ink">Your public profile</span>
            <span className="mt-0.5 block break-all text-[15px] text-biz-ink-3">{publicProfileUrl}</span>
            <span className="mt-0.5 block text-[13px] text-biz-ink-4">Share it with students. Signed in as a business you are sent to the portal; open it signed out to look.</span>
          </span>
          <CopyLink url={publicProfileUrl} />
        </Panel>
      ) : null}
    </div>
  );
}
