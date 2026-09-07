import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Building2, GraduationCap, School, Settings, ShoppingBag, Users } from "lucide-react";
import {
  getProfile,
  getSavedIds,
  listApartmentsByOwner,
  listItemsBySeller,
  listRoommatePostsByAuthor,
} from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageButton } from "@/components/common/message-button";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const profile = await getProfile(await createClient(), id).catch(() => null);
  return { title: profile ? profile.full_name : "Profile" };
}

export default async function ProfilePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const [profile, user] = await Promise.all([getProfile(supabase, id), getCurrentUser()]);
  if (!profile) notFound();

  const isMe = user?.id === profile.id;
  const [apartments, posts, items, savedIds] = await Promise.all([
    listApartmentsByOwner(supabase, profile.id, { includeInactive: isMe }),
    listRoommatePostsByAuthor(supabase, profile.id, { includeInactive: isMe }),
    listItemsBySeller(supabase, profile.id, { includeInactive: isMe }),
    user ? getSavedIds(supabase, user.id) : Promise.resolve(new Set<string>()),
  ]);
  const signedIn = Boolean(user);
  const firstName = profile.full_name.split(" ")[0];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={profile.full_name} src={profile.avatar_url} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{profile.full_name}</h1>
              {profile.university?.email_domain ? (
                <Badge tone="green" className="gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified @{profile.university.email_domain} student
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              {profile.university ? (
                <span className="flex items-center gap-1">
                  <School className="h-4 w-4" /> {profile.university.name}
                </span>
              ) : null}
              {profile.program || profile.graduation_year ? (
                <span className="flex items-center gap-1">
                  <GraduationCap className="h-4 w-4" />
                  {[profile.program, profile.graduation_year ? `Class of ${profile.graduation_year}` : null].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              <span>Joined {formatDate(profile.created_at)}</span>
            </div>
            {profile.bio ? <p className="mt-3 whitespace-pre-line text-gray-800">{profile.bio}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {isMe ? (
              <LinkButton href="/settings/profile" variant="secondary">
                <Settings className="h-4 w-4" /> Edit profile
              </LinkButton>
            ) : (
              <MessageButton userId={profile.id} currentUserId={user?.id ?? null} returnTo={`/profile/${profile.id}`} />
            )}
          </div>
        </CardBody>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="h-5 w-5 text-brand-600" /> Apartments
          </h2>
          {isMe ? (
            <LinkButton href="/apartments/new" size="sm" variant="secondary">
              Post a listing
            </LinkButton>
          ) : null}
        </div>
        {apartments.length === 0 ? (
          <EmptyState title={isMe ? "You have not posted any apartments" : `${firstName} has no apartment listings`} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {apartments.map((a) => (
              <ApartmentCard key={a.id} apartment={a} saved={savedIds.has(a.id)} signedIn={signedIn} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5 text-brand-600" /> Roommate posts
          </h2>
          {isMe ? (
            <LinkButton href="/roommates/new" size="sm" variant="secondary">
              Create post
            </LinkButton>
          ) : null}
        </div>
        {posts.length === 0 ? (
          <EmptyState title={isMe ? "You have no roommate posts" : `${firstName} has no roommate posts`} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <RoommateCard key={p.id} post={p} saved={savedIds.has(p.id)} signedIn={signedIn} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShoppingBag className="h-5 w-5 text-brand-600" /> Marketplace items
          </h2>
          {isMe ? (
            <LinkButton href="/marketplace/new" size="sm" variant="secondary">
              Sell something
            </LinkButton>
          ) : null}
        </div>
        {items.length === 0 ? (
          <EmptyState title={isMe ? "You have nothing for sale" : `${firstName} has nothing for sale`} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((i) => (
              <ItemCard key={i.id} item={i} saved={savedIds.has(i.id)} signedIn={signedIn} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
