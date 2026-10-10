import { memo, useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { compactCount, type ProfileTile, type ProfileTileType } from "@apartment-book/shared";
import { colors, radius, space } from "@/lib/theme";

/** What VoiceOver calls each kind of square: "Reel: Move-in day…". */
export const TILE_TYPE_LABELS: Record<ProfileTileType, string> = { post: "Post", reel: "Reel", apartment: "Apartment", roommate: "Roommate post", item: "Item" };
/** Squares are 3:4, like TikTok's grid. */
export const TILE_ASPECT = 4 / 3;

const LISTING_ICONS: Record<"apartment" | "roommate" | "item", keyof typeof Ionicons.glyphMap> = { apartment: "home", roommate: "people", item: "pricetag" };
const LISTING_KINDS: Record<"apartment" | "roommate" | "item", string> = { apartment: "Apartment", roommate: "Roommate post", item: "For sale" };

/** "Reel: Move-in day…, pinned, 1.2k views": the words, the pin and the view count the square shows. */
export function tileLabel(tile: ProfileTile): string {
  const words = tile.text?.replace(/\s+/g, " ").trim().slice(0, 40) || "Photo";
  const views = tile.views === null ? "" : `, ${compactCount(tile.views)} ${tile.views === 1 ? "view" : "views"}`;
  return `${TILE_TYPE_LABELS[tile.type]}: ${words}${tile.pinned ? ", pinned" : ""}${views}`;
}

/** Opens a square's own screen: a post or reel on the post screen, a listing on its detail screen. */
export function useOpenTile() {
  const router = useRouter();
  return useCallback(
    (tile: ProfileTile) => {
      if (tile.type === "post" || tile.type === "reel") router.push({ pathname: "/posts/[id]", params: { id: tile.id } });
      else if (tile.type === "apartment") router.push({ pathname: "/apartments/[id]", params: { id: tile.id } });
      else if (tile.type === "roommate") router.push({ pathname: "/roommates/[id]", params: { id: tile.id } });
      else router.push({ pathname: "/marketplace/[id]", params: { id: tile.id } });
    },
    [router],
  );
}

/**
 * One square of a profile grid, TikTok style: the picture fills it; bottom left a play (videos, reels) or eye (photos) icon
 * with the view count; top right a pin when pinned, otherwise the stack icon of a multi-photo post. A words-only post shows
 * its words on a soft background. `onLongPress` is only given for your own posts and reels (Pin to profile).
 */
export const ProfileGridTile = memo(function ProfileGridTile({ tile, width, onOpen, onLongPress }: { tile: ProfileTile; width: number; onOpen: (tile: ProfileTile) => void; onLongPress?: (tile: ProfileTile) => void }) {
  const listing = tile.type === "apartment" || tile.type === "roommate" || tile.type === "item" ? tile.type : null;
  const pinLabel = tile.pinned ? "Unpin from profile" : "Pin to profile";
  // The marks are white with a shadow on a picture; a words-only or blank square is near white, so there they are grey.
  const ink = tile.imageUrl ? "#fff" : colors.muted;
  const inkShadow = tile.imageUrl ? styles.iconShadow : null;
  return (
    <Pressable
      onPress={() => onOpen(tile)}
      onLongPress={onLongPress ? () => onLongPress(tile) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={tileLabel(tile)}
      accessibilityActions={onLongPress ? [{ name: "longpress", label: pinLabel }] : undefined}
      onAccessibilityAction={onLongPress ? (e) => e.nativeEvent.actionName === "longpress" && onLongPress(tile) : undefined}
      style={({ pressed }) => [styles.tile, { width, height: width * TILE_ASPECT }, pressed && { opacity: 0.85 }]}
    >
      {tile.imageUrl ? (
        <Image source={{ uri: tile.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={tile.key} />
      ) : tile.text ? (
        <View style={styles.words}>
          <Text style={styles.wordsText} numberOfLines={7}>
            {tile.text}
          </Text>
        </View>
      ) : (
        <View style={styles.blank}>
          <Ionicons name={tile.isVideo ? "play" : "image-outline"} size={26} color={colors.faint} />
        </View>
      )}

      {tile.views !== null ? (
        <View style={styles.views} pointerEvents="none">
          <Ionicons name={tile.isVideo ? "play-outline" : "eye-outline"} size={14} color={ink} style={inkShadow} />
          <Text style={[styles.viewsText, { color: ink }, inkShadow]}>{compactCount(tile.views)}</Text>
        </View>
      ) : listing ? (
        <View style={styles.views} pointerEvents="none">
          <Ionicons name={LISTING_ICONS[listing]} size={13} color={ink} style={inkShadow} />
        </View>
      ) : null}

      {tile.pinned ? (
        <Ionicons name="pin" size={16} color={ink} style={[styles.corner, inkShadow]} />
      ) : tile.multiPhoto ? (
        <Ionicons name="copy" size={15} color={ink} style={[styles.corner, inkShadow]} />
      ) : null}
    </Pressable>
  );
});

/** "Listings": someone's live apartments, roommate posts and items as small cards in a sideways row under the bio. */
export function ListingsRow({ tiles, onOpen }: { tiles: ProfileTile[]; onOpen: (tile: ProfileTile) => void }) {
  if (tiles.length === 0) return null;
  return (
    <View style={styles.listings}>
      <Text style={styles.listingsTitle} accessibilityRole="header">
        Listings
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listingsRow}>
        {tiles.map((tile) => {
          const kind = tile.type === "apartment" || tile.type === "roommate" || tile.type === "item" ? LISTING_KINDS[tile.type] : TILE_TYPE_LABELS[tile.type];
          return (
            <Pressable key={tile.key} onPress={() => onOpen(tile)} accessibilityRole="button" accessibilityLabel={`${TILE_TYPE_LABELS[tile.type]}: ${tile.text ?? "Listing"}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
              <View style={styles.cardPhoto}>
                {tile.imageUrl ? <Image source={{ uri: tile.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : <Ionicons name="image-outline" size={22} color={colors.faint} />}
                {tile.isVideo ? <Ionicons name="play" size={14} color="#fff" style={[styles.cardPlay, styles.iconShadow]} /> : null}
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {tile.text ?? "Listing"}
              </Text>
              <Text style={styles.cardKind} numberOfLines={1}>
                {kind}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 } as const;

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.border, overflow: "hidden" },
  words: { flex: 1, backgroundColor: colors.bg, padding: space.sm, justifyContent: "center" },
  wordsText: { fontSize: 13, lineHeight: 17, color: colors.text, fontWeight: "500" },
  blank: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  views: { position: "absolute", left: 6, bottom: 5, flexDirection: "row", alignItems: "center", gap: 3 },
  viewsText: { fontSize: 12, fontWeight: "700" },
  iconShadow: shadow,
  corner: { position: "absolute", top: 6, right: 6 },
  listings: { marginTop: space.lg, gap: space.sm },
  listingsTitle: { fontSize: 15, fontWeight: "700", color: colors.text, paddingHorizontal: space.lg },
  listingsRow: { paddingHorizontal: space.lg, gap: 10 },
  card: { width: 116, gap: 3 },
  cardPhoto: { width: 116, height: 87, borderRadius: radius.sm + 2, backgroundColor: colors.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  cardPlay: { position: "absolute", left: 6, bottom: 5 },
  cardTitle: { fontSize: 13, fontWeight: "600", color: colors.text, lineHeight: 17 },
  cardKind: { fontSize: 11, color: colors.muted },
});
