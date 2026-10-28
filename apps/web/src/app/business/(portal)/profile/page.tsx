import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { businessCategoryLabel, listUniversities, teamRoleAllows } from "@apartment-book/shared";
import { requireBusiness } from "@/lib/business/portal";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { BusinessProfileForm } from "@/components/business/profile-form";
import { CopyLink } from "@/components/business/copy-link";
import { PageHeader, Panel, Pill } from "@/components/business/ui";

export const metadata: Metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const { user, membership } = await requireBusiness("/profile", ["pending", "approved", "rejected"]);
  const business = membership.business;
  const universities = await listUniversities(await createClient());
  const publicUrl = business.status === "approved" ? `${getSiteUrl()}/businesses/${business.id}` : null;
  // A business account is sent back to the portal from the student site, so the link is to share, not to open here.
  const viewPublic = publicUrl ? <CopyLink url={publicUrl} label="Copy profile link" /> : null;

  if (!teamRoleAllows(membership.role, "edit_profile")) {
    const campuses = universities.filter((u) => business.university_ids.includes(u.id)).map((u) => u.name);
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <PageHeader title="Business profile" subtitle="Only the owner and admins edit it." actions={viewPublic} />
        <Panel className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-4">
            <Avatar name={business.name} src={business.logo_url} size="xl" />
            <div>
              <p className="text-[19px] font-semibold text-biz-ink">{business.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-biz-ink-3">
                {businessCategoryLabel(business.category)}
                <Pill>Business</Pill>
                {business.status === "approved" && business.verified_partner ? (
                  <Pill tone="accent">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified Partner
                  </Pill>
                ) : null}
              </p>
            </div>
          </div>
          {business.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-biz-ink-2">{business.description}</p> : null}
          <dl className="grid gap-4 text-[15px] sm:grid-cols-2">
            {[
              ["Website", business.website],
              ["Phone", business.phone],
              ["Email", business.contact_email],
              ["Address", [business.address, business.city].filter(Boolean).join(", ") || null],
              ["Campuses", campuses.length ? campuses.join(", ") : "Every campus"],
            ].map(([label, value]) =>
              value ? (
                <div key={label}>
                  <dt className="text-[13px] text-biz-ink-3">{label}</dt>
                  <dd className="mt-0.5 break-words text-biz-ink">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader title="Business profile" subtitle="Your public page on UniBuzz, with the Business badge: students see it once the UniBuzz team approves your business." actions={viewPublic} />
      <BusinessProfileForm business={business} universities={universities} userId={user.id} />
    </div>
  );
}
