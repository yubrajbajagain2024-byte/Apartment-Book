import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarX2, ExternalLink, Users } from "lucide-react";
import { ORGANIZATION_KINDS, getOrganization, getSavedEventIds, getUniversityTimeZone, listEvents, listFollowedOrganizationIds, listOrganizationMembers } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCard } from "@/components/events/event-card";
import { OrganizationFollowButton } from "@/components/events/organization-follow-button";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const org = UUID.test(id) ? await getOrganization(await createClient(), id).catch(() => null) : null;
  if (!org) return { title: "Organization not found" };
  return { title: org.name, description: org.description?.slice(0, 160) || `${org.name} on UniBuzz` };
}

/**
 * A club, department or student organization: who it is, Follow, its upcoming events and its members. Members
 * publish and manage events in the app; the website shows. A hidden organization answers "not found" to everyone but
 * its members and staff, as the database does.
 */
export default async function OrganizationPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [org, user] = await Promise.all([getOrganization(supabase, id), getCurrentUser()]);
  if (!org) notFound();
  const signedIn = Boolean(user);
  const nowMs = requestNow();
  const [events, members, followedIds, savedIds, timeZone] = await Promise.all([
    listEvents(supabase, { organizationId: org.id, from: new Date(nowMs).toISOString(), limit: 50 }),
    listOrganizationMembers(supabase, org.id).catch(() => []),
    user ? listFollowedOrganizationIds(supabase, user.id).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    user ? getSavedEventIds(supabase, user.id).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    getUniversityTimeZone(supabase, org.university_id),
  ]);
  const isMember = Boolean(user && members.some((m) => m.user_id === user.id));
  const kindLabel = ORGANIZATION_KINDS.find((k) => k.value === org.kind)?.label ?? "Organization";
  const website = org.website ? org.website.replace(/^https:\/\//, "").replace(/\/$/, "") : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link href="/events" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <header className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex items-start gap-4">
          <Avatar name={org.name} src={org.avatar_url} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-2xl font-bold leading-tight text-gray-900">
              <span className="min-w-0 break-words">{org.name}</span>
              {org.verified ? <BadgeCheck className="h-5 w-5 shrink-0 text-brand-600" aria-label="Verified" /> : null}
            </h1>
            <p className="text-sm text-gray-600">
              {kindLabel} · {org.follower_count} {org.follower_count === 1 ? "follower" : "followers"}
            </p>
            {org.website && website ? (
              <a href={org.website} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {website}
              </a>
            ) : null}
          </div>
          <OrganizationFollowButton organizationId={org.id} following={followedIds.has(org.id)} signedIn={signedIn} size="md" />
        </div>
        {!org.verified ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Awaiting verification by UniBuzz staff: its events show to its members only until then.</p> : null}
        {org.description ? <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-gray-800">{org.description}</p> : null}
        {isMember ? <p className="text-xs text-gray-500">You are a member. Publish and manage events, and the team, in the UniBuzz app.</p> : null}
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Upcoming events</h2>
        {events.length === 0 ? (
          <EmptyState icon={CalendarX2} title="Nothing scheduled" description={`${org.name} has no upcoming events right now.`} />
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id}>
                <EventCard event={e} timeZone={timeZone ?? "America/Chicago"} nowMs={nowMs} saved={savedIds.has(e.id)} signedIn={signedIn} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {members.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Users className="h-4 w-4 text-gray-500" aria-hidden /> Members
          </h2>
          <ul className="flex flex-col divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            {members.map((m) => (
              <li key={m.user_id}>
                <Link href={`/profile/${m.user_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <Avatar name={m.profile.full_name} src={m.profile.avatar_url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{m.profile.full_name}</span>
                    <span className="block truncate text-xs text-gray-500">@{m.profile.username}</span>
                  </span>
                  <span className="text-xs text-gray-500">{m.role === "owner" ? "Owner" : "Editor"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
