import type { ReactNode } from "react";
import { Database, KeyRound } from "lucide-react";
import { fetchBusinessOpsOverview, hasBusinessRole, maybeDeployed, requireConsoleAdmin } from "@/lib/console/server";
import { EmptyBox } from "@/components/console/parts";
import { BusinessTabs } from "@/components/business/business-tabs";
import { PageHeader } from "@/components/shell/page-header";

/**
 * Business: the advertisers, their campaigns, payments, pricing, students' reports and the business audit log, for
 * admins of the staff (two-factor session) who also hold the UniBuzz admin role that Business v2's own functions ask
 * for. Moderators and everyone else get the not-found page; each function checks the caller again.
 */
export default async function BusinessLayout({ children }: { children: ReactNode }) {
  await requireConsoleAdmin("/business");
  if (!(await hasBusinessRole())) {
    return (
      <EmptyBox
        icon={KeyRound}
        title="Business tools need the UniBuzz admin role"
        description="You are an admin of the staff, but your account does not have the admin role that reviewing businesses, ads and payments needs. The database owner grants it with grant_role()."
      />
    );
  }
  const overview = await maybeDeployed(fetchBusinessOpsOverview());
  if (!overview) {
    return (
      <EmptyBox
        icon={Database}
        title="Business needs migration 62"
        description="This database does not have the Business functions yet (20261114000000_console_business.sql, which needs Business v2's migrations before it). Until then the business portal's own admin pages are the way to review businesses and ads."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="console-business">
      <PageHeader title="Business" description="The advertisers, their campaigns, payments and pricing, students' reports and the business audit log." />
      <BusinessTabs counts={{ advertisers: overview.businesses.pendingConfirmed, campaigns: overview.ads.inReview, reports: overview.reports.open }} />
      {children}
    </div>
  );
}
