import { useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { budgetLabel, formatDate, formatDistance, isVerifiedPoster, listRoommatePosts, listingMedia, type RoommatePostWithAuthor } from "@apartment-book/shared";
import { Fab, FeedHeader } from "@/components/feed-header";
import { OnlineStrip } from "@/components/online-strip";
import { PostCard } from "@/components/post-card";
import { Badge, Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useEngagement } from "./index";

export default function RoommatesScreen() {
  const { user, profile } = useSession();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"has_room" | "needs_room" | undefined>();
  const [allCampuses, setAllCampuses] = useState(false);
  const universityId = allCampuses ? undefined : (profile?.university_id ?? undefined);
  const feed = useFeed<RoommatePostWithAuthor>((page) => listRoommatePosts(supabase, { q: q || undefined, universityId, postType: type, page }), [q, universityId, type]);
  const { savedIds, engagement } = useEngagement("roommate", feed.items, user?.id ?? null);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={feed.items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <FeedHeader placeholder="Search roommate posts" value={q} onChange={setQ}>
              <Chip label="Has a room" active={type === "has_room"} onPress={() => setType(type === "has_room" ? undefined : "has_room")} />
              <Chip label="Looking for a room" active={type === "needs_room"} onPress={() => setType(type === "needs_room" ? undefined : "needs_room")} />
              {profile?.university_id ? <Chip label={allCampuses ? "All universities" : "My campus"} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
            </FeedHeader>
            <OnlineStrip />
          </View>
        }
        renderItem={({ item: p }) => {
          const budget = budgetLabel(p);
          return (
            <PostCard
              targetType="roommate"
              targetId={p.id}
              path={`/roommates/${p.id}`}
              poster={{ id: p.author.id, name: p.author.full_name, avatarUrl: p.author.avatar_url, verified: isVerifiedPoster(p.author) }}
              subtitle={[p.university?.name, p.distance_km !== null ? `${formatDistance(p.distance_km)} from campus` : null].filter(Boolean).join(" · ")}
              title={p.title}
              lead={budget ? `${budget}/mo` : undefined}
              description={p.description}
              media={listingMedia(p.images, p.image_meta, p.videos)}
              createdAt={p.created_at}
              saved={savedIds.has(p.id)}
              engagement={engagement[p.id]}
              details={
                <>
                  <Badge label={p.post_type === "has_room" ? "Has a room" : "Looking for a room"} tone={p.post_type === "has_room" ? "green" : "blue"} />
                  {p.location ? <Text style={{ fontSize: 13, color: "#65676b" }}>📍 {p.location}</Text> : null}
                  {p.move_in_date ? <Text style={{ fontSize: 13, color: "#65676b" }}>Move in {formatDate(p.move_in_date)}</Text> : null}
                </>
              }
            />
          );
        }}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <ErrorBanner message={feed.error} onRetry={feed.refresh} /> : <EmptyState icon="people-outline" title="No roommate posts yet" body="Be the first to post for your campus." />}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
      <Fab href="/create/roommate" label="Create roommate post" />
    </View>
  );
}
