import { Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { EventCategory, EventDateFilter } from "@apartment-book/shared";
import { EmptyState } from "@/components/ui";
import { space, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** What the Events tab hands each of its pages: the bar's filters, the campus and its clock, the list's place under the floating bar. */
export type EventsPageProps = {
  active: boolean;
  topInset: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  universityId: string | null;
  timeZone: string;
  q: string;
  dateFilter: EventDateFilter;
  category: EventCategory | null;
};

/** The room between two rows. */
export function RowGap() {
  return <View style={{ height: space.sm }} />;
}

/** The heading over a day's events in the All list ("Today", "Tomorrow", "Thu, Nov 12"); today in the brand colour. */
export function DayHeader({ label }: { label: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.day} accessibilityRole="header">
      <Text style={[styles.dayText, label === "Today" && { color: colors.brand }]}>{label}</Text>
    </View>
  );
}

/** Nothing to show: the words say whether a filter is in the way or the calendar is simply empty. */
export function EventsEmpty({ filtered, campus }: { filtered: boolean; campus: boolean }) {
  return <EmptyState icon="calendar-outline" title={filtered ? "No events match" : "Nothing on the calendar yet"} body={filtered ? "Try another day, category or word." : campus ? "Events from your campus's calendars and its clubs show up here as they are added." : "Join a campus to see its events."} />;
}

/** `starts_at` and `ends_at` filters as the database takes them. */
export const iso = (ms: number) => new Date(ms).toISOString();

const useStyles = makeStyles((colors) => ({
  day: { paddingHorizontal: space.lg + 4, paddingTop: space.lg, paddingBottom: space.sm },
  dayText: { ...textStyle.footnote, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
}));
