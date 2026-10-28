import type { Metadata } from "next";
import { createAdAction } from "@/lib/actions/business";
import { adEditorData } from "@/lib/business/ads";
import { requireCapability } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { AdEditor } from "@/components/business/ad-editor";
import { PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "New ad" };

export default async function NewAdPage() {
  const { user, membership } = await requireCapability("publish", "/ads/new");
  const business = membership.business;
  const data = await adEditorData(await createClient(), business);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Ads Manager" title="New ad" subtitle="Five steps, a live preview, and the UniBuzz team's review before anything reaches a student." />
      <AdEditor
        action={createAdAction}
        userId={user.id}
        business={{ name: business.name, logoUrl: business.logo_url, verified: business.verified_partner, category: business.category }}
        universities={data.universities}
        defaultUniversityIds={data.defaultUniversityIds}
        promotable={data.promotable}
        cancelHref="/ads"
      />
    </div>
  );
}
