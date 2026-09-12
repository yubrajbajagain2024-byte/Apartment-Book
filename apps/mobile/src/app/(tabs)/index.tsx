import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { formatDistance, formatPrice, getPostEngagementMany, getSavedIds, isVerifiedPoster, listApartments, listingMedia, type ApartmentWithOwner, type PostEngagement } from "@apartment-book/shared";
import { Fab, FeedHeader } from "@/components/feed-header";
import { PostCard } from "@/components/post-card";
import { Badge, Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function HomeScreen() {
  const { user, profile } = useSession();
  const [q, setQ] = useState("");
  const [videoOnly, setVideoOnly] = useState(false);
  const [allCampuses, setAllCampuses] = useState(false);
  const universityId = allCampuses ? undefined : (profile?.university_id ?? undefined);
  const feed = useFeed<ApartmentWithOwner>((page) => listApartments(supabase, { q: q || undefined, universityId, videoOnly, page, sort: "newest" }), [q, universityId, videoOnly]);
  const { savedIds, engagement } = useEngagement("apartment", feed.items, user?.id ?? null);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={feed.items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 90 }}
        ListHeaderComponent={
          <FeedHeader placeholder="Search apartments" value={q} onChange={setQ}>
            <Chip label="Video tours only" icon="videocam-outline" active={videoOnly} onPress={() => setVideoOnly((v) => !v)} />
            {profile?.university_id ? <Chip label={allCampuses ? "All universities" : (profile.university?.name ?? "My campus")} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
          </FeedHeader>
        }
        renderItem={({ item: a }) => (
          <PostCard
            targetType="apartment"
            targetId={a.id}
            path={`/apartments/${a.id}`}
            poster={{ id: a.owner.id, name: a.owner.full_name, avatarUrl: a.owner.avatar_url, verified: isVerifiedPoster(a.owner) }}
            subtitle={[a.distance_km !== null ? `${formatDistance(a.distance_km)} from campus` : null, a.city].filter(Boolean).join(" · ")}
            title={a.title}
            lead={`${formatPrice(a.price_per_month, a.currency)}/mo · ${a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bd`} · ${a.bathrooms} ba`}
            description={a.description}
            media={listingMedia(a.images, a.image_meta, a.videos)}
            createdAt={a.created_at}
            saved={savedIds.has(a.id)}
            engagement={engagement[a.id]}
            details={
              <>
                {a.furnished ? <Badge label="Furnished" tone="blue" /> : null}
                {a.utilities_included ? <Badge label="Utilities included" tone="green" /> : null}
                {a.pets_allowed ? <Badge label="Pets OK" /> : null}
              </>
            }
          />
        )}
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <ErrorBanner message={feed.error} onRetry={feed.refresh} /> : <EmptyState icon="home-outline" title="No apartments yet" body={universityId ? "Try all universities, or be the first to list a place." : "Be the first to list a place."} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: "#8a8d91", padding: 12 }}>Loading more…</Text> : null}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
      <Fab href="/create/apartment" label="List an apartment" />
    </View>
  );
}

/** Saved ids and like/comment counts for the posts currently in a feed. */
export function useEngagement(type: "apartment" | "roommate" | "item", items: { id: string }[], userId: string | null) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [engagement, setEngagement] = useState<Record<string, PostEngagement>>({});
  const ids = useMemo(() => items.map((i) => i.id).join(","), [items]);
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    const missing = list.filter((id) => !(id in engagement));
    if (missing.length > 0) getPostEngagementMany(supabase, type, missing).then((rows) => setEngagement((prev) => ({ ...prev, ...rows }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, type, userId]);
  useEffect(() => {
    if (!userId) {
      setSavedIds(new Set());
      return;
    }
    getSavedIds(supabase, userId, type).then(setSavedIds).catch(() => {});
  }, [userId, type]);
  return { savedIds, engagement };
}
