import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Keyboard, Platform, RefreshControl, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { campusShortName, ITEM_CATEGORIES, labelFor, listItems, type ItemCategoryValue, type ItemWithSeller } from "@apartment-book/shared";
import type { CampusChoice, CampusMenuRow } from "@/components/marketplace/campus-menu";
import { CategoryChips } from "@/components/marketplace/category-chips";
import { categoryIcon, MarketItemCard } from "@/components/marketplace/item-card";
import { MarketHeader } from "@/components/marketplace/market-header";
import { useItemLikes } from "@/components/marketplace/use-item-likes";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { hapticSelect } from "@/lib/haptics";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
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
 * The Marketplace tab: its own top bar ("+" to sell, "<campus> marketplace" with the campus menu, the magnifier that
 * searches items), the category pills, then a two-column grid of photo cards with a heart on each. The campus menu
 * switches between the person's university and every university; the pills and the search narrow the grid down
 * (listItems with q, universityId and category), a page at a time as it scrolls.
 */
export default function MarketplaceScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  const userId = user?.id ?? null;

  const myUniversity = profile?.university ?? null;
  const myUniversityId = profile?.university_id ?? null;
  const myCode = useMemo(() => campusShortName(myUniversity), [myUniversity]);
  const [campusPick, setCampusPick] = useState<CampusChoice>("mine");
  // Without a university of their own (or signed out) the person sees every campus.
  const campus: CampusChoice = myUniversityId ? campusPick : "all";
  const universityId = campus === "mine" ? (myUniversityId ?? undefined) : undefined;
  const title = !myUniversityId ? "Marketplace" : campus === "all" ? "All campuses" : myCode ? `${myCode} marketplace` : "Marketplace";

  const [category, setCategory] = useState<ItemCategoryValue | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");
  const typed = searchOpen ? text.trim() : "";
  const q = useSettled(typed, SEARCH_DELAY_MS);

  // Another category, campus or search empties the grid at once (its spinner shows) instead of keeping the old cards.
  const feed = useFeed<ItemWithSeller>((page) => listItems(supabase, { q: q || undefined, universityId, category: category ?? undefined, page, pageSize: PAGE_SIZE }), [q, universityId, category], { clearOnChange: true });
  const { liked, toggle: toggleLike, refresh: refreshLikes } = useItemLikes(feed.items, userId);

  // Another campus, category or search starts the grid from the top.
  const list = useRef<FlatList<ItemWithSeller>>(null);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [q, universityId, category]);

  // Coming back (from an item, say, where it may have been liked or unliked): read the hearts again. Not on the first visit.
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refreshLikes();
      visited.current = true;
    }, [refreshLikes]),
  );

  const campusRows = useMemo<CampusMenuRow[]>(() => {
    const rows: CampusMenuRow[] = [];
    if (myUniversityId) rows.push({ value: "mine", label: myUniversity?.name ?? "My university", icon: "school-outline", selected: campus === "mine" });
    rows.push({ value: "all", label: "All universities", icon: "globe-outline", selected: campus === "all" });
    return rows;
  }, [myUniversityId, myUniversity, campus]);

  const pickCampus = useCallback(
    (next: CampusChoice) => {
      if (next === campus) return;
      hapticSelect();
      setCampusPick(next);
    },
    [campus],
  );

  // The same selection tick as tapping the "All" pill.
  const showAllCategories = useCallback(() => {
    hapticSelect();
    setCategory(null);
  }, []);

  const sell = useCallback(() => router.push(user ? "/create/item" : "/(auth)/login"), [router, user]);
  const openItem = useCallback(
    (item: ItemWithSeller) => {
      Keyboard.dismiss();
      router.push({ pathname: "/marketplace/[id]", params: { id: item.id } });
    },
    [router],
  );

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const cancelSearch = useCallback(() => {
    setText("");
    setSearchOpen(false);
    Keyboard.dismiss();
  }, []);
  // Android's back button leaves the search before it leaves the tab.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !searchOpen) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        cancelSearch();
        return true;
      });
      return () => sub.remove();
    }, [searchOpen, cancelSearch]),
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
    const allCampuses = universityId ? <Button title="See all campuses" variant="secondary" onPress={() => pickCampus("all")} /> : undefined;
    if (q)
      return (
        <EmptyState
          icon="search-outline"
          title={`No results for “${q}”`}
          body={category ? `Nothing in ${categoryLabel}${where} matches. Try another word, or all categories.` : `Nothing for sale${where} matches. Try another word.`}
          action={category ? <Button title="Search all categories" variant="secondary" onPress={showAllCategories} /> : allCampuses}
        />
      );
    if (category) return <EmptyState icon={categoryIcon(category)} title="Nothing here yet" body={`Nobody is selling ${categoryLabel.toLowerCase()}${where} right now.`} action={allCampuses ?? <Button title="Sell an item" onPress={sell} />} />;
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
    <View style={styles.screen}>
      <MarketHeader
        title={title}
        campusRows={campusRows}
        onPickCampus={pickCampus}
        onSell={sell}
        searchOpen={searchOpen}
        query={text}
        onQueryChange={setText}
        onOpenSearch={openSearch}
        onCancelSearch={cancelSearch}
        searchBusy={typed !== q || (feed.loading && q.length > 0)}
      />
      <CategoryChips value={category} onChange={setCategory} />
      <FlatList
        ref={list}
        key={`grid-${columns}`}
        data={feed.items}
        extraData={liked}
        keyExtractor={(i) => i.id}
        numColumns={columns}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.grid, feed.items.length === 0 && styles.gridEmpty]}
        renderItem={renderItem}
        ListEmptyComponent={empty()}
        ListFooterComponent={footer()}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={onRefresh} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  grid: { paddingHorizontal: SIDE, paddingTop: 2, paddingBottom: 24, gap: GAP },
  gridRow: { gap: GAP },
  // An empty grid fills the screen, so its message sits in the middle.
  gridEmpty: { flexGrow: 1 },
  pad: { paddingVertical: SIDE },
  footer: { paddingVertical: 16 },
}));
