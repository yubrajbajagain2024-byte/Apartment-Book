import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { businessLabel, compactCount, formatDistance, formatPrice, isPlainBusinessLabel, isVerifiedPoster, listingMedia, listingPoster, type ApartmentWithOwner, type PostEngagement } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon, useBounceOn, type IconName } from "@/components/icon";
import { useListingActions } from "@/components/listing-actions";
import { PhotoCarousel } from "@/components/photo-carousel";
import { shortDate } from "@/lib/short-date";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

/**
 * The media's shape: wide, like a video on YouTube's home feed, for landscape photos and tours; a phone-shot (portrait)
 * tour gets a square frame instead, so it is not cut down to a thin band across its middle while the listing's name and
 * actions still show under it on the first screen.
 */
const MEDIA_ASPECT = 16 / 9;
const PORTRAIT_ASPECT = 1;
function aspectOf(first: { width: number | null; height: number | null } | undefined): number {
  return first && first.width && first.height && first.height > first.width ? PORTRAIT_ASPECT : MEDIA_ASPECT;
}
/** The card's corners, and the inside gutter of its words. */
const CARD_RADIUS = 22;
const GUTTER = 16;

/** One action under the card: its icon over its word (or count), all six sharing the row evenly. */
function Action({ icon, label, onPress, color, bounce, selected, accessibilityLabel }: { icon: IconName; label: string; onPress: () => void; color?: string; bounce?: number; selected?: boolean; accessibilityLabel: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.action, pressed && { opacity: 0.55 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={selected === undefined ? undefined : { selected }}>
      <Icon name={icon} size={22} color={color ?? colors.text} bounce={bounce} />
      <Text style={[styles.actionText, color ? { color } : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * An apartment in the Housing feed, laid out like a video on YouTube's home feed: the video tour (or the photos) edge to
 * edge at the top of a rounded card, playing muted on its own while it is the listing on screen (`playing`), with the
 * sound button, the time left and a thin progress line over it; under it the apartment's name, the monthly rent with
 * the beds, baths and distance, two lines of its description, who posted it, and Like, Comment, Share, Inbox, Save and
 * Report in one even row. A tap on the picture or the words opens the listing's own page.
 */
export const HousingCard = memo(function HousingCard({ apartment: a, saved, engagement, playing }: { apartment: ApartmentWithOwner; saved: boolean; engagement: PostEngagement | undefined; playing: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { isDark } = useAppTheme();
  const router = useRouter();
  const poster = listingPoster(a.owner, a.business);
  const label = businessLabel(a.business, a.sponsored);
  const media = listingMedia(a.images, a.image_meta, a.videos);
  const path = `/apartments/${a.id}`;
  const rent = formatPrice(a.price_per_month, a.currency);
  const actions = useListingActions({ targetType: "apartment", targetId: a.id, path, poster, businessId: a.business?.id ?? null, title: a.title, lead: `${rent}/mo`, description: a.description, media, engagement, saved });
  const { like, save, own, openDetail } = actions;
  const likeBounce = useBounceOn(like.liked);
  const saveBounce = useBounceOn(save.saved);
  const comments = engagement?.comments ?? 0;
  const facts = [a.bedrooms === 0 ? "Studio" : `${a.bedrooms} bd`, `${a.bathrooms} ba`, a.furnished ? "Furnished" : null, a.distance_km !== null ? `${formatDistance(a.distance_km)} to campus` : null].filter(Boolean).join(" · ");
  // Under the name: a business's label first (in the brand colour; a plain "Business" stays grey), then where and when.
  const strongLabel = label && !isPlainBusinessLabel(label) ? label : null;
  const meta = [strongLabel ? null : label, a.city, shortDate(a.created_at)].filter(Boolean).join(" · ");
  const verified = !a.business && isVerifiedPoster(a.owner);

  return (
    <View style={[styles.card, !isDark && styles.cardLight]} accessibilityLabel={`${a.title}, ${rent} a month`}>
      {media.length > 0 ? (
        <PhotoCarousel media={media} aspect={aspectOf(media[0])} chrome="watch" active={playing} onPress={() => openDetail()} />
      ) : (
        // No photos yet: the rent on the Aurora, so the card keeps its shape and still says something.
        <Pressable onPress={() => openDetail()} style={[styles.noMedia, { experimental_backgroundImage: auroraGradient(colors.auroraPanel, 135) }]} accessibilityLabel={a.title}>
          <Icon name="home-outline" size={30} color={colors.auroraInk} />
          <Text style={styles.noMediaRent}>{rent}/mo</Text>
        </Pressable>
      )}

      <Pressable onPress={() => openDetail()} style={styles.words}>
        <Text style={styles.title} numberOfLines={2}>
          {a.title}
        </Text>
        <Text style={styles.priceLine} numberOfLines={1}>
          <Text style={styles.rent}>{rent}</Text>
          <Text style={styles.per}>/mo</Text>
          {facts ? <Text style={styles.facts}>{`  ·  ${facts}`}</Text> : null}
        </Text>
        {a.description?.trim() ? (
          <Text style={styles.description} numberOfLines={2}>
            {a.description.trim()}
          </Text>
        ) : null}
      </Pressable>

      <Pressable
        // A business's listing opens the business's public profile (migration 50), never the person who posted it.
        onPress={() => (a.business ? router.push({ pathname: "/businesses/[id]", params: { id: a.business.id } }) : router.push({ pathname: "/profile/[id]", params: { id: poster.id } }))}
        style={styles.channel}
        accessibilityRole="button"
        accessibilityLabel={`${poster.name}'s profile`}
      >
        <Avatar name={poster.name} url={poster.avatarUrl} size={36} userId={a.business ? undefined : poster.id} online={a.business ? false : undefined} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {poster.name}
            </Text>
            {verified ? <Icon name="checkmark-circle" sf="checkmark.seal.fill" size={14} color={colors.brand} accessibilityLabel="Verified student" /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {strongLabel ? <Text style={styles.metaLabel}>{strongLabel}</Text> : null}
            {strongLabel && meta ? " · " : ""}
            {meta}
          </Text>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Action icon={like.liked ? "heart" : "heart-outline"} label={like.likes > 0 ? compactCount(like.likes) : "Like"} color={like.liked ? colors.like : undefined} bounce={likeBounce} selected={like.liked} onPress={() => void like.toggle()} accessibilityLabel={like.liked ? "Unlike" : "Like"} />
        <Action icon="chatbubble-outline" label={comments > 0 ? compactCount(comments) : "Comment"} onPress={() => openDetail(true)} accessibilityLabel="Comment" />
        <Action icon="share-outline" label="Share" onPress={actions.share} accessibilityLabel="Share" />
        <Action icon="chatbubble-ellipses-outline" label="Inbox" color={own ? undefined : colors.brand} onPress={() => void actions.message()} accessibilityLabel={own ? "Inbox" : `Message ${poster.name}`} />
        <Action icon={save.saved ? "bookmark" : "bookmark-outline"} label={save.saved ? "Saved" : "Save"} bounce={saveBounce} selected={save.saved} onPress={() => void save.toggle()} accessibilityLabel={save.saved ? "Unsave" : "Save"} />
        {own ? null : <Action icon="flag-outline" label="Report" color={colors.muted} onPress={actions.report} accessibilityLabel="Report" />}
      </View>
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  // Edge to edge, a rounded card; the media fills its top, and its corners clip it.
  card: { backgroundColor: colors.card, borderRadius: CARD_RADIUS, borderCurve: "continuous", overflow: "hidden" },
  // On the light theme the card is as white as the page: a hairline draws its edge.
  cardLight: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  noMedia: { width: "100%", aspectRatio: MEDIA_ASPECT, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.panel },
  noMediaRent: { fontSize: 20, fontWeight: "700", color: colors.text },
  words: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 4 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: colors.text },
  priceLine: { fontSize: 14, lineHeight: 19 },
  rent: { fontSize: 15, fontWeight: "700", color: colors.brand },
  per: { fontSize: 13, fontWeight: "600", color: colors.brand },
  facts: { fontSize: 14, color: colors.muted },
  description: { fontSize: 14, lineHeight: 19, color: colors.muted },
  channel: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: GUTTER, paddingTop: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  metaLabel: { fontWeight: "600", color: colors.brand },
  actions: { flexDirection: "row", paddingHorizontal: 6, paddingTop: 10, paddingBottom: 12 },
  action: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 4 },
  actionText: { fontSize: 11.5, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
}));
