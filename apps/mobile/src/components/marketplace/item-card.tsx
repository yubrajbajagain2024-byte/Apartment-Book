import { memo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { formatPrice, ITEM_CONDITIONS, labelFor, photosFor, type ItemCategoryValue, type ItemWithSeller } from "@apartment-book/shared";
import { radius } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

type IconName = keyof typeof Ionicons.glyphMap;

/** Each category's icon: on the card of an item without photos, and on the empty grid of that category. */
const CATEGORY_ICONS: Record<ItemCategoryValue, IconName> = {
  mattress_bedding: "bed-outline",
  furniture: "cube-outline",
  desk_chair: "desktop-outline",
  kitchen: "restaurant-outline",
  electronics: "laptop-outline",
  textbooks: "book-outline",
  decor: "bulb-outline",
  storage: "archive-outline",
  bikes_transport: "bicycle-outline",
  clothing: "shirt-outline",
  sports: "basketball-outline",
  other: "pricetag-outline",
};

export function categoryIcon(category: string | null | undefined): IconName {
  return category && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, category) ? CATEGORY_ICONS[category as ItemCategoryValue] : "bag-handle-outline";
}

/** "Good condition", "Fair condition", "Poor condition"; "New" and "Like new" read fine alone. */
export function conditionText(condition: string | null | undefined): string {
  const label = labelFor(ITEM_CONDITIONS, condition);
  return !label || condition === "new" || condition === "like_new" ? label : `${label} condition`;
}

/** The pickup location as the seller wrote it, trimmed and on one line ("" when none was given). */
export function pickupText(location: string | null | undefined): string {
  return (location ?? "").replace(/\s+/g, " ").trim();
}

export function priceText(item: Pick<ItemWithSeller, "price" | "currency">): string {
  return item.price === 0 ? "Free" : formatPrice(item.price, item.currency);
}

/** What the card says to a screen reader: "Queen mattress, 1 year old, $80, Good condition, Bobcat Village". */
export function itemCardLabel(item: ItemWithSeller): string {
  return [item.title, priceText(item), conditionText(item.condition), pickupText(item.pickup_location)].filter(Boolean).join(", ");
}

/** Between the parts of the meta line. No-break spaces: a plain one at the start of a part would vanish on the web. */
const SEP = "\u00a0•\u00a0";
/** Line height of the meta line at the phone's standard text size. */
const META_LINE = 16;
/** How far above the words the photo starts to darken, so it fades in rather than meeting an edge. */
const FADE_RAMP = 36;
/** The category icon of an item without photos keeps at least this much space above and below it. */
const ICON_MARGIN = 12;

/**
 * One card of the Marketplace grid, as large as `width` and square: the first photo fills it, and at its foot sit the price
 * pill, the title (two lines at most), a line with the condition and the campus code (`campus`), and the pickup location
 * on its own line when the seller gave one (items have no coordinates, so there is no distance). The photo darkens behind
 * those words however many lines there are, from a short fade above them to the photo-pill dark under the last line, and
 * decides their colours: white in both themes. An item without photos shows its category's icon on the theme's soft fill
 * instead, centred in the space above the words and never bigger than that space, with the theme's own colours for the
 * words and the heart. Top right, the heart in a round button likes it; it is a sibling of the card's own button, not
 * inside it, so screen readers reach both. Memoized: a like re-renders only its own card.
 */
export const MarketItemCard = memo(function MarketItemCard({ item, width, campus, liked, onOpen, onToggleLike }: { item: ItemWithSeller; width: number; campus: string; liked: boolean; onOpen: (item: ItemWithSeller) => void; onToggleLike: (id: string) => boolean | null }) {
  const styles = useStyles();
  const colors = useColors();
  const pop = useRef(new Animated.Value(1)).current;
  // The height left above the words on a card without photos, measured, so its icon fits there at any text size.
  const [room, setRoom] = useState(0);
  const photo = photosFor(item.images, item.image_meta)[0];
  const price = priceText(item);
  const condition = conditionText(item.condition);
  // The whole pickup location as the seller wrote it (cut short with "…" only when it is longer than the card).
  const pickup = pickupText(item.pickup_location);

  function like() {
    if (onToggleLike(item.id) !== true) return;
    // A little pop as the heart fills, as on a reel.
    pop.stopAnimation();
    pop.setValue(1);
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.3, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 180, useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 }),
    ]).start();
  }

  const onPhoto = Boolean(photo);
  const iconSize = Math.min(Math.round(width * 0.24), Math.floor(room) - ICON_MARGIN * 2);
  const metaStyle = [styles.meta, onPhoto ? styles.metaOnPhoto : styles.metaOnFill];
  const metaColor = onPhoto ? colors.onMediaMuted : colors.muted;
  const pinStyle = [styles.pin, onPhoto ? styles.pinOnPhoto : null];
  return (
    <View style={[styles.card, { width, height: width }]}>
      <Pressable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={itemCardLabel(item)} style={({ pressed }) => [styles.fill, pressed && styles.pressed]}>
        {photo ? <Image source={{ uri: photo.url }} placeholder={photo.blur ? { uri: photo.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={item.id} /> : null}
        {/* The space above the words: the photo shows through it, or the category icon sits in its middle. */}
        <View style={styles.room} onLayout={onPhoto ? undefined : (e) => setRoom(e.nativeEvent.layout.height)}>
          {!onPhoto && iconSize >= 16 ? <Ionicons name={categoryIcon(item.category)} size={iconSize} color={colors.faint} /> : null}
        </View>
        <View style={[styles.words, onPhoto && styles.wordsOnPhoto]}>
          {onPhoto ? <View style={styles.fadeRamp} /> : null}
          {price ? (
            <View style={styles.pricePill}>
              <Text style={styles.price} numberOfLines={1}>
                {price}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.title, onPhoto ? styles.onPhoto : styles.onFill]} numberOfLines={2}>
            {item.title}
          </Text>
          {/* "Good condition • (pin) TXST", then the pickup location on a line of its own whenever the seller gave one. The pin
              is the app's vector icon, not the emoji: emoji differ between phones (and some draw a box). */}
          {condition || campus ? (
            <View style={styles.metaRow}>
              {condition ? (
                <Text style={[metaStyle, styles.shrink]} numberOfLines={1}>
                  {condition}
                  {campus ? SEP : ""}
                </Text>
              ) : null}
              {campus ? (
                <>
                  <Ionicons name="location" size={11} color={metaColor} style={pinStyle} />
                  <Text style={metaStyle} numberOfLines={1}>
                    {campus}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
          {pickup ? (
            <View style={styles.metaRow}>
              <Ionicons name="location" size={11} color={metaColor} style={pinStyle} />
              <Text style={[metaStyle, styles.shrink]} numberOfLines={1}>
                {pickup}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable onPress={like} hitSlop={8} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }} style={({ pressed }) => [styles.heart, !onPhoto && styles.heartOnFill, pressed && styles.heartPressed]}>
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Ionicons name={liked ? "heart" : "heart-outline"} size={20} color={liked ? colors.like : onPhoto ? colors.onMedia : colors.text} />
        </Animated.View>
      </Pressable>
    </View>
  );
});

const useStyles = makeStyles((colors) => {
  const textShadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };
  return {
    // The soft fill shows while the photo loads, and behind the icon of an item without photos.
    card: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.input },
    // The card's button covers it: the words stack at the foot, the room above them takes what is left. Words too tall
    // for the card (very large text) run off the top, so the price goes before the pickup line does.
    fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
    pressed: { opacity: 0.9 },
    room: { flex: 1, alignItems: "center", justifyContent: "center" },
    words: { paddingHorizontal: 10, paddingBottom: 10, alignItems: "flex-start" },
    // Behind the words on a photo: dark enough for white text on the brightest photo, darkest under the small meta lines.
    // Drawn as real gradients (no seams), as on profile listing squares.
    wordsOnPhoto: { experimental_backgroundImage: `linear-gradient(to bottom, ${colors.mediaScrim}, ${colors.mediaPill} 55%)` },
    // Right above the words, the photo fades from clear into that dark. A fixed offset, not `bottom: "100%"`: the phone's
    // layout resolves percentages against the box minus its padding, which would sink the fade into the words.
    fadeRamp: { position: "absolute", left: 0, right: 0, top: -FADE_RAMP, height: FADE_RAMP, experimental_backgroundImage: `linear-gradient(to bottom, transparent, ${colors.mediaScrim})` },
    pricePill: { backgroundColor: colors.mediaPill, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 6 },
    price: { color: colors.onMedia, fontSize: 14, fontWeight: "800" },
    title: { fontSize: 15, lineHeight: 19, fontWeight: "700" },
    onPhoto: { color: colors.onMedia, ...textShadow },
    onFill: { color: colors.text },
    metaRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", marginTop: 3 },
    meta: { fontSize: 12, lineHeight: META_LINE, fontWeight: "500" },
    shrink: { flexShrink: 1 },
    pin: { marginRight: 2 },
    pinOnPhoto: { ...textShadow },
    metaOnPhoto: { color: colors.onMediaMuted, ...textShadow },
    metaOnFill: { color: colors.muted },
    // The same dark as the price pill, so a red heart still stands out on a bright photo.
    heart: { position: "absolute", top: 8, right: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.mediaPill, alignItems: "center", justifyContent: "center" },
    // Without a photo the card is the theme's soft fill, where a dark circle would swallow a red heart in light mode: the
    // theme's own raised surface with a hairline instead.
    heartOnFill: { backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    heartPressed: { opacity: 0.75 },
  };
});
