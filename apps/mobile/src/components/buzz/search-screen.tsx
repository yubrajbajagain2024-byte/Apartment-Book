import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BUZZ_LIMITS, BUZZ_PAGE, BUZZ_SEARCH_COPY, BUZZ_SEARCH_SUGGESTIONS, BUZZ_SEARCH_SORTS, buzzSearchTerms, getBuzzFeed, type BuzzScope } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { ensureBuzzMeta } from "@/lib/buzz-actions";
import { buzzState, onBuzzEvent, useBuzzState, type BuzzUiState } from "@/lib/buzz-store";
import { refreshWithHaptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { BuzzCardById, BuzzCardSkeleton, CARD_GAP } from "./card";
import { GatedBuzzScreen } from "./gated";
import { BuzzActionsHost } from "./item-menu";
import { BuzzToastHost } from "./toast";
import { Chip, EmptyState, ErrorState, GUTTER, P, PageHeader, PIconButton, R, Segmented, T } from "./ui";
import { useBuzzList, type BuzzListPage } from "./use-buzz-list";

/*
 * Search Buzz (UniVerse's SearchPage): find buzzes by a word or two in the title or the words, in Campus or Global,
 * newest or top first. Results are ordinary cards (aliases only). The query, scope and order stay for the session, so
 * Back from a thread lands on the same results; nothing is written to the phone.
 */

const selectSearch = (s: BuzzUiState) => s.search;
const selectCampus = (s: BuzzUiState) => s.campus;
const SCOPES = [
  { value: "campus" as const, label: "Campus", icon: "school-outline" as const },
  { value: "global" as const, label: "Global", icon: "globe-outline" as const },
];

type Row = { id: string };

export function BuzzSearchScreen() {
  return <GatedBuzzScreen title={BUZZ_SEARCH_COPY.title}>{(back) => <Search onBack={back} />}</GatedBuzzScreen>;
}

const ResultRow = memo(function ResultRow({ id }: { id: string }) {
  return (
    <View style={{ paddingHorizontal: GUTTER }}>
      <BuzzCardById id={id} />
    </View>
  );
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Search({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const search = useBuzzState(selectSearch);
  const campus = useBuzzState(selectCampus);
  const inputRef = useRef<TextInputInstance>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const q = useDebounced(search.q, 300).trim();
  const ready = buzzSearchTerms(q).length > 0;
  const key = ready ? `${search.scope}:${search.sort}:${q.toLowerCase()}` : null;
  const where = search.scope === "campus" ? (campus?.shortName ?? "campus") : "Global";

  const load = useCallback(
    async (offset: number, rankAt: string | null): Promise<BuzzListPage<Row>> => {
      const page = await getBuzzFeed(supabase, { scope: search.scope, sort: search.sort, window: "all", q, offset, rankAt, limit: BUZZ_PAGE.feed });
      return { rows: page.items.map((b) => ({ id: b.id })), items: page.items, nextOffset: page.nextOffset, rankAt: page.rankAt };
    },
    [search.scope, search.sort, q],
  );
  const list = useBuzzList<Row>({ key, load });
  const { remove } = list;
  useEffect(() => onBuzzEvent((e) => e.type === "removed" && remove(e.id)), [remove]);
  // "Search Texas State buzz" needs the campus's name.
  useEffect(() => ensureBuzzMeta("campus"), []);

  // Focus the box on arrival when there is nothing in it yet.
  useEffect(() => {
    if (search.q) return;
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const otherScope: BuzzScope = search.scope === "campus" ? "global" : "campus";
  let content;
  if (!ready) {
    content = (
      <View style={styles.intro}>
        <Text style={[T.footnote, { color: P.ink3 }]}>{BUZZ_SEARCH_COPY.intro}</Text>
        <View style={styles.suggestions}>
          {BUZZ_SEARCH_SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} onPress={() => buzzState.setSearch({ q: s })} />
          ))}
        </View>
      </View>
    );
  } else if (list.status === "loading" || list.status === "idle") {
    content = (
      <View style={styles.cards} accessibilityLabel="Searching">
        <BuzzCardSkeleton />
        <BuzzCardSkeleton />
      </View>
    );
  } else if (list.status === "error") {
    content = <ErrorState title={BUZZ_SEARCH_COPY.loadError} message={list.error} onRetry={list.reloadQuietly} style={{ paddingTop: 24 }} />;
  } else if (list.rows.length === 0) {
    content = (
      <EmptyState
        iconNode={<MaterialCommunityIcons name="magnify-close" size={28} color={P.accentInk} />}
        title={BUZZ_SEARCH_COPY.noMatch(where, q)}
        body={search.scope === "campus" ? BUZZ_SEARCH_COPY.tryGlobal : BUZZ_SEARCH_COPY.tryCampus}
        action={{ label: otherScope === "global" ? "Search Global" : `Search ${campus?.shortName ?? "your campus"}`, onPress: () => buzzState.setSearch({ scope: otherScope }) }}
        style={{ paddingTop: 24 }}
      />
    );
  }

  return (
    <BuzzActionsHost>
      <View style={styles.screen}>
        <StatusBar style="light" />
        <PageHeader
          title={BUZZ_SEARCH_COPY.title}
          onBack={onBack}
          below={
            <View style={styles.below}>
              <View style={[styles.box, inputFocused && styles.boxFocused]}>
                <Icon name="search" size={18} color={P.ink3} />
                <TextInput
                  ref={inputRef}
                  value={search.q}
                  onChangeText={(v) => buzzState.setSearch({ q: v })}
                  placeholder={`Search ${where} buzz`}
                  placeholderTextColor={P.ink4}
                  keyboardAppearance="dark"
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="none"
                  maxLength={BUZZ_LIMITS.search}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onSubmitEditing={() => inputRef.current?.blur()}
                  style={[T.body, styles.input]}
                  accessibilityLabel="Search buzzes"
                />
                {search.q ? <PIconButton icon="close" label="Clear search" onPress={() => buzzState.setSearch({ q: "" })} variant="filled" size={28} iconSize={14} /> : null}
              </View>
              <View style={styles.filters}>
                <Segmented label="Sort results" value={search.sort} options={BUZZ_SEARCH_SORTS} onChange={(sort) => buzzState.setSearch({ sort })} />
                <Segmented<BuzzScope> label="Feed scope" value={search.scope} options={SCOPES} onChange={(scope) => buzzState.setSearch({ scope })} />
              </View>
            </View>
          }
        />
        {content ?? (
          <FlatList
            data={list.rows}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => <ResultRow id={item.id} />}
            ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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
                  <Text style={[T.caption, { color: P.ink4 }]}>{BUZZ_SEARCH_COPY.end}</Text>
                </View>
              ) : list.moreError ? (
                <Pressable onPress={() => void list.loadMore()} accessibilityRole="button" style={styles.end}>
                  <Text style={[T.footnote, { color: P.accentInk }]}>Couldn't load more. Tap to try again.</Text>
                </Pressable>
              ) : undefined
            }
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={refreshWithHaptic(list.refresh)} tintColor={P.accent} colors={[P.accent]} progressBackgroundColor={P.surface2} />}
          />
        )}
        <BuzzToastHost bottom={insets.bottom + 24} enabled={focused} />
      </View>
    </BuzzActionsHost>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.canvas },
  below: { gap: 10, paddingHorizontal: GUTTER, paddingBottom: 12 },
  box: { height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 10, borderRadius: R.pill, borderWidth: 2, borderColor: "transparent", backgroundColor: P.surface2 },
  boxFocused: { borderColor: P.accentLine },
  input: { flex: 1, color: P.ink, paddingVertical: 0 },
  filters: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  intro: { gap: 12, paddingHorizontal: GUTTER, paddingTop: 16 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cards: { paddingHorizontal: GUTTER, paddingTop: 12, gap: CARD_GAP },
  end: { alignItems: "center", paddingVertical: 20 },
});
