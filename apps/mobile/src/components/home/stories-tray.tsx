import { memo, useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { STORY_RING, STORY_RING_GAP, type StoryGroup } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { useSession } from "@/lib/session";
import { handStories, useStories } from "@/lib/stories-store";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useCreateMenu } from "./create-menu";

const AVATAR = 62;
const RING = AVATAR + 2 * (STORY_RING + STORY_RING_GAP);

/**
 * The row of stories under Home's tabs, Instagram's: "Your story" first (your photo with a + to share one; once you have
 * one, your own ring, which opens it), then everyone whose stories you may see, those with something unseen first in
 * the aurora ring, the rest in a quiet grey one, a first name under each. A tap opens them full screen (app/stories).
 * Only what the database lets this person see is ever here (migration 58's rules). Signed out there is no tray.
 */
export const StoriesTray = memo(function StoriesTray({ active = true }: { active?: boolean }) {
  const { user, profile } = useSession();
  const groups = useStories(user?.id ?? null, active);
  const router = useRouter();
  const create = useCreateMenu();
  const colors = useColors();
  const styles = useStyles();
  const mine = groups.find((g) => g.mine) ?? null;
  const others = groups.filter((g) => !g.mine);

  const open = useCallback(
    (group: StoryGroup) => {
      const list = mine ? [mine, ...others] : others;
      const index = list.indexOf(group);
      handStories(list, index < 0 ? 0 : index);
      router.push({ pathname: "/stories/[id]", params: { id: group.author.id } });
    },
    [mine, others, router],
  );

  if (!user) return null;
  const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

  return (
    <View style={styles.tray} accessibilityRole="list" accessibilityLabel="Stories">
      <FlatList
        horizontal
        data={others}
        keyExtractor={(g) => g.author.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        ListHeaderComponent={
          <Pressable
            onPress={() => (mine ? open(mine) : create())}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={mine ? `Your story, ${mine.stories.length} ${mine.stories.length === 1 ? "story" : "stories"}` : "Your story"}
            accessibilityHint={mine ? "Opens your stories" : "Share a photo or video that disappears after 24 hours"}
          >
            <View style={[styles.ring, mine ? styles.ringOn : styles.ringNone, mine && { experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]}>
              <View style={styles.ringGap}>
                <Avatar name={profile?.full_name} url={profile?.avatar_url} size={AVATAR} online={false} />
              </View>
              {/* The + to share: on its own when you have stories (a tap on the photo opens them), on the whole when you have none. */}
              <Pressable onPress={create} hitSlop={6} accessibilityRole="button" accessibilityLabel="Add to your story" style={[styles.plus, { borderColor: colors.bg }]}>
                <Icon name="add" size={15} color="#fff" weight="bold" />
              </Pressable>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              Your story
            </Text>
          </Pressable>
        }
        renderItem={({ item: g }) => (
          <Pressable
            onPress={() => open(g)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${g.author.full_name}'s story${g.seen ? ", seen" : ""}`}
          >
            <View style={[styles.ring, g.seen ? styles.ringSeen : styles.ringOn, !g.seen && { experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]}>
              <View style={styles.ringGap}>
                <Avatar name={g.author.full_name} url={g.author.avatar_url} size={AVATAR} online={false} />
              </View>
            </View>
            <Text style={[styles.name, g.seen && styles.nameSeen]} numberOfLines={1}>
              {firstName(g.author.full_name)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  tray: { paddingTop: 10, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { paddingHorizontal: 12, gap: 14 },
  item: { width: RING + 10, alignItems: "center", gap: 6 },
  pressed: { opacity: 0.75 },
  ring: { width: RING, height: RING, borderRadius: RING / 2, alignItems: "center", justifyContent: "center" },
  ringOn: { backgroundColor: colors.brand },
  ringSeen: { backgroundColor: colors.border },
  ringNone: { backgroundColor: "transparent" },
  // The gap between the ring and the photo, in the page's own colour.
  ringGap: { width: RING - 2 * STORY_RING, height: RING - 2 * STORY_RING, borderRadius: (RING - 2 * STORY_RING) / 2, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  plus: { position: "absolute", right: 0, bottom: 0, width: 24, height: 24, borderRadius: 12, borderWidth: 2.5, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 12, color: colors.text, maxWidth: RING + 10, textAlign: "center" },
  nameSeen: { color: colors.muted },
}));
