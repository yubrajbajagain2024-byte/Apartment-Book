import type { Metadata } from "next";
import { businessCategoryLabel, listUniversities } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { BusinessProfileForm } from "@/components/business/profile-form";

export const metadata: Metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const { user, membership } = await requireBusiness("/profile", ["pending", "approved", "rejected"]);
  const business = membership.business;
  const universities = await listUniversities(await createClient());

  if (membership.role !== "owner") {
    const campuses = universities.filter((u) => business.university_ids.includes(u.id)).map((u) => u.name);
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Business profile</h1>
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={business.name} src={business.logo_url} size="xl" />
              <div>
                <p className="text-lg font-bold text-gray-900">{business.name}</p>
                <p className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  {businessCategoryLabel(business.category)}
                  {business.status === "approved" && business.verified_partner ? <Badge tone="green">Verified Partner</Badge> : null}
                </p>
              </div>
            </div>
            {business.description ? <p className="whitespace-pre-line text-sm text-gray-800">{business.description}</p> : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {business.website ? <div><dt className="text-xs text-gray-500">Website</dt><dd>{business.website}</dd></div> : null}
              {business.phone ? <div><dt className="text-xs text-gray-500">Phone</dt><dd>{business.phone}</dd></div> : null}
              {business.contact_email ? <div><dt className="text-xs text-gray-500">Email</dt><dd>{business.contact_email}</dd></div> : null}
              {business.address || business.city ? <div><dt className="text-xs text-gray-500">Address</dt><dd>{[business.address, business.city].filter(Boolean).join(", ")}</dd></div> : null}
              <div className="sm:col-span-2"><dt className="text-xs text-gray-500">Campuses</dt><dd>{campuses.length ? campuses.join(", ") : "Every campus"}</dd></div>
            </dl>
            <p className="text-xs text-gray-500">Only the owner can edit the profile.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Business profile</h1>
        <p className="text-sm text-gray-600">What students see next to your listings and deals, and what the CampConnect team reviews.</p>
      </div>
      <BusinessProfileForm business={business} universities={universities} userId={user.id} />
    </div>
  );
}
