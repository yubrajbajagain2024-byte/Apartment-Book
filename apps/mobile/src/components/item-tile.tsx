import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { formatPrice, ITEM_CONDITIONS, labelFor, photosFor, timeAgo, type ItemWithSeller } from "@apartment-book/shared";
import { colors, radius } from "@/lib/theme";

/** Marketplace grid tile: square photo, price, title. */
export function ItemTile({ item }: { item: ItemWithSeller }) {
  const router = useRouter();
  const photo = photosFor(item.images, item.image_meta)[0];
  return (
    <Pressable style={styles.tile} onPress={() => router.push({ pathname: "/marketplace/[id]", params: { id: item.id } })} accessibilityLabel={item.title}>
      <View style={styles.photo}>
        {photo ? <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
        <View style={styles.price}>
          <Text style={styles.priceText}>{item.price === 0 ? "Free" : formatPrice(item.price, item.currency)}</Text>
        </View>
      </View>
      <View style={{ padding: 8, gap: 2 }}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {labelFor(ITEM_CONDITIONS, item.condition)} · {item.pickup_location || item.university?.name || item.seller.full_name}
        </Text>
        <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, overflow: "hidden" },
  photo: { aspectRatio: 1, backgroundColor: colors.border },
  price: { position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  priceText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  title: { fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  time: { fontSize: 11, color: colors.faint },
});
