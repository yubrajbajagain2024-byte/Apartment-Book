import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, School } from "lucide-react";
import { budgetLabel, formatDistance, GENDER_PREFERENCES, getListingStats, getPostEngagement, getRoommatePost, isSaved, labelFor, listComments, listingMedia, photosFor } from "@apartment-book/shared";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { PhotoHero } from "@/components/photos/photo-hero";
import { ListingMap, type MapPin as Pin } from "@/components/map/listing-map";
import { MessageButton } from "@/components/common/message-button";
import { SaveButton } from "@/components/common/save-button";
import { RoommateOwnerActions } from "@/components/roommates/roommate-owner-actions";
import { ListingStatsPanel } from "@/components/stats/listing-stats-panel";
import { ViewTracker } from "@/components/stats/view-tracker";
import { PostEngagementPanel } from "@/components/posts/post-engagement-panel";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getRoommatePost(await createClient(), id).catch(() => null);
  return { title: post ? post.title : "Post not found", description: post?.description.slice(0, 160) };
}

export default async function RoommatePostPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const [post, user, profile] = await Promise.all([getRoommatePost(supabase, id), getCurrentUser(), getCurrentProfile()]);
  if (!post) notFound();
  const [engagement, comments] = await Promise.all([
    getPostEngagement(supabase, "roommate", post.id).catch(() => ({ likes: 0, comments: 0, likedByMe: false })),
    listComments(supabase, "roommate", post.id).catch(() => []),
  ]);

  const saved = user ? await isSaved(supabase, user.id, "roommate", post.id) : false;
  const isOwner = user?.id === post.author_id;
  const stats = isOwner ? await getListingStats(supabase, "roommate", post.id).catch(() => null) : null;
  const budget = budgetLabel(post);
  const path = `/roommates/${post.id}`;
  const pinned = post.latitude !== null && post.longitude !== null;
  const mapPins: Pin[] = pinned
    ? [
        { id: post.id, latitude: post.latitude as number, longitude: post.longitude as number, label: post.post_type === "has_room" ? "Room" : "Looking here", title: post.title, subtitle: post.location ?? undefined },
        ...(post.university && post.university.latitude !== null && post.university.longitude !== null
          ? [{ id: "campus", latitude: post.university.latitude, longitude: post.university.longitude, label: post.university.name, kind: "campus" as const }]
          : []),
      ]
    : [];

  const prefs = [
    { label: "Roommate gender", value: labelFor(GENDER_PREFERENCES, post.gender_preference) },
    { label: "Sleep schedule", value: post.sleep_schedule ?? "Not specified" },
    { label: "Cleanliness", value: post.cleanliness ?? "Not specified" },
    { label: "Smoking", value: post.smoking_ok ? "Okay" : "No smoking" },
    { label: "Pets", value: post.pets_ok ? "Okay" : "No pets" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/roommates" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Back to roommates
      </Link>

      <ViewTracker targetType="roommate" targetId={post.id} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {post.images.length > 0 || post.has_video ? <PhotoHero photos={photosFor(post.images, post.image_meta)} media={listingMedia(post.images, post.image_meta, post.videos)} alt={post.title} /> : null}
          <Card>
            <CardBody className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-start gap-2">
                <Badge tone={post.post_type === "has_room" ? "green" : "blue"}>
                  {post.post_type === "has_room" ? "Has a room to share" : "Looking for a room"}
                </Badge>
                {!post.is_active ? <Badge tone="amber">No longer looking</Badge> : null}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <h1 className="min-w-0 flex-1 font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{post.title}</h1>
                {budget ? (
                  <div className="text-right">
                    <p className="font-display text-2xl tracking-tight text-gray-900 sm:text-3xl">{budget}</p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">per month</p>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-600">
                {post.location ? (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-gray-400" strokeWidth={1.75} /> {post.location}
                  </span>
                ) : null}
                {post.move_in_date ? (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-gray-400" strokeWidth={1.75} /> Move in {formatDate(post.move_in_date)}
                  </span>
                ) : null}
                {post.university ? (
                  <span className="flex items-center gap-1.5">
                    <School className="h-4 w-4 text-gray-400" strokeWidth={1.75} /> {post.university.name}
                  </span>
                ) : null}
                {post.distance_km !== null ? <span className="self-center text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{formatDistance(post.distance_km)} to campus</span> : null}
              </div>
              {pinned ? <ListingMap center={{ latitude: post.latitude as number, longitude: post.longitude as number }} pins={mapPins} fitToPins height={240} scrollWheelZoom={false} /> : null}
              <div className="border-t border-gray-100 pt-5">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">About</h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{post.description}</p>
              </div>
              <div className="border-t border-gray-100 pt-5">
                <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Preferences</h2>
                {/* A hairline grid: the gap shows the line colour between the white cells. */}
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-gray-200 ring-1 ring-gray-200 sm:grid-cols-3">
                  {prefs.map((p) => (
                    <div key={p.label} className="bg-white px-3.5 py-3">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{p.label}</dt>
                      <dd className="mt-1 text-sm font-medium text-gray-900">{p.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </CardBody>
          </Card>
          <Card>
            <PostEngagementPanel
              targetType="roommate"
              targetId={post.id}
              ownerId={post.author.id}
              engagement={engagement}
              initialComments={comments}
              signedIn={Boolean(user)}
              currentUser={user && profile ? { id: user.id, name: profile.full_name, avatarUrl: profile.avatar_url } : null}
            />
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <Link href={`/profile/${post.author.id}`} className="flex items-center gap-3">
                <Avatar name={post.author.full_name} src={post.author.avatar_url} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg leading-tight tracking-tight text-gray-900">{post.author.full_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">Posted {timeAgo(post.created_at)}</p>
                </div>
              </Link>
              {!isOwner ? (
                <div className="flex flex-col gap-2">
                  <MessageButton userId={post.author.id} currentUserId={user?.id ?? null} returnTo={path} prefill={`Hi ${post.author.full_name.split(" ")[0]}! I saw your roommate post "${post.title}" and I'd like to chat.`} target={{ type: "roommate", id: post.id }} />
                  <SaveButton targetType="roommate" targetId={post.id} initialSaved={saved} signedIn={Boolean(user)} />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {stats ? <ListingStatsPanel stats={stats} /> : null}
                  <RoommateOwnerActions post={post} />
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
