import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getApartment, listUniversities } from "@apartment-book/shared";
import { updateBusinessListingAction } from "@/lib/actions/business";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { ApartmentForm } from "@/components/apartments/apartment-form";

export const metadata: Metadata = { title: "Edit listing" };

export default async function EditBusinessListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireBusiness(`/listings/${id}/edit`, ["approved"]);
  const supabase = await createClient();
  const [apartment, universities] = await Promise.all([getApartment(supabase, id), listUniversities(supabase)]);
  if (!apartment || apartment.business_id !== membership.business.id) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-gray-900">Edit listing</h1>
      <ApartmentForm action={updateBusinessListingAction.bind(null, id)} universities={universities} userId={user.id} initial={apartment} cancelHref={await portalPath("/listings")} />
    </div>
  );
}
