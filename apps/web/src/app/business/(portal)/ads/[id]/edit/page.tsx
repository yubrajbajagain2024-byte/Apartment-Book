import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { adIsEditable, getAd } from "@apartment-book/shared";
import { updateAdAction } from "@/lib/actions/business";
import { adEditorData } from "@/lib/business/ads";
import { portalPath, requireCapability } from "@/lib/business/portal";
import { createClient } from "@/lib/supabase/server";
import { AdEditor } from "@/components/business/ad-editor";
import { PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Edit ad" };

/** Drafts and rejected ads are edited; anything past review is copied into a new draft instead (its page offers that). */
export default async function EditAdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireCapability("publish", `/ads/${id}/edit`);
  const supabase = await createClient();
  const ad = await getAd(supabase, id);
  if (!ad || ad.business_id !== membership.business.id) notFound();
  if (!adIsEditable(ad)) redirect(await portalPath(`/ads/${id}`));
  const business = membership.business;
  const data = await adEditorData(supabase, business);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Ads Manager" title={`Edit “${ad.name}”`} subtitle={ad.status === "rejected" ? "Change what the UniBuzz team asked for, save, then submit it again." : undefined} />
      <AdEditor
        action={updateAdAction.bind(null, id)}
        userId={user.id}
        business={{ name: business.name, logoUrl: business.logo_url, verified: business.verified_partner, category: business.category }}
        universities={data.universities}
        defaultUniversityIds={data.defaultUniversityIds}
        promotable={data.promotable}
        initial={ad}
        cancelHref={`/ads/${id}`}
      />
    </div>
  );
}
