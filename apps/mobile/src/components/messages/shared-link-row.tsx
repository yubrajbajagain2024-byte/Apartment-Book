import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { sharedPostLabel, type SharedItem, type SharedPost } from "@apartment-book/shared";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { linkHost } from "./shared-content";

const KIND_NAME: Record<SharedPost["kind"], string> = { post: "Post", reel: "Reel", listing: "Listing" };
const KIND_ICON: Record<SharedPost["kind"], keyof typeof Ionicons.glyphMap> = { post: "images-outline", reel: "film-outline", listing: "home-outline" };

/**
 * One row of a chat's Links tab. A web link shows its site in bold and the address under it; a shared post, reel or listing
 * shows its picture, title and who posted it (it opens in the app, not in a browser). `meta` is who sent it and when.
 */
export function SharedLinkRow({ item, meta, onPress, onLongPress }: { item: SharedItem; meta: string; onPress: () => void; onLongPress?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const shared = item.sharedPost;
  const url = item.url ?? "";
  const heading = (shared && (shared.title?.trim() || shared.caption?.trim())) || null;
  const byline = shared ? `${KIND_NAME[shared.kind]} by ${shared.author.name}` : "";
  // Without a title or caption the byline moves up, and "View post" (what a tap does) takes its place.
  const title = shared ? (heading ?? byline) : linkHost(url);
  const detail = shared ? (heading ? byline : sharedPostLabel(shared)) : url;
  const detailIsAction = !shared || !heading;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={shared ? "button" : "link"}
      accessibilityLabel={shared ? `${title}, ${detail}` : `Link to ${title}`}
      accessibilityHint={meta}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }]}
    >
      <View style={styles.thumb}>
        {shared?.image_url ? (
          <Image source={{ uri: shared.image_url }} style={styles.thumbImage} contentFit="cover" transition={150} accessible={false} />
        ) : (
          <Ionicons name={shared ? KIND_ICON[shared.kind] : "link"} size={22} color={colors.brand} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.detail, detailIsAction && { color: colors.brand }]} numberOfLines={shared ? 1 : 2}>
          {detail}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImage: { width: 52, height: 52 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  detail: { fontSize: 13, lineHeight: 18, color: colors.muted },
  meta: { fontSize: 12, color: colors.faint },
}));
