import { adminListAds, adminListBusinesses, adminListBusinessReports } from "@apartment-book/shared";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "@/components/business/admin-tabs";

/** The UniBuzz team's review: businesses, ads, students' reports and the audit log. Admins only (each page checks too). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const supabase = await createClient();
  const [businesses, ads, reports] = await Promise.all([
    adminListBusinesses(supabase, "pending").catch(() => []),
    adminListAds(supabase, "pending_review").catch(() => []),
    adminListBusinessReports(supabase, "open").catch(() => []),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AdminTabs counts={{ businesses: businesses.length, ads: ads.length, reports: reports.length }} />
      {children}
    </div>
  );
}
