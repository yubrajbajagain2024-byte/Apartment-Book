import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, School } from "lucide-react";
import { budgetLabel, formatDistance, GENDER_PREFERENCES, getRoommatePost, isSaved, labelFor, listingMedia, photosFor } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
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

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getRoommatePost(await createClient(), id).catch(() => null);
  return { title: post ? post.title : "Post not found", description: post?.description.slice(0, 160) };
}

export default async function RoommatePostPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const [post, user] = await Promise.all([getRoommatePost(supabase, id), getCurrentUser()]);
  if (!post) notFound();

  const saved = user ? await isSaved(supabase, user.id, "roommate", post.id) : false;
  const isOwner = user?.id === post.author_id;
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
      <Link href="/roommates" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to roommates
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {post.images.length > 0 || post.has_video ? <PhotoHero photos={photosFor(post.images, post.image_meta)} media={listingMedia(post.images, post.image_meta, post.videos)} alt={post.title} /> : null}
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start gap-3">
                <Badge tone={post.post_type === "has_room" ? "green" : "blue"}>
                  {post.post_type === "has_room" ? "Has a room to share" : "Looking for a room"}
                </Badge>
                {!post.is_active ? <Badge tone="amber">No longer looking</Badge> : null}
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{post.title}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-700">
                {budget ? <span className="font-semibold text-brand-700">{budget} / month</span> : null}
                {post.location ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" /> {post.location}
                  </span>
                ) : null}
                {post.move_in_date ? (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-4 w-4" /> Move in {formatDate(post.move_in_date)}
                  </span>
                ) : null}
                {post.university ? (
                  <span className="flex items-center gap-1">
                    <School className="h-4 w-4" /> {post.university.name}
                  </span>
                ) : null}
                {post.distance_km !== null ? <span className="font-medium">{formatDistance(post.distance_km)} to campus</span> : null}
              </div>
              {pinned ? <ListingMap center={{ latitude: post.latitude as number, longitude: post.longitude as number }} pins={mapPins} fitToPins height={240} scrollWheelZoom={false} /> : null}
              <div>
                <h2 className="mb-1 font-semibold text-gray-900">About</h2>
                <p className="whitespace-pre-line text-gray-800">{post.description}</p>
              </div>
              <div>
                <h2 className="mb-2 font-semibold text-gray-900">Preferences</h2>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {prefs.map((p) => (
                    <div key={p.label} className="rounded-lg bg-gray-50 px-3 py-2">
                      <dt className="text-xs text-gray-500">{p.label}</dt>
                      <dd className="text-sm font-medium text-gray-900">{p.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <Link href={`/profile/${post.author.id}`} className="flex items-center gap-3">
                <Avatar name={post.author.full_name} src={post.author.avatar_url} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{post.author.full_name}</p>
                  <p className="text-xs text-gray-500">Posted {timeAgo(post.created_at)}</p>
                </div>
              </Link>
              {!isOwner ? (
                <div className="flex flex-col gap-2">
                  <MessageButton userId={post.author.id} currentUserId={user?.id ?? null} returnTo={path} prefill={`Hi ${post.author.full_name.split(" ")[0]}! I saw your roommate post "${post.title}" and I'd like to chat.`} />
                  <SaveButton targetType="roommate" targetId={post.id} initialSaved={saved} signedIn={Boolean(user)} />
                </div>
              ) : (
                <RoommateOwnerActions post={post} />
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
