import { useCallback, useMemo, useRef } from "react";
import { RefreshControl, Text, View, type FlatList } from "react-native";
import { EVENTS_PAGE_SIZE, eventDateRange, groupEventsByDay, listEvents, type EventSummary } from "@apartment-book/shared";
import { ErrorBanner, Loading, useAppearingCells } from "@/components/ui";
import { AnimatedFlatList, listInset } from "@/lib/collapsing-header";
import { savedEvents } from "@/lib/event-saves-store";
import { refreshWithHaptic } from "@/lib/haptics";
import { useFeed } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { useTabReselect } from "@/lib/tab-reselect";
import { useColors } from "@/lib/theme-provider";
import { EventCard, useToggleSavedEvent } from "./event-card";
import { DayHeader, EventsEmpty, iso, RowGap, type EventsPageProps } from "./events-page";

type Row = { type: "day"; key: string; label: string } | { type: "event"; key: string; event: EventSummary };

/**
 * All events, the Events tab's second page: everything the campus has coming, in time order, under one heading per
 * day on the campus's clock, a page at a time from the database (the bar's date pill, category and search narrow it).
 * The rows on screen stay while a new filter loads, so the page never blinks white.
 */
export function AllEventsSection({ active, topInset, onScroll, universityId, timeZone, q, dateFilter, category }: EventsPageProps) {
  const colors = useColors();
  const { user } = useSession();
  const saved = savedEvents.useIds(user?.id ?? null);
  const toggleSave = useToggleSavedEvent();
  const feed = useFeed<EventSummary>(
    async (page) => {
      const range = eventDateRange(dateFilter, Date.now(), timeZone);
      const data = await listEvents(supabase, { universityId, from: iso(range.from), to: iso(range.to), category, q: q || undefined, limit: EVENTS_PAGE_SIZE, offset: (page - 1) * EVENTS_PAGE_SIZE });
      // The database does not count: a short page is the last one.
      return { data, totalPages: data.length < EVENTS_PAGE_SIZE ? page : page + 1 };
    },
    [universityId, timeZone, q, dateFilter, category],
  );
  const inset = useMemo(() => listInset(topInset), [topInset]);
  const listRef = useRef<FlatList<Row>>(null);
  const appearCells = useAppearingCells();
  const tabBar = useTabBarInset();
  useTabReselect(() => listRef.current?.scrollToOffset({ offset: inset.topOffset, animated: true }), active);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groupEventsByDay(feed.items, timeZone, Date.now())) {
      out.push({ type: "day", key: `day:${group.key}`, label: group.label });
      for (const e of group.events) out.push({ type: "event", key: e.id, event: e });
    }
    return out;
  }, [feed.items, timeZone]);
  const renderItem = useCallback(({ item }: { item: Row }) => (item.type === "day" ? <DayHeader label={item.label} /> : <EventCard event={item.event} timeZone={timeZone} withDay={false} saved={saved.has(item.event.id)} onToggleSave={toggleSave} />), [timeZone, saved, toggleSave]);
  const filtered = Boolean(q) || category !== null || dateFilter !== "any";

  return (
    <View style={{ flex: 1 }}>
      <AnimatedFlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        {...inset.list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 90 + tabBar, paddingTop: inset.paddingTop }}
        CellRendererComponent={appearCells}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        windowSize={9}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={feed.loading ? <Loading /> : feed.error ? <View style={{ paddingHorizontal: 16 }}><ErrorBanner message={feed.error} onRetry={feed.refresh} /></View> : <EventsEmpty filtered={filtered} campus={Boolean(universityId)} />}
        ListFooterComponent={feed.items.length > 0 && feed.hasMore ? <Text style={{ textAlign: "center", color: colors.faint, padding: 12 }}>Loading more…</Text> : undefined}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refreshWithHaptic(feed.refresh)} progressViewOffset={inset.progressViewOffset} />}
      />
    </View>
  );
}

/** A gap between two event rows; a day heading brings its own room. */
function Gap({ leadingItem }: { leadingItem?: Row }) {
  return leadingItem?.type === "event" ? <RowGap /> : null;
}
