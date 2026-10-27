import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/components/icon";
import { useActionSheet } from "@/components/action-sheet";
import { Sheet, SheetHeader } from "@/components/sheet";
import { deleteDraft, type Draft } from "@/lib/compose-drafts";
import { clock } from "@/lib/compose-media";
import { alertWithHaptic } from "@/lib/haptics";
import { shortDate } from "@/lib/short-date";
import { radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const COLUMNS = 3;
const GAP = 3;

/**
 * Drafts saved on this phone, newest first, as TikTok keeps them: a grid of their first pictures with the age and a
 * reel's length. Tap one to carry on from its publish screen; hold it to delete it.
 */
export function DraftsSheet({ visible, drafts, userId, onClose, onDismiss, onOpen }: { visible: boolean; drafts: Draft[]; userId: string; onClose: () => void; onDismiss?: () => void; onOpen: (draft: Draft) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const show = useActionSheet();
  const [width, setWidth] = useState(0);
  const cell = width > 0 ? (width - 32 - GAP * (COLUMNS - 1)) / COLUMNS : 0;

  const remove = (draft: Draft) =>
    show(
      [
        {
          label: "Delete draft",
          icon: "trash-outline",
          destructive: true,
          onPress: () =>
            alertWithHaptic("warning", "Delete this draft?", "Its photos and videos stay in your library.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void deleteDraft(userId, draft.id) },
            ]),
        },
      ],
      "Draft",
    );

  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close drafts" height="80%">
      <SheetHeader title={drafts.length > 0 ? `Drafts (${drafts.length})` : "Drafts"} />
      <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {drafts.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="archive-outline" size={30} color={colors.faint} />
            <Text style={styles.emptyTitle}>No drafts</Text>
            <Text style={styles.emptyBody}>Save a post as a draft to finish it later. Drafts stay on this phone.</Text>
          </View>
        ) : cell > 0 ? (
          <FlatList
            data={drafts}
            keyExtractor={(d) => d.id}
            numColumns={COLUMNS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, padding: 16 }}
            renderItem={({ item }) => {
              const first = item.state.media[0];
              const picture = first ? (first.kind === "video" ? first.thumbUri : first.uri) : null;
              const words = item.state.title.trim() || item.state.caption.trim();
              return (
                <Pressable
                  onPress={() => onOpen(item)}
                  onLongPress={() => remove(item)}
                  style={({ pressed }) => [styles.cell, { width: cell, height: (cell * 4) / 3 }, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.state.mode === "reel" ? "Reel" : "Post"} draft${words ? `: ${words.slice(0, 40)}` : ""}, saved ${shortDate(new Date(item.savedAt).toISOString())}`}
                  accessibilityHint="Opens the draft. Hold to delete it."
                >
                  {picture ? <Image source={{ uri: picture }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={styles.words}><Text style={styles.wordsText} numberOfLines={5}>{words || "Untitled"}</Text></View>}
                  <View style={styles.shade} />
                  {item.state.mode === "reel" ? (
                    <View style={styles.badge}>
                      <Icon name="film-outline" size={11} color="#fff" />
                      <Text style={styles.badgeText}>{first?.kind === "video" ? clock(first.duration) : "Reel"}</Text>
                    </View>
                  ) : item.state.media.length > 1 ? (
                    <View style={styles.badge}>
                      <Icon name="images-outline" size={11} color="#fff" />
                      <Text style={styles.badgeText}>{item.state.media.length}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.age}>{shortDate(new Date(item.savedAt).toISOString())}</Text>
                </Pressable>
              );
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40, paddingBottom: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  emptyBody: { fontSize: 14, lineHeight: 19, color: colors.muted, textAlign: "center" },
  cell: { borderRadius: radius.md, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  words: { flex: 1, padding: 10, justifyContent: "center", backgroundColor: colors.panel },
  wordsText: { fontSize: 13, fontWeight: "600", color: colors.text },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 44, experimental_backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)" },
  badge: { position: "absolute", top: 6, left: 6, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.5)" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  age: { position: "absolute", left: 8, bottom: 6, color: "#fff", fontSize: 12, fontWeight: "600" },
}));
