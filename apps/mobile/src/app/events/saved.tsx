import { useCallback } from "react";
import { FlatList, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { listSavedEvents, type EventSummary } from "@apartment-book/shared";
import { EventCard, useToggleSavedEvent } from "@/components/events/event-card";
import { RowGap } from "@/components/events/events-page";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { useCampusTimeZone } from "@/lib/campus-time-zone";
import { savedEvents } from "@/lib/event-saves-store";
import { refreshWithHaptic } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

/** The events the person saved, the most recently saved first; the bookmark on a row takes it off the list at the next look. */
export default function SavedEventsScreen() {
  const { user, profile } = useSession();
  const me = user?.id ?? null;
  const timeZone = useCampusTimeZone(profile?.university_id);
  const saved = savedEvents.useIds(me);
  const toggleSave = useToggleSavedEvent();
  const list = useQuery(() => (me ? listSavedEvents(supabase, me) : Promise.resolve([] as EventSummary[])), [me]);
  const { refresh } = list;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBanner message={list.error} onRetry={() => void refresh()} />;
  const rows = (list.data ?? []).filter((e) => saved.has(e.id));
  return (
    <FlatList
      data={rows}
      keyExtractor={(e) => e.id}
      renderItem={({ item }) => <EventCard event={item} timeZone={timeZone} saved={saved.has(item.id)} onToggleSave={toggleSave} />}
      ItemSeparatorComponent={RowGap}
      contentContainerStyle={{ paddingVertical: space.lg, flexGrow: 1 }}
      ListEmptyComponent={<EmptyState icon="bookmark-outline" title="No saved events" body="Tap the bookmark on an event to keep it here." />}
      refreshControl={<RefreshControl refreshing={list.loading && list.data !== null} onRefresh={refreshWithHaptic(() => void refresh())} />}
    />
  );
}
