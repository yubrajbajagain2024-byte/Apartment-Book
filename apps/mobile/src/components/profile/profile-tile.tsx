import { memo, useCallback, useRef } from "react";
import { Pressable, StyleSheet, Text, View, type HostInstance } from "react-native";
import { Image } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { compactCount, type ProfileTile, type ProfileTileType } from "@apartment-book/shared";
import { entryForPost, measureOrigin, openViewer, type ViewerOrigin } from "@/lib/reel-viewer";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

/** What VoiceOver calls each kind of square: "Reel: Move-in day…". */
export const TILE_TYPE_LABELS: Record<ProfileTileType, string> = { post: "Post", reel: "Reel", apartment: "Apartment", roommate: "Roommate post", item: "Item" };
/** Squares are 3:4, like TikTok's grid; reels (vertical video) are 9:16. The ratio is height over width. */
export const TILE_ASPECT = 4 / 3;
export const REEL_ASPECT = 16 / 9;
/** The squares' rounded corners. */
export const TILE_RADIUS = 10;

type ListingType = "apartment" | "roommate" | "item";
const LISTING_ICONS: Record<ListingType, keyof typeof Ionicons.glyphMap> = { apartment: "home", roommate: "people", item: "pricetag" };
/** What a square in the Listings tab says it is. */
const LISTING_KINDS: Record<ListingType, string> = { apartment: "Apartment", roommate: "Roommate post", item: "For sale" };

const isListing = (type: ProfileTileType): type is ListingType => type === "apartment" || type === "roommate" || type === "item";

/** "Reel: Move-in day…, pinned, 1.2k views": the words, the pin and the view count the square shows. */
export function tileLabel(tile: ProfileTile): string {
  const words = tile.text?.replace(/\s+/g, " ").trim().slice(0, 40) || "Photo";
  const views = tile.views === null ? "" : `, ${compactCount(tile.views)} ${tile.views === 1 ? "view" : "views"}`;
  return `${TILE_TYPE_LABELS[tile.type]}: ${words}${tile.pinned ? ", pinned" : ""}${views}`;
}

/** A post or reel square with a picture: one the full-screen viewer can show (a words-only post keeps its own screen). */
function opensFullScreen(tile: ProfileTile): boolean {
  return (tile.type === "post" || tile.type === "reel") && (tile.imageUrl !== null || tile.isVideo);
}

/**
 * Opens a square: a post or reel with a picture full screen in the viewer, with the grid's other posts and reels (in the
 * grid's order) above and below it to swipe through, as Instagram opens a profile's grid; a words-only post on the post
 * screen; a listing on its detail screen. `tiles` is the grid the square was tapped in.
 */
export function useOpenTile() {
  const router = useRouter();
  return useCallback(
    (tile: ProfileTile, tiles?: readonly ProfileTile[], origin?: ViewerOrigin) => {
      if (opensFullScreen(tile)) {
        const list = (tiles ?? [tile]).filter(opensFullScreen);
        const index = Math.max(0, list.findIndex((t) => t.key === tile.key));
        openViewer(router, { entries: list.map((t) => entryForPost(t.id, t.imageUrl)), index, then: "end", origin });
      } else if (tile.type === "post" || tile.type === "reel") router.push({ pathname: "/posts/[id]", params: { id: tile.id } });
      else if (tile.type === "apartment") router.push({ pathname: "/apartments/[id]", params: { id: tile.id } });
      else if (tile.type === "roommate") router.push({ pathname: "/roommates/[id]", params: { id: tile.id } });
      else router.push({ pathname: "/marketplace/[id]", params: { id: tile.id } });
    },
    [router],
  );
}

/**
 * One square of a profile grid, TikTok style: the picture fills it; bottom left a play (videos, reels) or eye (photos) icon
 * with the view count, or a listing's kind (a house, two people, a price tag); top right a pin when pinned, otherwise the
 * stack icon of several photos. A words-only post, or a listing without photos, shows its words on a soft background.
 * `onLongPress` is only given for your own posts and reels (Pin to profile).
 */
export const ProfileGridTile = memo(function ProfileGridTile({ tile, width, aspect = TILE_ASPECT, onOpen, onLongPress }: { tile: ProfileTile; width: number; aspect?: number; onOpen: (tile: ProfileTile, origin?: ViewerOrigin) => void; onLongPress?: (tile: ProfileTile) => void }) {
  const styles = useStyles();
  /** The square's frame, measured when it is tapped so the viewer can zoom open from it. */
  const self = useRef<HostInstance>(null);
  const colors = useColors();
  const listing = isListing(tile.type) ? tile.type : null;
  const pinLabel = tile.pinned ? "Unpin from profile" : "Pin to profile";
  // The marks are white with a shadow on a picture; a words-only or blank square has the soft grey fill, so there they are grey.
  const ink = tile.imageUrl ? colors.onMedia : colors.muted;
  const inkShadow = tile.imageUrl ? styles.iconShadow : null;
  return (
    <Pressable
      ref={self}
      onPress={() => void measureOrigin(self.current, TILE_RADIUS).then((origin) => onOpen(tile, origin))}
      onLongPress={onLongPress ? () => onLongPress(tile) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={tileLabel(tile)}
      accessibilityActions={onLongPress ? [{ name: "longpress", label: pinLabel }] : undefined}
      onAccessibilityAction={onLongPress ? (e) => e.nativeEvent.actionName === "longpress" && onLongPress(tile) : undefined}
      style={({ pressed }) => [styles.tile, { width, height: width * aspect }, pressed && { opacity: 0.85 }]}
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
          <Icon name={tile.isVideo ? "play" : "image-outline"} size={26} color={colors.faint} />
        </View>
      )}

      {tile.views !== null ? (
        <View style={styles.views} pointerEvents="none">
          <Icon name={tile.isVideo ? "play" : "eye-outline"} size={13} color={ink} style={inkShadow} />
          <Text style={[styles.viewsText, { color: ink }, inkShadow]}>{compactCount(tile.views)}</Text>
        </View>
      ) : listing ? (
        <View style={styles.views} pointerEvents="none">
          <Icon name={LISTING_ICONS[listing]} size={13} color={ink} style={inkShadow} />
        </View>
      ) : null}

      {tile.pinned ? (
        <Icon name="pin" size={16} color={ink} style={[styles.corner, inkShadow]} />
      ) : tile.multiPhoto ? (
        <Icon name="copy" size={15} color={ink} style={[styles.corner, inkShadow]} />
      ) : null}
    </Pressable>
  );
});

/**
 * A square of the Listings tab, as on the website: the cover (or the kind's icon on the soft fill), a play mark on a video
 * (otherwise the stack icon of several photos), and at the bottom the kind and a two-line title over a fade. Listing squares
 * in Saved and Liked stay plain ProfileGridTile squares.
 */
export const ListingGridTile = memo(function ListingGridTile({ tile, width, aspect = TILE_ASPECT, onOpen }: { tile: ProfileTile; width: number; aspect?: number; onOpen: (tile: ProfileTile) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const kind: ListingType = isListing(tile.type) ? tile.type : "apartment";
  const picture = Boolean(tile.imageUrl);
  // White with a shadow over a picture; on the soft fill of a listing without photos, the theme's own text colours.
  const ink = picture ? colors.onMedia : colors.muted;
  const inkShadow = picture ? styles.iconShadow : null;
  return (
    <Pressable onPress={() => onOpen(tile)} accessibilityRole="button" accessibilityLabel={tileLabel(tile)} style={({ pressed }) => [styles.tile, { width, height: width * aspect }, pressed && { opacity: 0.85 }]}>
      {tile.imageUrl ? (
        <>
          <Image source={{ uri: tile.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={tile.key} />
          <View style={styles.listingShade} pointerEvents="none" />
        </>
      ) : (
        <View style={styles.listingBlank}>
          <Icon name={LISTING_ICONS[kind]} size={28} color={colors.faint} />
        </View>
      )}

      {tile.isVideo ? (
        <Icon name="play" size={15} color={ink} style={[styles.corner, inkShadow]} />
      ) : tile.multiPhoto ? (
        <Icon name="copy" size={15} color={ink} style={[styles.corner, inkShadow]} />
      ) : null}

      <View style={styles.listingText} pointerEvents="none">
        <View style={styles.listingKindRow}>
          <Icon name={LISTING_ICONS[kind]} size={11} color={ink} style={inkShadow} />
          <Text style={[styles.listingKind, { color: ink }, inkShadow]} numberOfLines={1}>
            {LISTING_KINDS[kind]}
          </Text>
        </View>
        <Text style={[styles.listingTitle, { color: picture ? colors.onMedia : colors.text }, inkShadow]} numberOfLines={2}>
          {tile.text ?? LISTING_KINDS[kind]}
        </Text>
      </View>
    </Pressable>
  );
});

// The soft grey fills (words-only and blank squares) are input: bg is now the screen itself.
const useStyles = makeStyles((colors) => ({
  tile: { backgroundColor: colors.border, overflow: "hidden", borderRadius: TILE_RADIUS, borderCurve: "continuous" },
  words: { flex: 1, backgroundColor: colors.input, padding: space.sm, justifyContent: "center" },
  wordsText: { fontSize: 13, lineHeight: 17, color: colors.text, fontWeight: "500" },
  blank: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  views: { position: "absolute", left: 8, bottom: 7, flexDirection: "row", alignItems: "center", gap: 4 },
  viewsText: { fontSize: 12, fontWeight: "700" },
  iconShadow: { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  corner: { position: "absolute", top: 8, right: 8 },
  // The fade under a listing's kind and title: from clear to the photo-pill dark, drawn as a real gradient (no seams).
  listingShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", experimental_backgroundImage: `linear-gradient(to bottom, transparent, ${colors.mediaPill})` },
  listingBlank: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 40, backgroundColor: colors.input },
  listingText: { position: "absolute", left: 8, right: 8, bottom: 8, gap: 2 },
  listingKindRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  listingKind: { flexShrink: 1, fontSize: 11, fontWeight: "600" },
  listingTitle: { fontSize: 12, fontWeight: "700", lineHeight: 15 },
}));
