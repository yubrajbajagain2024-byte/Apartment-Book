import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Building2, GraduationCap, Newspaper, School, Settings, ShoppingBag, Users } from "lucide-react";
import {
  getPostEngagementMany,
  getProfile,
  getSavedIds,
  isBlocked,
  listApartmentsByOwner,
  listFeedPosts,
  listItemsBySeller,
  listRoommatePostsByAuthor,
  type FeedPostWithAuthor,
  type PostEngagement,
} from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageButton } from "@/components/common/message-button";
import { BlockButton } from "@/components/common/report-block";
import { ApartmentCard } from "@/components/apartments/apartment-card";
import { ItemCard } from "@/components/marketplace/item-card";
import { RoommateCard } from "@/components/roommates/roommate-card";
import { FeedPostCard } from "@/components/home/posts-feed";

/** How many of someone's latest posts and reels their profile shows. */
const PROFILE_POSTS = 12;

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
  const blocked = user && !isMe ? await isBlocked(supabase, user.id, profile.id).catch(() => false) : false;
  const [apartments, posts, items, savedIds, viewer, feedPosts] = await Promise.all([
    listApartmentsByOwner(supabase, profile.id, { includeInactive: isMe }),
    listRoommatePostsByAuthor(supabase, profile.id, { includeInactive: isMe }),
    listItemsBySeller(supabase, profile.id, { includeInactive: isMe }),
    user ? getSavedIds(supabase, user.id) : Promise.resolve(new Set<string>()),
    user ? getCurrentProfile() : Promise.resolve(null),
    // Home posts and reels by this person, newest first.
    Promise.all([listFeedPosts(supabase, { kind: "post", authorId: profile.id, pageSize: PROFILE_POSTS }), listFeedPosts(supabase, { kind: "reel", authorId: profile.id, pageSize: PROFILE_POSTS })])
      .then(([a, b]) => [...a.data, ...b.data].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, PROFILE_POSTS))
      .catch(() => [] as FeedPostWithAuthor[]),
  ]);
  const feedEngagement: Record<string, PostEngagement> = await getPostEngagementMany(
    supabase,
    "post",
    feedPosts.map((p) => p.id),
  ).catch(() => ({}));
  const currentUser = user && viewer ? { id: user.id, name: viewer.full_name, avatarUrl: viewer.avatar_url } : null;
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
              <>
                <MessageButton userId={profile.id} currentUserId={user?.id ?? null} returnTo={`/profile/${profile.id}`} />
                {user ? <BlockButton otherId={profile.id} initialBlocked={blocked} name={profile.full_name} /> : null}
              </>
            )}
          </div>
        </CardBody>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Newspaper className="h-5 w-5 text-brand-600" /> Posts
          </h2>
          {isMe ? (
            <LinkButton href="/posts/new" size="sm" variant="secondary">
              Write a post
            </LinkButton>
          ) : null}
        </div>
        {feedPosts.length === 0 ? (
          <EmptyState title={isMe ? "You have not posted anything yet" : `${firstName} has not posted anything yet`} />
        ) : (
          <div className="-mx-3 grid items-start gap-1 sm:mx-0 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {feedPosts.map((p) => (
              <FeedPostCard key={p.id} post={p} saved={savedIds.has(p.id)} signedIn={signedIn} currentUserId={user?.id ?? null} currentUser={currentUser} engagement={feedEngagement[p.id]} />
            ))}
          </div>
        )}
      </section>

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
