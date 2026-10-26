import { memo, useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BUZZ_MINE_COPY, BUZZ_PAGE, getBuzzKarma, listMyBuzz, type MyBuzzKind } from "@apartment-book/shared";
import { buzzState, getBuzzState, onBuzzEvent } from "@/lib/buzz-store";
import { hapticSelect, refreshWithHaptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { BuzzCardById, BuzzCardSkeleton, CARD_GAP, MyReplyCard } from "./card";
import { BuzzComposer } from "./composer";
import { GatedBuzzScreen } from "./gated";
import { BuzzActionsHost } from "./item-menu";
import { BuzzMediaActive } from "./media";
import { BuzzToastHost } from "./toast";
import { EmptyState, ErrorState, GUTTER, MaskGlyph, P, PageHeader, T } from "./ui";
import { useBuzzList, type BuzzListPage } from "./use-buzz-list";

/*
 * My buzzes (UniVerse's MinePage): the private list of your own threads and replies, served only to you, with the
 * private karma line. Reached from Settings, never from Home.
 */

type Row = { id: string; snippet: string };

const TABS: { value: MyBuzzKind; label: string }[] = [
  { value: "threads", label: "Threads" },
  { value: "replies", label: "Replies" },
];

export function BuzzMineScreen() {
  return (
    <GatedBuzzScreen title={BUZZ_MINE_COPY.title} fallback="/settings">
      {(back) => <Mine onBack={back} />}
    </GatedBuzzScreen>
  );
}

const MineRow = memo(function MineRow({ row, kind }: { row: Row; kind: MyBuzzKind }) {
  return <View style={{ paddingHorizontal: GUTTER }}>{kind === "threads" ? <BuzzCardById id={row.id} /> : <MyReplyCard id={row.id} snippet={row.snippet} />}</View>;
});

function Mine({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [kind, setKind] = useState<MyBuzzKind>("threads");
  const [karma, setKarma] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(
    async (offset: number): Promise<BuzzListPage<Row>> => {
      const page = await listMyBuzz(supabase, kind, offset, BUZZ_PAGE.mine);
      return { rows: page.items.map((m) => ({ id: m.item.id, snippet: m.threadSnippet })), items: page.items.map((m) => m.item), nextOffset: page.nextOffset };
    },
    [kind],
  );
  const list = useBuzzList<Row>({ key: kind, load });
  const { remove, reloadQuietly } = list;

  const loadKarma = useCallback(() => {
    getBuzzKarma(supabase).then(setKarma, () => {});
  }, []);
  useFocusEffect(loadKarma);

  useEffect(
    () =>
      onBuzzEvent((e) => {
        if (e.type === "removed") remove(e.id);
        else if (e.type === "refresh" || e.type === "thread") {
          reloadQuietly();
          loadKarma();
        }
      }),
    [remove, reloadQuietly, loadKarma],
  );

  const openComposer = () => {
    buzzState.prepareDraft(getBuzzState().scope);
    setComposerOpen(true);
  };

  let content;
  if (list.status === "loading" || list.status === "idle")
    content = (
      <View style={styles.cards} accessibilityLabel="Loading your buzzes">
        <BuzzCardSkeleton />
        <BuzzCardSkeleton />
      </View>
    );
  else if (list.status === "error") content = <ErrorState title="Buzz didn't load. That's on us." message={list.error} onRetry={reloadQuietly} />;
  else if (list.rows.length === 0)
    content = <EmptyState title={BUZZ_MINE_COPY.emptyTitle} body={BUZZ_MINE_COPY.private} action={kind === "threads" ? { label: BUZZ_MINE_COPY.emptyAction, onPress: openComposer } : undefined} />;

  const note = (
    <View style={styles.note}>
      <MaskGlyph size={13} color={P.ink3} />
      <Text style={[T.caption, styles.flex, { color: P.ink3 }]}>{BUZZ_MINE_COPY.privateNote}</Text>
    </View>
  );

  return (
    <BuzzMediaActive.Provider value={focused}>
      <BuzzActionsHost>
        <View style={styles.screen}>
          <StatusBar style="light" />
          <PageHeader
            title={BUZZ_MINE_COPY.title}
            subtitle={karma !== null ? BUZZ_MINE_COPY.karma(karma) : BUZZ_MINE_COPY.private}
            onBack={onBack}
            below={
              <View style={styles.tabs} accessibilityRole="tablist">
                {TABS.map((t) => {
                  const on = t.value === kind;
                  return (
                    <Pressable
                      key={t.value}
                      onPress={() => {
                        if (on) return;
                        hapticSelect();
                        setKind(t.value);
                      }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={t.label}
                      style={styles.tab}
                    >
                      <Text style={[T.headline, { color: on ? P.ink : P.ink3 }]}>{t.label}</Text>
                      <View style={[styles.underline, on && styles.underlineOn]} />
                    </Pressable>
                  );
                })}
              </View>
            }
          />
          {content ? (
            <View style={styles.flex}>
              {note}
              {content}
            </View>
          ) : (
            <FlatList
              data={list.rows}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => <MineRow row={item} kind={kind} />}
              ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
              ListHeaderComponent={note}
              contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
              indicatorStyle="white"
              onEndReached={() => void list.loadMore()}
              onEndReachedThreshold={0.8}
              ListFooterComponent={
                list.loadingMore ? (
                  <View style={[styles.cards, { paddingTop: CARD_GAP }]}>
                    <BuzzCardSkeleton />
                  </View>
                ) : list.ended ? (
                  <View style={styles.end}>
                    <Text style={[T.caption, { color: P.ink4 }]}>{BUZZ_MINE_COPY.end}</Text>
                  </View>
                ) : undefined
              }
              refreshControl={
                <RefreshControl
                  refreshing={list.refreshing}
                  onRefresh={refreshWithHaptic(() => {
                    list.refresh();
                    loadKarma();
                  })}
                  tintColor={P.accent}
                  colors={[P.accent]}
                  progressBackgroundColor={P.surface2}
                />
              }
            />
          )}
          <BuzzToastHost bottom={insets.bottom + 24} enabled={focused} />
        </View>
        <BuzzComposer visible={composerOpen} onClose={() => setComposerOpen(false)} />
      </BuzzActionsHost>
    </BuzzMediaActive.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: P.canvas },
  tabs: { flexDirection: "row", marginHorizontal: GUTTER, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.line },
  tab: { flex: 1, alignItems: "center", paddingTop: 10 },
  underline: { marginTop: 10, height: 3, width: 64, borderRadius: 2, backgroundColor: "transparent" },
  underlineOn: { backgroundColor: P.accent },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: GUTTER, paddingTop: 14, paddingBottom: 12 },
  cards: { paddingHorizontal: GUTTER, gap: CARD_GAP },
  end: { alignItems: "center", paddingVertical: 20 },
});
