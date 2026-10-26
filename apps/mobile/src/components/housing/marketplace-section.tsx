import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, View, type ListViewToken, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { campusShortName, isVerifiedPoster, ITEM_CATEGORIES, labelFor, listingMedia, listItems, videosFor, type ItemCategoryValue, type ItemWithSeller, type PostEngagement } from "@apartment-book/shared";
import type { MarketFilters } from "@/components/housing/filter-sheet";
import type { CampusChoice } from "@/components/marketplace/campus-menu";
import { categoryIcon, priceText } from "@/components/marketplace/item-text";
import { PostCard } from "@/components/post-card";
import { Button, EmptyState, ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useTabReselect } from "@/lib/tab-reselect";
import { useEngagement } from "@/lib/use-engagement";
import { refreshWithHaptic } from "@/lib/haptics";

const PAGE_SIZE = 20;
/** Room around the empty and error states. */
const SIDE = 12;
/** The feed searches once typing pauses this long. */
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
 * One item, captioned as a roommate post and a Buzz post are (see PostCard): the seller, the price and when it was
 * posted under their name, the item's name in bold and the start of its description, then the photos and the video
 * large and swipeable, and the heart, share, Inbox and the bookmark under them. The condition, category and pickup place
 * are on the item's own page (a tap on the words or the picture opens it; its comments are there too). Memoised: only a
 * row whose item, save or counts changed draws again as the feed scrolls and loads.
 */
const MarketplaceRow = memo(function MarketplaceRow({ item, saved, engagement, playing }: { item: ItemWithSeller; saved: boolean; engagement: PostEngagement | undefined; playing: boolean }) {
  const price = priceText(item);
  return (
    // A tap anywhere on the row puts the search keyboard away first, as opening an item from the grid did.
    <View onTouchEnd={Keyboard.dismiss}>
      <PostCard
        active={playing}
        targetType="item"
        targetId={item.id}
        path={`/marketplace/${item.id}`}
        poster={{ id: item.seller.id, name: item.seller.full_name, avatarUrl: item.seller.avatar_url, verified: isVerifiedPoster(item.seller) }}
        // Everyone here is at the same university: under the name, the price instead ("$65 · 3h", "Free · 2d").
        subtitle={price}
        title={item.title}
        lead={price}
        description={item.description}
        // Heart, share, Inbox and the bookmark, as on a roommate post: the comments are on the item's own page.
        messageLabel="Inbox"
        messageBeside
        comments={false}
        media={listingMedia(item.images, item.image_meta, item.videos)}
        createdAt={item.created_at}
        saved={saved}
        engagement={engagement}
      />
    </View>
  );
});

/**
 * The Marketplace page of the Explore tab: the items for sale as posts, laid out as the roommate posts are (see
 * MarketplaceRow), starting `topInset` under the floating labels and pills and reporting its scroll through `onScroll`,
 * a page at a time as it scrolls (listItems with q, universityId and category). One video plays at a time, muted, the
 * first item on screen that has one. The search (`q`, applied once typing pauses), the campus and the category come from
 * the Explore screen's own bar, which also owns the "+" (Sell an item); an empty feed hands a wider choice back through
 * `onCategoryChange`, and `onSearchBusy` says while the feed is still catching up with the words (the bar then shows a
 * spinner in place of the search box's magnifier).
 */
export function MarketplaceSection({
  topInset,
  onScroll,
  q,
  campus,
  category,
  onCategoryChange,
  onSearchBusy,
  filters,
  filtered,
  active = true,
}: {
  topInset: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  q: string;
  campus: CampusChoice;
  category: ItemCategoryValue | null;
  onCategoryChange: (category: ItemCategoryValue | null) => void;
  onSearchBusy?: (busy: boolean) => void;
  /** The filter sheet's choices for this page: sort, condition and price. */
  filters: MarketFilters;
  filtered: boolean;
  /** The page on screen: only then does a tap on the Explore tab scroll it back to the top. */
  active?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { user, profile } = useSession();
  const userId = user?.id ?? null;

  const myUniversity = profile?.university ?? null;
  const myUniversityId = profile?.university_id ?? null;
  const myCode = useMemo(() => campusShortName(myUniversity), [myUniversity]);
  // Without a university of their own (or signed out) the person sees every campus.
  const universityId = campus === "mine" ? (myUniversityId ?? undefined) : undefined;

  const typed = q.trim();
  const settled = useSettled(typed, SEARCH_DELAY_MS);

  // Another category, campus or search empties the feed at once (its spinner shows) instead of keeping the old posts.
  const feed = useFeed<ItemWithSeller>((page) => listItems(supabase, { q: settled || undefined, universityId, category: category ?? undefined, page, pageSize: PAGE_SIZE, sort: filters.sort, condition: filters.condition, minPrice: filters.minPrice, maxPrice: filters.maxPrice }), [settled, universityId, category, filters.sort, filters.condition, filters.minPrice, filters.maxPrice], { clearOnChange: true });
  const { savedIds, engagement, refresh: refreshEngagement } = useEngagement("item", feed.items, userId);
  // The feed starts under the floating labels and pills and scrolls beneath them as they slide away.
  const inset = useMemo(() => listInset(topInset), [topInset]);
  const tabBar = useTabBarInset();

  // The bar's magnifier becomes a spinner while the feed catches up with the words.
  const busy = typed !== settled || (feed.loading && settled.length > 0);
  useEffect(() => {
    onSearchBusy?.(busy);
  }, [busy, onSearchBusy]);

  // Another campus, category or search starts the feed from the top.
  const list = useRef<FlatList<ItemWithSeller>>(null);
  // Rows fade in once as they first arrive (not when scrolled back into view).
  const appearCells = useAppearingCells();
  // Tapping Explore again while the Marketplace is on screen: back to the top.
  useTabReselect(() => list.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: inset.topOffset, animated: false });
  }, [settled, universityId, category, filters, inset.topOffset]);

  // Coming back (from an item, say, where it may have been liked, unliked or saved): read the counts again. Not on the
  // first visit.
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refreshEngagement();
      visited.current = true;
    }, [refreshEngagement]),
  );
  // One video plays at a time, the first item on screen (at least 60% of it) that has one, and only while this page of
  // Explore is the one shown: sound is one switch for every video, so two playing at once would both be heard.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && videosFor((v.item as ItemWithSeller).videos).length > 0);
    setPlayingId(first ? String(first.key) : null);
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const sell = useCallback(() => router.push(user ? "/create/item" : "/(auth)/login"), [router, user]);

  const onRefresh = useCallback(() => {
    feed.refresh();
    refreshEngagement();
  }, [feed.refresh, refreshEngagement]);

  const renderItem = useCallback(
    ({ item }: { item: ItemWithSeller }) => <MarketplaceRow item={item} saved={savedIds.has(item.id)} engagement={engagement[item.id]} playing={active && playingId === item.id} />,
    [savedIds, engagement, active, playingId],
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
    if (filtered) return <EmptyState icon="search-outline" title="Nothing matches" body={`Nothing${category ? ` in ${categoryLabel}` : ""}${where} fits these filters. Try fewer.`} />;
    if (category) return <EmptyState icon={categoryIcon(category)} title="Nothing here yet" body={`Nobody is selling ${categoryLabel.toLowerCase()}${where} right now.`} action={<Button title="Sell an item" onPress={sell} />} />;
    return <EmptyState icon="bag-handle-outline" title="Nothing for sale yet" body="Moving out? Sell your mattress, desk or textbooks here." action={<Button title="Sell an item" onPress={sell} />} />;
  }

  function footer() {
    if (feed.items.length === 0) return undefined;
    // A page that failed to load (or a refresh that failed) keeps the posts above it on screen.
    if (feed.error)
      return (
        <View style={styles.footer}>
          <ErrorBanner message={feed.error} onRetry={feed.hasMore ? feed.loadMore : feed.refresh} />
        </View>
      );
    return feed.hasMore ? <ActivityIndicator style={styles.footer} color={colors.muted} /> : undefined;
  }

  return (
    <View style={styles.page}>
      <AnimatedFlatList
        ref={list}
        data={feed.items}
        keyExtractor={(i) => i.id}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // As the roommate feed: room for the "+" button and the tab bar at the end.
        contentContainerStyle={[{ paddingTop: 2 + inset.paddingTop, paddingBottom: 90 + tabBar }, feed.items.length === 0 && styles.feedEmpty]}
        CellRendererComponent={appearCells}
        renderItem={renderItem}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        windowSize={9}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        ListEmptyComponent={empty()}
        ListFooterComponent={footer()}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(onRefresh)} progressViewOffset={inset.progressViewOffset} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  page: { flex: 1 },
  // An empty feed fills the screen, so its message sits in the middle.
  feedEmpty: { flexGrow: 1 },
  pad: { padding: SIDE },
  footer: { paddingVertical: 16, paddingHorizontal: SIDE },
}));
