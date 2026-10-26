import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createDealAction } from "@/lib/actions/business";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DealForm } from "@/components/business/deal-form";

export const metadata: Metadata = { title: "Add a deal" };

export default async function NewDealPage() {
  const { user, membership } = await requireBusiness("/deals/new");
  const universities = await listUniversities(await createClient());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add a deal</h1>
        <p className="text-sm text-gray-600">Students at the campuses you pick see it while it is live.</p>
      </div>
      <DealForm action={createDealAction} universities={universities} userId={user.id} defaultUniversityIds={membership.business.university_ids} cancelHref={await portalPath("/deals")} />
    </div>
  );
}
