import { Pressable, ScrollView, Text, View } from "react-native";
import { compactCount, topicCount, topicLabel, type DiscoverTopic } from "@apartment-book/shared";
import { radius, space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/**
 * A topic in a list (Discover's search): the "#" mark, the tag, and how many posts carry it; `posts` null for a tag
 * typed in the box that nothing is ranked under yet ("See posts").
 */
export function TopicRow({ tag, posts, onPress }: { tag: string; posts: number | null; onPress: () => void }) {
  const styles = useStyles();
  const count = posts === null ? "See posts" : topicCount(posts);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${topicLabel(tag)}, ${count}`} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.mark}>
        <Text style={styles.hash}>#</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={styles.name}>
          {topicLabel(tag)}
        </Text>
        <Text style={styles.count}>{count}</Text>
      </View>
    </Pressable>
  );
}

/** Discover's "Trending" row: the topics as pills, side by side, each with its post count; a tap opens the topic. */
export function TrendingTopics({ topics, onOpen }: { topics: readonly DiscoverTopic[]; onOpen: (tag: string) => void }) {
  const styles = useStyles();
  if (topics.length === 0) return null;
  return (
    <View style={styles.trending}>
      <Text style={styles.heading} accessibilityRole="header">
        Trending
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {topics.map((t) => (
          <Pressable key={t.tag} onPress={() => onOpen(t.tag)} accessibilityRole="button" accessibilityLabel={`${topicLabel(t.tag)}, ${topicCount(t.posts)}`} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}>
            <Text style={styles.pillTag} numberOfLines={1}>
              {topicLabel(t.tag)}
            </Text>
            <Text style={styles.pillCount}>{compactCount(t.posts)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  // As big as a person row's photo, so topics and people line up in one list.
  mark: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  hash: { fontSize: 20, fontWeight: "700", color: colors.text },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  count: { fontSize: 13, color: colors.muted },
  trending: { paddingTop: space.sm, gap: space.sm },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, paddingHorizontal: space.lg },
  pills: { gap: space.sm, paddingHorizontal: space.lg },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input, maxWidth: 220 },
  // Tags in the colour captions give them (insta-post's hashtags).
  pillTag: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.hashtag },
  pillCount: { fontSize: 12, fontWeight: "600", color: colors.muted, fontVariant: ["tabular-nums"] },
}));
