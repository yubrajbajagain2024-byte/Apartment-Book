import { useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { formatDistance, formatPrice, isVerifiedPoster, listApartments, listingMedia, type ApartmentWithOwner } from "@apartment-book/shared";
import { FeedHeader } from "@/components/feed-header";
import { FEED_GAP, FEED_HEADER_PADDING, PostCard } from "@/components/post-card";
import { Badge, Chip, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useEngagement } from "@/lib/use-engagement";

/** The Apartments half of the Housing tab: search, filters and the listings feed. The Housing screen owns the "+" button. */
export function ApartmentsSection() {
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
        contentContainerStyle={{ gap: FEED_GAP, paddingBottom: 90 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: FEED_HEADER_PADDING, paddingTop: FEED_HEADER_PADDING, paddingBottom: 4 }}>
            <FeedHeader placeholder="Search apartments" value={q} onChange={setQ}>
              <Chip label="Video tours only" icon="videocam-outline" active={videoOnly} onPress={() => setVideoOnly((v) => !v)} />
              {profile?.university_id ? <Chip label={allCampuses ? "All universities" : (profile.university?.name ?? "My campus")} icon="school-outline" active={!allCampuses} onPress={() => setAllCampuses((v) => !v)} /> : null}
            </FeedHeader>
          </View>
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
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: FEED_HEADER_PADDING }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EmptyState icon="home-outline" title="No apartments yet" body={universityId ? "Try all universities, or be the first to list a place." : "Be the first to list a place."} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: "#8a8d91", padding: 12 }}>Loading more…</Text> : null}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} />}
      />
    </View>
  );
}
