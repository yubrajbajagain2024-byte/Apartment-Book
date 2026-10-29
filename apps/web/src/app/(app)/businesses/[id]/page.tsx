import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dealIsLive, getPublicBusiness, isBusinessBlocked, listApartmentsByBusiness, listPublicBusinessPosts, listUniversities } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { hoursNow } from "@/lib/business/hours";
import { createClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/utils";
import { FormMessage } from "@/components/ui/field";
import { TrackProfileVisit } from "@/components/business-profile/profile-actions";
import { BusinessProfileView } from "@/components/business-profile/profile-view";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const business = await getPublicBusiness(await createClient(), id).catch(() => null);
  return { title: business ? business.name : "Business" };
}

/**
 * A business's public profile on UniBuzz (BusinessProfileView, which the portal's preview renders too). Only approved
 * businesses have one. Students message it from here (they write first, always), open its website, report it or block
 * it; opening it counts as a profile visit, from an ad as that ad's.
 */
export default async function BusinessProfilePage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [business, user] = await Promise.all([getPublicBusiness(supabase, id), getCurrentUser()]);
  if (!business) notFound();
  const blocked = user ? await isBusinessBlocked(supabase, id) : false;
  const [posts, listings, universities] = blocked
    ? [[], [], []]
    : await Promise.all([listPublicBusinessPosts(supabase, id).catch(() => []), listApartmentsByBusiness(supabase, id).catch(() => []), listUniversities(supabase).catch(() => [])]);
  const live = posts.filter((p) => dealIsLive(p));
  const opened = live.find((p) => p.id === firstParam(query.post)) ?? null;
  const adId = firstParam(query.ad) ?? null;
  const campuses = business.university_ids.length ? universities.filter((u) => business.university_ids.includes(u.id)).map((u) => u.name) : [];
  const { hours, status } = hoursNow(business.hours);

  return (
    <>
      {user ? <TrackProfileVisit businessId={id} adId={adId} /> : null}
      {firstParam(query.error) ? (
        <div className="mx-auto mb-6 w-full max-w-[935px]">
          <FormMessage error={firstParam(query.error)} />
        </div>
      ) : null}
      <BusinessProfileView
        business={business}
        hours={hours}
        hoursStatus={status}
        campuses={campuses}
        posts={live}
        listings={listings.filter((l) => l.status === "active")}
        signedIn={Boolean(user)}
        blocked={blocked}
        opened={opened}
        adId={adId}
      />
    </>
  );
}
