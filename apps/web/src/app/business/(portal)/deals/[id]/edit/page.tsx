import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDeal, listUniversities } from "@apartment-book/shared";
import { updateDealAction } from "@/lib/actions/business";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DealForm } from "@/components/business/deal-form";

export const metadata: Metadata = { title: "Edit deal" };

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireBusiness(`/deals/${id}/edit`);
  const supabase = await createClient();
  const [deal, universities] = await Promise.all([getDeal(supabase, id), listUniversities(supabase)]);
  if (!deal || deal.business_id !== membership.business.id) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-gray-900">Edit deal</h1>
      <DealForm action={updateDealAction.bind(null, id)} universities={universities} userId={user.id} defaultUniversityIds={membership.business.university_ids} initial={deal} cancelHref={await portalPath("/deals")} />
    </div>
  );
}
