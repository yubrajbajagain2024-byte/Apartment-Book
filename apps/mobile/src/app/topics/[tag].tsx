import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getTopic, listTopicTiles, normalizeTopic, topicCount, topicLabel, type DiscoverBlock, type ProfileTile } from "@apartment-book/shared";
import { DISCOVER_GAP, DiscoverBlockView, discoverTileWidth, rowsOf } from "@/components/discover/discover-grid";
import { useOpenTile } from "@/components/profile/profile-tile";
import { useTileGrid, type GridCursor } from "@/components/profile/use-tile-grid";
import { Chip, EmptyState, ErrorBanner } from "@/components/ui";
import { refreshWithHaptic } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import type { ViewerOrigin } from "@/lib/reel-viewer";
import { supabase } from "@/lib/supabase";
import { space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

type Order = "top" | "recent";

/**
 * A topic's page (a #tag tapped in a caption, Discover's Trending row or its search): the tag, how many posts carry it,
 * and their grid from every campus, the hottest first or the newest first, as Instagram's hashtag pages. Squares open
 * the viewer with the rest of the grid to swipe through.
 */
export default function TopicScreen() {
  const params = useLocalSearchParams<{ tag?: string }>();
  const tag = normalizeTopic(String(params.tag ?? ""));
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [order, setOrder] = useState<Order>("top");
  const head = useQuery(() => (tag ? getTopic(supabase, tag) : Promise.resolve(null)), [tag]);
  const grid = useTileGrid((cursor: GridCursor | null) => listTopicTiles(supabase, tag ?? "", { order, cursor }), { resetKey: `${tag ?? ""}:${order}`, enabled: tag !== null });

  const openTile = useOpenTile();
  const tiles = useRef(grid.tiles);
  tiles.current = grid.tiles;
  const onOpen = useCallback((tile: ProfileTile, origin?: ViewerOrigin) => openTile(tile, tiles.current, origin), [openTile]);
  const tileWidth = discoverTileWidth(width);
  const rows = useMemo(() => rowsOf(grid.tiles), [grid.tiles]);
  const renderRow = useCallback(({ item }: { item: DiscoverBlock }) => <DiscoverBlockView block={item} tileWidth={tileWidth} onOpen={onOpen} />, [tileWidth, onOpen]);

  const [refreshing, setRefreshing] = useState(false);
  const { refresh: refreshGrid } = grid;
  const { refresh: refreshHead } = head;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshGrid(), refreshHead()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshGrid, refreshHead]);

  if (!tag) {
    return (
      <>
        <Stack.Screen options={{ title: "Topic" }} />
        <EmptyState icon="pricetag-outline" title="Not a topic" body="Topics are #tags of letters, numbers and _, like #finals." />
      </>
    );
  }

  const posts = head.data?.posts ?? null;
  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
        {topicLabel(tag)}
      </Text>
      {posts !== null ? <Text style={styles.count}>{topicCount(posts)}</Text> : null}
      <View style={styles.orders}>
        <Chip label="Top" icon="flame-outline" active={order === "top"} onPress={() => setOrder("top")} />
        <Chip label="Recent" icon="time-outline" active={order === "recent"} onPress={() => setOrder("recent")} />
      </View>
    </View>
  );

  let footer: ReactElement | undefined;
  if (grid.status !== "ready" || grid.loadingMore) footer = <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  else if (grid.error || grid.moreError) footer = <View style={styles.notice}><ErrorBanner message={(grid.error ?? grid.moreError)!} onRetry={() => void (grid.error ? grid.refresh() : grid.loadMore())} /></View>;
  else if (grid.tiles.length === 0) footer = <EmptyState icon="pricetag-outline" title={`No posts with ${topicLabel(tag)} yet`} body="Add it to a post's caption and it shows up here for every campus." />;

  return (
    <>
      <Stack.Screen options={{ title: topicLabel(tag) }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onEndReached={() => void grid.loadMore()}
        onEndReachedThreshold={0.8}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshWithHaptic(() => void onRefresh())} />}
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}
      />
    </>
  );
}

function RowGap() {
  return <View style={{ height: DISCOVER_GAP }} />;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: space.xs },
  title: { ...textStyle.title1, color: colors.text },
  count: { fontSize: 15, color: colors.muted },
  orders: { flexDirection: "row", gap: space.sm, paddingTop: space.sm },
  notice: { paddingHorizontal: space.lg, paddingTop: space.md },
  spinner: { paddingVertical: space.xl },
}));
