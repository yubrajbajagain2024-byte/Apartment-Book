import type { Metadata } from "next";
import { Bell, Megaphone, ShieldCheck } from "lucide-react";
import { listPortalNotifications } from "@apartment-book/shared";
import { markPortalNotificationsReadAction } from "@/lib/actions/business";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { cn, timeAgo } from "@/lib/utils";
import { PortalLink } from "@/components/business/portal-base";
import { MarkSeen } from "@/components/business/mark-seen";
import { EmptyPanel, PageHeader, Panel } from "@/components/business/ui";

export const metadata: Metadata = { title: "Notifications" };

/** Reviews, roles and campaigns: what the UniBuzz team decided, and when ads started and ended. Opening it marks them seen. */
export default async function NotificationsPage() {
  await requireBusiness("/notifications", ["pending", "approved", "rejected"]);
  const items = await listPortalNotifications(await createClient()).catch(() => []);
  const unread = items.some((n) => !n.read_at);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {unread ? <MarkSeen action={markPortalNotificationsReadAction} /> : null}
      <PageHeader title="Notifications" subtitle="Reviews of your business and ads, changes to your role, and campaigns starting and ending." />
      {items.length === 0 ? (
        <EmptyPanel icon={Bell} title="Nothing yet" description="You will hear here when the UniBuzz team reviews your business or an ad, and when your ads start and end." />
      ) : (
        <Panel className="divide-y divide-biz-line overflow-hidden" data-testid="portal-notifications">
          {items.map((n) => {
            const Icon = n.type === "ad" ? Megaphone : ShieldCheck;
            const href = typeof n.link === "string" && n.link.startsWith("/") ? n.link : "/";
            return (
              <PortalLink key={n.id} href={href} className={cn("flex gap-4 px-6 py-4 transition-colors hover:bg-biz-surface-2", !n.read_at && "bg-biz-accent-soft/40")}>
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-biz-surface-3 text-biz-ink-2">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold text-biz-ink">{n.title}</span>
                    <span className="shrink-0 text-xs text-biz-ink-4" suppressHydrationWarning>
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                  {n.body ? <span className="mt-0.5 block text-[15px] leading-relaxed text-biz-ink-3">{n.body}</span> : null}
                </span>
              </PortalLink>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
