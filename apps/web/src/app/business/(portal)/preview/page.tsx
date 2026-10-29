import type { Metadata } from "next";
import { Lock, PenLine } from "lucide-react";
import { dealIsLive, listApartmentsByBusiness, listPublicBusinessPosts, listUniversities, teamRoleAllows } from "@apartment-book/shared";
import { hoursNow } from "@/lib/business/hours";
import { requireBusiness } from "@/lib/business/portal";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { BusinessProfileView } from "@/components/business-profile/profile-view";
import { CopyLink } from "@/components/business/copy-link";
import { BizLink, Notice, PageHeader } from "@/components/business/ui";

export const metadata: Metadata = { title: "Public profile" };

/**
 * The business's public profile as students see it on UniBuzz, opened from the business's name and photo at the top of
 * the sidebar. It is the student page's own component (BusinessProfileView) in its preview mode, inside a window with
 * the student site's look: the same header, hours, website, posts and listings, with nothing to tap. Students see only
 * live posts and active listings, so the preview shows only those too. Every member of the team may look.
 */
export default async function ProfilePreviewPage() {
  const { membership } = await requireBusiness("/preview", ["pending", "approved", "rejected"]);
  const business = membership.business;
  const supabase = await createClient();
  const [posts, listings, universities] = await Promise.all([
    listPublicBusinessPosts(supabase, business.id).catch(() => []),
    listApartmentsByBusiness(supabase, business.id).catch(() => []),
    listUniversities(supabase).catch(() => []),
  ]);
  const campuses = business.university_ids.length ? universities.filter((u) => business.university_ids.includes(u.id)).map((u) => u.name) : [];
  const { hours, status } = hoursNow(business.hours);
  const url = `${getSiteUrl()}/businesses/${business.id}`;
  const approved = business.status === "approved";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Your public profile"
        subtitle="Exactly what students see when they open your profile on UniBuzz."
        actions={
          <>
            {approved ? <CopyLink url={url} label="Copy profile link" /> : null}
            {teamRoleAllows(membership.role, "edit_profile") ? (
              <BizLink href="/profile" variant="primary">
                <PenLine className="h-4 w-4" aria-hidden="true" /> Edit profile
              </BizLink>
            ) : null}
          </>
        }
      />
      {approved ? null : (
        <Notice tone="warning" title="Students can't see it yet">
          It goes live on UniBuzz once the UniBuzz team approves {business.name}. Until then, this preview is the only place it shows.
        </Notice>
      )}

      <div className="overflow-hidden rounded-[22px] bg-biz-surface shadow-biz ring-1 ring-biz-line" data-testid="profile-preview">
        {/* A plain window bar with the page's address: where students find it. */}
        <div className="flex items-center gap-3 border-b border-biz-line bg-biz-surface-2 px-4 py-2.5" aria-hidden="true">
          <span className="flex shrink-0 gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto flex h-7 min-w-0 max-w-md flex-1 items-center justify-center gap-1.5 rounded-lg bg-biz-surface-3 px-3 text-[12px] text-biz-ink-3">
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
          </span>
          <span className="w-[54px] shrink-0" />
        </div>
        <div data-student-preview className="px-3 py-6 sm:px-8 sm:py-10">
          <BusinessProfileView
            business={business}
            hours={hours}
            hoursStatus={status}
            campuses={campuses}
            posts={posts.filter((p) => dealIsLive(p))}
            listings={listings.filter((l) => l.status === "active")}
            signedIn
            blocked={false}
            preview
          />
        </div>
      </div>
    </div>
  );
}
