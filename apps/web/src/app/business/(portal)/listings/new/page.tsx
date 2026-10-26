import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createBusinessListingAction } from "@/lib/actions/business";
import { portalPath, requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { ApartmentForm } from "@/components/apartments/apartment-form";
import { PortalLink } from "@/components/business/portal-base";

export const metadata: Metadata = { title: "Post a listing" };

export default async function NewBusinessListingPage() {
  const { user, membership } = await requireBusiness("/listings/new", ["pending", "approved"]);
  const business = membership.business;
  if (business.status !== "approved") {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200">
        <h1 className="text-xl font-bold text-gray-900">Listings open once your business is approved</h1>
        <p className="mt-2 text-sm text-gray-600">The UniBuzz team is reviewing {business.name}. You can prepare deals and your profile in the meantime.</p>
        <PortalLink href="/" className="mt-4 inline-block font-semibold text-brand-600 hover:underline">
          Back to the dashboard
        </PortalLink>
      </div>
    );
  }
  const universities = await listUniversities(await createClient());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Post a listing</h1>
        <p className="text-sm text-gray-600">
          It goes live in Explore › Housing for the campus you choose, under {business.name}&apos;s name{business.verified_partner ? ", marked Verified Partner" : ""}.
        </p>
      </div>
      <ApartmentForm action={createBusinessListingAction} universities={universities} userId={user.id} defaultUniversityId={business.university_ids[0] ?? null} cancelHref={await portalPath("/listings")} />
    </div>
  );
}
