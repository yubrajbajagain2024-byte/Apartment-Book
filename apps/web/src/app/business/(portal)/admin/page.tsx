import type { Metadata } from "next";
import { adminBusinessTargets, adminListBusinesses, adminListPromotions, listUniversities } from "@apartment-book/shared";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { AdminReview } from "@/components/business/admin-review";
import { PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Review businesses" };

/**
 * The UniBuzz team's queue: approve (once the owner confirmed their email), reject or suspend businesses; verify
 * them with what was checked; record their paid promotions. Admins only.
 */
export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [businesses, universities] = await Promise.all([adminListBusinesses(supabase), listUniversities(supabase).catch(() => [])]);
  // What each approved business can promote, and its promotions so far.
  const approved = businesses.filter((b) => b.status === "approved");
  const extras = await Promise.all(
    approved.map(async (b) => {
      const [targets, promotions] = await Promise.all([adminBusinessTargets(supabase, b.id).catch(() => []), adminListPromotions(supabase, b.id).catch(() => [])]);
      return [b.id, { targets, promotions }] as const;
    }),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Businesses"
        subtitle="New businesses wait here until someone on the team approves them. Verified Partner is only for a business you checked yourself, with what you checked on record; Sponsored only ever comes from a recorded payment (the Ads tab, or a promotion recorded here)."
      />
      <AdminReview businesses={businesses} universityNames={Object.fromEntries(universities.map((u) => [u.id, u.name]))} extras={Object.fromEntries(extras)} />
    </div>
  );
}
