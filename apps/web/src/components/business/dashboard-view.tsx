import { Building2, Eye, Inbox, Plus, Tag, UserPlus, Users } from "lucide-react";
import { type Business, type BusinessOverview, type ConversationSummary } from "@apartment-book/shared";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConversationAvatar } from "@/components/messages/conversation-list";
import { PortalLink } from "./portal-base";

/** The portal's front page: who you are, the business's headline numbers, the newest inquiries and the next steps. */
export function DashboardView({
  firstName,
  business,
  role,
  overview,
  teamSize,
  inbox,
}: {
  firstName: string;
  business: Business;
  role: "owner" | "staff";
  overview: BusinessOverview | null;
  teamSize: number;
  /** The newest inquiries, already titled after the students (businessInboxView). */
  inbox: ConversationSummary[];
}) {
  const approved = business.status === "approved";
  const stats = [
    { label: "Active listings", value: overview?.active_listings ?? 0, icon: Building2, href: "/listings" },
    { label: "Live deals", value: overview?.active_deals ?? 0, icon: Tag, href: "/deals" },
    { label: "Views, 30 days", value: overview?.views_30d ?? 0, icon: Eye, href: "/listings" },
    { label: "Inquiries, 30 days", value: overview?.inquiries_30d ?? 0, icon: Inbox, href: "/inbox" },
    { label: "Team", value: overview?.team ?? teamSize, icon: Users, href: "/team" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hi {firstName}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            {business.name}
            {approved && business.verified_partner ? <Badge tone="green">Verified Partner</Badge> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approved ? (
            <PortalLink href="/listings/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 bg-aurora px-4 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Post a listing
            </PortalLink>
          ) : null}
          <PortalLink href="/deals/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-300">
            <Tag className="h-4 w-4" /> Add a deal
          </PortalLink>
          {role === "owner" ? (
            <PortalLink href="/team" className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-300">
              <UserPlus className="h-4 w-4" /> Invite a teammate
            </PortalLink>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="overview">
        {stats.map((s) => (
          <PortalLink key={s.label} href={s.href} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200 transition-shadow hover:shadow-md">
            <span className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <s.icon className="h-4 w-4 text-brand-600" /> {s.label}
            </span>
            <span className="mt-1 block text-2xl font-bold text-gray-900">{s.value}</span>
          </PortalLink>
        ))}
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Recent inquiries</CardTitle>
          <PortalLink href="/inbox" className="text-sm font-medium text-brand-600 hover:underline">
            Open inbox
          </PortalLink>
        </CardHeader>
        <CardBody>
          {inbox.length === 0 ? (
            <p className="text-sm text-gray-600">
              {approved ? "No inquiries yet. Students message you from your listings and deals; every reply lands here." : "Inquiries start once your business is approved and a listing or deal is live."}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {inbox.map((c) => (
                <li key={c.id}>
                  <PortalLink href={`/inbox/${c.id}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50">
                    <ConversationAvatar conversation={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={c.unreadCount > 0 ? "truncate text-sm font-bold text-gray-900" : "truncate text-sm font-semibold text-gray-800"}>{c.title}</span>
                        <span className="shrink-0 text-[11px] text-gray-500" suppressHydrationWarning>
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-gray-500">{c.lastMessagePreview ?? "New inquiry"}</span>
                    </span>
                    {c.unreadCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{c.unreadCount}</span> : null}
                  </PortalLink>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
