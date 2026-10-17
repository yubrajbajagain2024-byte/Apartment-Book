import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { campusShortName, ITEM_CATEGORIES, labelFor, listItems, type ItemCategoryValue, type ItemWithSeller } from "@apartment-book/shared";
import type { CampusChoice } from "@/components/marketplace/campus-menu";
import { categoryIcon, MarketItemCard } from "@/components/marketplace/item-card";
import { useItemLikes } from "@/components/marketplace/use-item-likes";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { makeStyles, useColors } from "@/lib/theme-provider";

const PAGE_SIZE = 20;
/** Space at the sides of the grid and between its cards. */
const SIDE = 12;
const GAP = 12;
/** The grid searches once typing pauses this long. */
const SEARCH_DELAY_MS = 300;

/** `text` once it has stopped changing for `ms`; clearing it applies at once. */
function useSettled(text: string, ms: number): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    if (!text) {
      setSettled("");
      return;
    }
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

/**
 * The Marketplace page of the Explore tab (the old Marketplace tab's grid, unchanged): a two-column grid of photo cards
 * with a heart on each, starting `topInset` under the floating labels and pills and reporting its scroll through
 * `onScroll`, a page at a time as it scrolls (listItems with q, universityId and category). The search (`q`, applied
 * once typing pauses), the campus and the category come from the Explore screen's own bar, which also owns the "+"
 * (Sell an item); an empty grid hands a wider choice back through `onCategoryChange`, and
 * `onSearchBusy` says while the grid is still catching up with the words (the bar then shows a spinner in place of the
 * search box's magnifier).
 */
export function MarketplaceSection({
  topInset,
  onScroll,
  q,
  campus,
  category,
  onCategoryChange,
  onSearchBusy,
}: {
  topInset: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  q: string;
  campus: CampusChoice;
  category: ItemCategoryValue | null;
  onCategoryChange: (category: ItemCategoryValue | null) => void;
  onSearchBusy?: (busy: boolean) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  const userId = user?.id ?? null;

  const myUniversity = profile?.university ?? null;
  const myUniversityId = profile?.university_id ?? null;
  const myCode = useMemo(() => campusShortName(myUniversity), [myUniversity]);
  // Without a university of their own (or signed out) the person sees every campus.
  const universityId = campus === "mine" ? (myUniversityId ?? undefined) : undefined;

  const typed = q.trim();
  const settled = useSettled(typed, SEARCH_DELAY_MS);

  // Another category, campus or search empties the grid at once (its spinner shows) instead of keeping the old cards.
  const feed = useFeed<ItemWithSeller>((page) => listItems(supabase, { q: settled || undefined, universityId, category: category ?? undefined, page, pageSize: PAGE_SIZE }), [settled, universityId, category], { clearOnChange: true });
  const { liked, toggle: toggleLike, refresh: refreshLikes } = useItemLikes(feed.items, userId);
  // The grid starts under the floating labels and pills and scrolls beneath them as they slide away.
  const inset = useMemo(() => listInset(topInset), [topInset]);
  const tabBar = useTabBarInset();

  // The bar's magnifier becomes a spinner while the grid catches up with the words.
  const busy = typed !== settled || (feed.loading && settled.length > 0);
  useEffect(() => {
    onSearchBusy?.(busy);
  }, [busy, onSearchBusy]);

  // Another campus, category or search starts the grid from the top.
  const list = useRef<FlatList<ItemWithSeller>>(null);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: inset.topOffset, animated: false });
  }, [settled, universityId, category, inset.topOffset]);

  // Coming back (from an item, say, where it may have been liked or unliked): read the hearts again. Not on the first visit.
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refreshLikes();
      visited.current = true;
    }, [refreshLikes]),
  );

  const sell = useCallback(() => router.push(user ? "/create/item" : "/(auth)/login"), [router, user]);
  const openItem = useCallback(
    (item: ItemWithSeller) => {
      Keyboard.dismiss();
      router.push({ pathname: "/marketplace/[id]", params: { id: item.id } });
    },
    [router],
  );

  const onRefresh = useCallback(() => {
    feed.refresh();
    refreshLikes();
  }, [feed.refresh, refreshLikes]);

  // The campus pin on each card. An item's university comes with its name only; the person's own also has its email domain.
  const campusOf = useCallback((u: ItemWithSeller["university"]) => (!u ? "" : myUniversity && u.id === myUniversity.id ? myCode : campusShortName(u)), [myUniversity, myCode]);

  // Two columns on phones; more on a tablet or a wide browser window, so the cards stay card-sized.
  const columns = width >= 1000 ? 4 : width >= 680 ? 3 : 2;
  const cardWidth = Math.floor((width - SIDE * 2 - GAP * (columns - 1)) / columns);

  const renderItem = useCallback(
    ({ item }: { item: ItemWithSeller }) => <MarketItemCard item={item} width={cardWidth} campus={campusOf(item.university)} liked={liked[item.id] ?? false} onOpen={openItem} onToggleLike={toggleLike} />,
    [cardWidth, campusOf, liked, openItem, toggleLike],
  );

  function empty() {
    if (feed.loading) return <Loading />;
    if (feed.error)
      return (
        <View style={styles.pad}>
          <ErrorBanner message={feed.error} onRetry={feed.refresh} />
        </View>
      );
    const categoryLabel = category ? labelFor(ITEM_CATEGORIES, category) : "";
    const where = universityId ? ` at ${myCode || "your campus"}` : "";
    if (settled)
      return (
        <EmptyState
          icon="search-outline"
          title={`No results for “${settled}”`}
          body={category ? `Nothing in ${categoryLabel}${where} matches. Try another word, or all categories.` : `Nothing for sale${where} matches. Try another word.`}
          action={category ? <Button title="Search all categories" variant="secondary" onPress={() => onCategoryChange(null)} /> : undefined}
        />
      );
    if (category) return <EmptyState icon={categoryIcon(category)} title="Nothing here yet" body={`Nobody is selling ${categoryLabel.toLowerCase()}${where} right now.`} action={<Button title="Sell an item" onPress={sell} />} />;
    return <EmptyState icon="bag-handle-outline" title="Nothing for sale yet" body="Moving out? Sell your mattress, desk or textbooks here." action={<Button title="Sell an item" onPress={sell} />} />;
  }

  function footer() {
    if (feed.items.length === 0) return null;
    // A page that failed to load (or a refresh that failed) keeps the cards above it on screen.
    if (feed.error)
      return (
        <View style={styles.footer}>
          <ErrorBanner message={feed.error} onRetry={feed.hasMore ? feed.loadMore : feed.refresh} />
        </View>
      );
    return feed.hasMore ? <ActivityIndicator style={styles.footer} color={colors.muted} /> : null;
  }

  return (
    <View style={styles.page}>
      <AnimatedFlatList
        ref={list}
        key={`grid-${columns}`}
        data={feed.items}
        extraData={liked}
        keyExtractor={(i) => i.id}
        numColumns={columns}
        columnWrapperStyle={styles.gridRow}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.grid, { paddingTop: 2 + inset.paddingTop, paddingBottom: 24 + tabBar }, feed.items.length === 0 && styles.gridEmpty]}
        renderItem={renderItem}
        ListEmptyComponent={empty()}
        ListFooterComponent={footer()}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={onRefresh} progressViewOffset={inset.progressViewOffset} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  page: { flex: 1 },
  grid: { paddingHorizontal: SIDE, paddingTop: 2, paddingBottom: 24, gap: GAP },
  gridRow: { gap: GAP },
  // An empty grid fills the screen, so its message sits in the middle.
  gridEmpty: { flexGrow: 1 },
  pad: { paddingVertical: SIDE },
  footer: { paddingVertical: 16 },
}));
