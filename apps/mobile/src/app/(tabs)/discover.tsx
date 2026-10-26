import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, RefreshControl, Text, TextInput, View, useWindowDimensions, type TextInputInstance } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { discoverMosaic, listDiscoverAccounts, listDiscoverTiles, listTrendingTopics, type DiscoverAccount, type DiscoverBlock, type ProfileTile } from "@apartment-book/shared";
import { DiscoverSearch } from "@/components/discover/discover-search";
import { DISCOVER_GAP, DiscoverBlockView, discoverTileWidth } from "@/components/discover/discover-grid";
import { SuggestedAccounts } from "@/components/discover/suggested-accounts";
import { TrendingTopics } from "@/components/discover/topic-row";
import { useFollowStatsMany } from "@/components/follow-button";
import { Icon } from "@/components/icon";
import { useOpenTile } from "@/components/profile/profile-tile";
import { useTileGrid, type GridCursor } from "@/components/profile/use-tile-grid";
import { Chip, EmptyState, ErrorBanner } from "@/components/ui";
import { refreshWithHaptic } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import type { ViewerOrigin } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

type Scope = "everywhere" | "campus";
type Item = { type: "block"; key: string; block: DiscoverBlock } | { type: "accounts"; key: string };

/** "Suggested for you" comes after this many blocks of the grid, a little way down, as on Instagram. */
const ACCOUNTS_AFTER = 2;
/** Same array on every render while nothing has loaded, so the stats hook does not refetch for a fresh empty list. */
const NOBODY: DiscoverAccount[] = [];

/**
 * Discover, the second tab: Instagram's search tab for every campus at once. The box at the top finds people, topics
 * and posts (DiscoverSearch, once something is typed); under it, what is popular: trending topics, then the posts and
 * reels with the most going on lately, laid out as Instagram's Explore grid (a tall tile beside four squares, then a
 * row of three), with accounts to follow from every university a little way down. Everywhere by default; your own
 * campus at a tap. The rankings come from the database (migration 44, refreshed every 10 minutes), so the grid reloads
 * quietly when the tab comes back; a tap on the tab you are on scrolls back to the top. Works signed out.
 */
export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const bottom = useTabBarInset();
  const { user, profile } = useSession();
  const me = user?.id ?? null;
  const campusId = profile?.university_id ?? null;
  const campusName = profile?.university?.name ?? null;

  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const cancel = useCallback(() => {
    setText("");
    setQuery("");
    input.current?.blur();
    Keyboard.dismiss();
  }, []);

  const [scope, setScope] = useState<Scope>("everywhere");
  const universityId = scope === "campus" ? campusId : null;
  const grid = useTileGrid((cursor: GridCursor | null) => listDiscoverTiles(supabase, { universityId, cursor }), { resetKey: `${universityId ?? "everywhere"}:${me ?? ""}`, enabled: true });
  const topics = useQuery(() => listTrendingTopics(supabase), [me]);
  const accounts = useQuery(() => listDiscoverAccounts(supabase, { universityId, viewerId: me }), [universityId, me]);
  const people = accounts.data ?? NOBODY;
  const stats = useFollowStatsMany(people, me);

  const { quietRefresh } = grid;
  useFocusEffect(useCallback(() => quietRefresh(), [quietRefresh]));
  const list = useRef<FlatList<Item>>(null);
  useTabReselect(() => list.current?.scrollToOffset({ offset: 0, animated: true }));

  const [refreshing, setRefreshing] = useState(false);
  const { refresh: refreshGrid } = grid;
  const { refresh: refreshTopics } = topics;
  const { refresh: refreshAccounts } = accounts;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshGrid(), refreshTopics(), refreshAccounts()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshGrid, refreshTopics, refreshAccounts]);

  const openTile = useOpenTile();
  // Read when a tile is tapped, so the blocks do not all draw again each time a page arrives.
  const tiles = useRef(grid.tiles);
  tiles.current = grid.tiles;
  const onOpen = useCallback((tile: ProfileTile, origin?: ViewerOrigin) => openTile(tile, tiles.current, origin), [openTile]);
  const openTopic = useCallback((tag: string) => router.push({ pathname: "/topics/[tag]", params: { tag } }), [router]);
  const openProfile = useCallback((id: string) => router.push({ pathname: "/profile/[id]", params: { id } }), [router]);
  const needLogin = useCallback(() => router.push("/(auth)/login"), [router]);
  const tileWidth = discoverTileWidth(width);

  const items = useMemo(() => {
    const out: Item[] = discoverMosaic(grid.tiles).map((block) => ({ type: "block", key: block.key, block }));
    // With no posts yet the suggestions still show: on a young campus they are what there is to discover.
    if (people.length > 0) out.splice(Math.min(ACCOUNTS_AFTER, out.length), 0, { type: "accounts", key: "accounts" });
    return out;
  }, [grid.tiles, people.length]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === "block" ? <DiscoverBlockView block={item.block} tileWidth={tileWidth} onOpen={onOpen} /> : <SuggestedAccounts accounts={people} stats={stats} userId={me} onNeedLogin={needLogin} onOpen={openProfile} />,
    [tileWidth, onOpen, people, stats, me, needLogin, openProfile],
  );

  const header = (
    <View style={styles.header}>
      {campusId && campusName ? (
        <View style={styles.scopes}>
          <Chip label="Everywhere" icon="globe-outline" active={scope === "everywhere"} onPress={() => setScope("everywhere")} />
          <Chip label={campusName} icon="school-outline" active={scope === "campus"} onPress={() => setScope("campus")} />
        </View>
      ) : null}
      <TrendingTopics topics={topics.data ?? []} onOpen={openTopic} />
    </View>
  );

  let footer: ReactElement | undefined;
  if (grid.status !== "ready" || grid.loadingMore) footer = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  else if (grid.tiles.length === 0)
    footer = grid.error ? (
      <View style={styles.notice}>
        <ErrorBanner message={grid.error} onRetry={() => void grid.refresh()} />
      </View>
    ) : (
      <EmptyState icon="compass-outline" title="Nothing to discover yet" body={scope === "campus" ? "Nobody at your campus has posted lately. See what's happening everywhere." : "Posts and reels from every campus show up here as people share them."} />
    );
  else if (grid.error) footer = <View style={styles.notice}><ErrorBanner message={grid.error} onRetry={() => void grid.refresh()} /></View>;
  else if (grid.moreError) footer = <View style={styles.notice}><ErrorBanner message={grid.moreError} onRetry={() => void grid.loadMore()} /></View>;

  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Search people, topics and posts"
              placeholderTextColor={colors.faint}
              keyboardAppearance={isDark ? "dark" : "light"}
              accessibilityLabel="Search people, topics and posts"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={styles.input}
            />
          </View>
          {focused || text ? (
            <Pressable onPress={cancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel search">
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {query ? (
        <DiscoverSearch query={query} />
      ) : (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          ItemSeparatorComponent={BlockGap}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          onEndReached={() => void grid.loadMore()}
          onEndReachedThreshold={0.8}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void onRefresh())} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottom + space.lg }}
        />
      )}
    </View>
  );
}

/** The grid's gap under a block (the suggestions bring their own room). */
function BlockGap({ leadingItem }: { leadingItem?: Item }) {
  return leadingItem?.type === "block" ? <View style={{ height: DISCOVER_GAP }} /> : null;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar, zIndex: 2 },
  // The inbox's box: a 46pt pill with 12pt above and below.
  searchRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  search: { flex: 1, height: 46, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 16, fontWeight: "600", color: colors.brand },
  header: { paddingBottom: space.md, gap: space.sm },
  // Wraps rather than running off the screen when the campus has a long name.
  scopes: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg },
  notice: { paddingHorizontal: space.lg, paddingTop: space.md },
  spinner: { paddingVertical: space.xl },
}));
