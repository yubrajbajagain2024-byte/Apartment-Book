import type { Metadata } from "next";
import { listUniversities } from "@apartment-book/shared";
import { createDealAction } from "@/lib/actions/business";
import { portalPath, requireCapability } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { DealForm } from "@/components/business/deal-form";
import { PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "New post" };

export default async function NewDealPage() {
  const { user, membership } = await requireCapability("publish", "/deals/new");
  const universities = await listUniversities(await createClient());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader eyebrow="Posts" title="New post" subtitle="It appears on your public profile, and offers in Deals, for students at the campuses you pick while it is live. To put it in front of more students, promote it with an ad." />
      <DealForm action={createDealAction} universities={universities} userId={user.id} defaultUniversityIds={membership.business.university_ids} cancelHref={await portalPath("/deals")} />
    </div>
  );
}
