import type { Metadata } from "next";
import type { FeedMedia } from "@apartment-book/shared";
import { PostCard } from "@/components/posts/post-card";
import { PostFeed } from "@/components/posts/post-feed";
import { Navbar } from "@/components/layout/navbar";

export const metadata: Metadata = { title: "Design preview: posts", robots: { index: false } };

/**
 * Temporary design page with sample posts (no database needed) so the card,
 * autoplay and mute behaviour can be reviewed before real videos exist.
 */
const photo = (seed: string): FeedMedia => ({ type: "photo", url: `https://picsum.photos/seed/${seed}/960/1200`, width: 960, height: 1200, blur: null });
const sampleVideo: FeedMedia = { type: "video", playbackUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", poster: null, width: 1920, height: 1080, durationSeconds: 634 };

type Sample = { id: string; title: string; caption: string; lead: string; subtitle: string; poster: { id: string; name: string; avatarUrl: string | null; verified: boolean }; media: FeedMedia[]; createdAt: string };

const samples: Sample[] = [
  {
    id: "v1",
    title: "Sunny 2-bed near Sewell Park",
    caption: "Bright two-bedroom with a balcony, five minutes from campus on the bus line. Utilities included, laundry in unit, parking for one car. Lease from January, looking for two quiet students. Message me for a visit this week!",
    lead: "$1,150/mo · 2 bd · 1 ba",
    subtitle: "0.4 mi from campus · San Marcos",
    poster: { id: "demo-1", name: "Maya Torres", avatarUrl: null, verified: true },
    media: [sampleVideo, photo("living"), photo("kitchen")],
    createdAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  },
  { id: "p1", title: "Room in a quiet 3-bed house", caption: "Furnished room with two grad students.", lead: "$650/mo", subtitle: "1.1 mi from campus", poster: { id: "demo-2", name: "Jordan Lee", avatarUrl: null, verified: true }, media: [photo("room1"), photo("room2")], createdAt: new Date(Date.now() - 5 * 3600e3).toISOString() },
  { id: "p2", title: "Studio on N LBJ Drive", caption: "Compact studio, walkable to everything.", lead: "$900/mo", subtitle: "0.7 mi from campus", poster: { id: "demo-3", name: "Priya Nair", avatarUrl: null, verified: true }, media: [photo("studio")], createdAt: new Date(Date.now() - 26 * 3600e3).toISOString() },
  {
    id: "v2",
    title: "Video tour: 1-bed at The Lodge",
    caption: "Quick walkthrough: front door, living room, kitchen, bedroom, bathroom and the view. Pool and gym included.",
    lead: "$975/mo · 1 bd · 1 ba",
    subtitle: "1.6 mi from campus · San Marcos",
    poster: { id: "demo-4", name: "Ana Ruiz", avatarUrl: null, verified: true },
    media: [sampleVideo],
    createdAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
  },
  { id: "p3", title: "Shared house, 2 rooms free", caption: "Big backyard, fast wifi.", lead: "$550/mo", subtitle: "2.3 mi from campus", poster: { id: "demo-5", name: "Chris Park", avatarUrl: null, verified: true }, media: [photo("house1"), photo("house2"), photo("house3")], createdAt: new Date(Date.now() - 3 * 86400e3).toISOString() },
  { id: "p4", title: "Loft with campus view", caption: "Top floor, lots of light.", lead: "$1,050/mo", subtitle: "0.3 mi from campus", poster: { id: "demo-6", name: "Sam Okafor", avatarUrl: null, verified: true }, media: [photo("loft")], createdAt: new Date(Date.now() - 4 * 86400e3).toISOString() },
];

export default function DesignPostsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-[640px] flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">
        <p className="mb-3 rounded-lg bg-accent-100 px-3 py-2 text-xs text-gray-800">Design preview with sample data. Video posts take the full column; photo-only posts sit two per row. The sample video is a public test stream.</p>
        <PostFeed
          items={samples}
          mediaOf={(s) => s.media}
          render={(s, compact, i) => (
            <PostCard
              href="/design/posts"
              targetType="apartment"
              targetId={s.id}
              poster={s.poster}
              subtitle={s.subtitle}
              media={s.media}
              title={s.title}
              caption={s.caption}
              lead={s.lead}
              createdAt={s.createdAt}
              saved={false}
              signedIn={false}
              currentUserId={null}
              priority={i === 0}
              compact={compact}
            />
          )}
        />
      </main>
    </>
  );
}
