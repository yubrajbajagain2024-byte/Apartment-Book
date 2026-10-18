import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { formatPrice, ITEM_CONDITIONS, labelFor, photosFor, timeAgo, type ItemWithSeller } from "@apartment-book/shared";
import { categoryIcon } from "@/components/marketplace/item-card";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { motion, radius, space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";


/**
 * A saved item's tile (the Saved screen): a square photo in a hairline frame with a modest corner, then the price in a
 * quiet serif, the title and a grey line with the condition and where it is. Without a photo the category's icon stands
 * in. The tile sinks a touch under the finger.
 */
export function ItemTile({ item }: { item: ItemWithSeller }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const press = usePressScale();
  const photo = photosFor(item.images, item.image_meta)[0];
  return (
    <AnimatedPressable
      style={[styles.tile, { transform: [{ scale: press.scale }] }]}
      onPress={() => router.push({ pathname: "/marketplace/[id]", params: { id: item.id } })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityLabel={item.title}
    >
      <View style={styles.photo}>{photo ? <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={motion.base} /> : <Ionicons name={categoryIcon(item.category)} size={32} color={colors.faint} />}</View>
      <View style={styles.words}>
        <Text style={styles.price} numberOfLines={1}>
          {item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {labelFor(ITEM_CONDITIONS, item.condition)} · {item.pickup_location || item.university?.name || item.seller.full_name}
        </Text>
        <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
      </View>
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  tile: { flex: 1, maxWidth: "49%", backgroundColor: colors.card, borderRadius: radius.md, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  // The skeleton tone shows while the photo loads, and behind the icon of an item without one.
  photo: { aspectRatio: 1, backgroundColor: colors.skeleton, alignItems: "center", justifyContent: "center" },
  words: { padding: space.sm + space.xxs, gap: space.xxs },
  price: { ...type.headline, fontSize: 17, lineHeight: 22, color: colors.text },
  title: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: colors.text },
  meta: { ...type.footnote, color: colors.muted },
  time: { ...type.footnote, color: colors.faint },
}));
