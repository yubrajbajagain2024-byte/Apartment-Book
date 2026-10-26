import type { Metadata } from "next";
import { adminBusinessTargets, adminListBusinesses, adminListPromotions, listUniversities } from "@apartment-book/shared";
import { requireAdmin } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { AdminReview } from "@/components/business/admin-review";

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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Businesses</h1>
        <p className="text-sm text-gray-600">
          New businesses wait here until someone on the team approves them. Verified Partner is only for a business you checked yourself, with what you checked on
          record; Sponsored is only for a listing or deal with a paid promotion recorded here.
        </p>
      </div>
      <AdminReview businesses={businesses} universityNames={Object.fromEntries(universities.map((u) => [u.id, u.name]))} extras={Object.fromEntries(extras)} />
    </div>
  );
}
