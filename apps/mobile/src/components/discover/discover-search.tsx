import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { normalizeTopic, searchPeople, searchPostTiles, searchTopics, DISCOVER_PAGE, type DiscoverBlock, type PosterSummary, type ProfileTile } from "@apartment-book/shared";
import { useFollowStatsMany } from "@/components/follow-button";
import { PersonRow } from "@/components/person-row";
import { useOpenTile } from "@/components/profile/profile-tile";
import { useTileGrid, type GridCursor } from "@/components/profile/use-tile-grid";
import { Chip, EmptyState, ErrorBanner } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import type { ViewerOrigin } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useTabBarInset } from "@/lib/tab-bar";
import { DISCOVER_GAP, DiscoverBlockView, discoverTileWidth, rowsOf } from "./discover-grid";
import { TopicRow } from "./topic-row";

type Filter = "top" | "accounts" | "topics" | "posts";
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "accounts", label: "Accounts" },
  { value: "topics", label: "Topics" },
  { value: "posts", label: "Posts" },
];
/** How many people and topics "Top" shows before its "See all". */
const TOP_PEEK = 3;

type Item =
  | { type: "heading"; key: string; label: string; more?: Filter }
  | { type: "person"; key: string; person: PosterSummary }
  | { type: "topic"; key: string; tag: string; posts: number | null }
  | { type: "block"; key: string; block: DiscoverBlock };

/** Same array on every render while nothing has loaded, so the stats hook does not refetch for a fresh empty list. */
const NOBODY: PosterSummary[] = [];

/**
 * Discover's search results, like Instagram's: people (on every campus), topics and posts for what was typed, under Top
 * (a few of each, posts as a grid) | Accounts | Topics | Posts. A query starting with "#" puts topics first, and a tag
 * that nothing is ranked under yet still offers its page. `query` is already debounced.
 */
export function DiscoverSearch({ query }: { query: string }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const bottom = useTabBarInset();
  const { user } = useSession();
  const me = user?.id ?? null;
  const [filter, setFilter] = useState<Filter>("top");

  const people = useQuery(() => searchPeople(supabase, query, { limit: DISCOVER_PAGE.searchPeople, excludeIds: me ? [me] : [] }), [query, me]);
  const topics = useQuery(() => searchTopics(supabase, query), [query]);
  const posts = useTileGrid((cursor: GridCursor | null) => searchPostTiles(supabase, query, { cursor }), { resetKey: query, enabled: true });
  const found = people.data ?? NOBODY;
  const stats = useFollowStatsMany(found, me);

  const openTile = useOpenTile();
  const tiles = useRef(posts.tiles);
  tiles.current = posts.tiles;
  const onOpen = useCallback((tile: ProfileTile, origin?: ViewerOrigin) => openTile(tile, tiles.current, origin), [openTile]);
  const openTopic = useCallback((tag: string) => router.push({ pathname: "/topics/[tag]", params: { tag } }), [router]);
  const needLogin = useCallback(() => router.push("/(auth)/login"), [router]);
  const tileWidth = discoverTileWidth(width);

  const items = useMemo(() => {
    const typed = normalizeTopic(query);
    const tagFirst = query.trim().startsWith("#");
    const topicList = topics.data ?? [];
    // A tag typed in full that nothing is ranked under yet still gets its page, as Instagram offers one.
    const topicItems: Item[] = topicList.map((t) => ({ type: "topic", key: `t:${t.tag}`, tag: t.tag, posts: t.posts }));
    if (typed && !topicList.some((t) => t.tag === typed)) topicItems.unshift({ type: "topic", key: `t:${typed}`, tag: typed, posts: null });
    const personItems: Item[] = found.map((p) => ({ type: "person", key: `p:${p.id}`, person: p }));
    const blockItems: Item[] = rowsOf(posts.tiles).map((b) => ({ type: "block", key: b.key, block: b }));

    if (filter === "accounts") return personItems;
    if (filter === "topics") return topicItems;
    if (filter === "posts") return blockItems;
    const peopleSection: Item[] = personItems.length ? [{ type: "heading", key: "h:people", label: "Accounts", more: personItems.length > TOP_PEEK ? "accounts" : undefined }, ...personItems.slice(0, TOP_PEEK)] : [];
    const topicSection: Item[] = topicItems.length ? [{ type: "heading", key: "h:topics", label: "Topics", more: topicItems.length > TOP_PEEK ? "topics" : undefined }, ...topicItems.slice(0, TOP_PEEK)] : [];
    const postSection: Item[] = blockItems.length ? [{ type: "heading", key: "h:posts", label: "Posts" }, ...blockItems] : [];
    return tagFirst ? [...topicSection, ...peopleSection, ...postSection] : [...peopleSection, ...topicSection, ...postSection];
  }, [query, filter, found, topics.data, posts.tiles]);

  const renderItem = useCallback(
    ({ item }: { item: Item }): ReactElement => {
      switch (item.type) {
        case "heading":
          return (
            <View style={styles.heading}>
              <Text style={styles.headingText} accessibilityRole="header">
                {item.label}
              </Text>
              {item.more ? (
                <Pressable onPress={() => setFilter(item.more!)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${item.label.toLowerCase()}`}>
                  <Text style={styles.more}>See all</Text>
                </Pressable>
              ) : null}
            </View>
          );
        case "person":
          return <PersonRow person={item.person} stats={stats[item.person.id]} userId={me} onNeedLogin={needLogin} onPress={() => router.push({ pathname: "/profile/[id]", params: { id: item.person.id } })} />;
        case "topic":
          return <TopicRow tag={item.tag} posts={item.posts} onPress={() => openTopic(item.tag)} />;
        case "block":
          return <DiscoverBlockView block={item.block} tileWidth={tileWidth} onOpen={onOpen} />;
      }
    },
    [styles, stats, me, needLogin, router, openTopic, tileWidth, onOpen],
  );

  const loading = people.loading || topics.loading || posts.status !== "ready";
  const error = people.error ?? topics.error ?? posts.error;
  let footer: ReactElement | undefined;
  if ((filter === "top" || filter === "posts") && (posts.loadingMore || (posts.status !== "ready" && items.length > 0))) footer = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  else if (filter === "posts" && posts.moreError) footer = <ErrorBanner message={posts.moreError} onRetry={() => void posts.loadMore()} />;

  return (
    <View style={styles.screen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.filtersBar} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
        ))}
      </ScrollView>
      {error && !loading ? (
        <View style={styles.error}>
          <ErrorBanner message={error} onRetry={() => void Promise.all([people.refresh(), topics.refresh(), posts.refresh()])} />
        </View>
      ) : null}
      {/* Results from the last query stay up while the next one runs, so the list does not flash a spinner on every keystroke. */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ItemSeparatorComponent={BlockGap}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={filter === "posts" || filter === "top" ? () => void posts.loadMore() : undefined}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottom + space.lg }}
        ListFooterComponent={footer}
        ListEmptyComponent={loading ? <ActivityIndicator style={styles.spinner} color={colors.brand} /> : error ? undefined : <EmptyState icon="search-outline" title="No results" body={NO_RESULTS[filter]} />}
      />
    </View>
  );
}

const NO_RESULTS: Record<Filter, string> = {
  top: "Try a name, a #topic or a few words from a post.",
  accounts: "Try a different spelling of their name.",
  topics: "Try the start of a tag, like #finals.",
  posts: "Try other words, or fewer of them.",
};

/** The grid's gap between rows of squares (people and topic rows have their own padding). */
function BlockGap({ leadingItem }: { leadingItem?: Item }) {
  return leadingItem?.type === "block" ? <View style={{ height: DISCOVER_GAP }} /> : null;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  filtersBar: { flexGrow: 0 },
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  error: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  headingText: { fontSize: 15, fontWeight: "700", color: colors.text },
  more: { fontSize: 14, fontWeight: "600", color: colors.brand },
  spinner: { paddingVertical: space.lg },
}));
