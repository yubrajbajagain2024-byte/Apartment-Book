import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EVENT_CATEGORIES, EVENT_DATE_FILTERS, type EventCategory, type EventDateFilter } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { categoryIcon } from "./event-glyphs";

/** What narrows the Events tab beyond its search box: when, and which types of event (any of them; none is every type). */
export type EventFilterChoice = { dateFilter: EventDateFilter; categories: readonly EventCategory[] };
export const DEFAULT_EVENT_FILTERS: EventFilterChoice = { dateFilter: "any", categories: [] };

/** How many choices differ from the defaults: the badge on the filter button. Each event type picked counts. */
export function eventFilterCount(choice: EventFilterChoice): number {
  return (choice.dateFilter === DEFAULT_EVENT_FILTERS.dateFilter ? 0 : 1) + choice.categories.length;
}

/** The types in EVENT_CATEGORIES' order, whatever order they were tapped in, so the query and the badge read the same. */
function ordered(picked: ReadonlySet<EventCategory>): EventCategory[] {
  return EVENT_CATEGORIES.map((c) => c.value).filter((v) => picked.has(v));
}

/**
 * The sheet behind the filter button beside the Events search box, the Marketplace's filter sheet for events: When
 * (Upcoming, Today, This week, Weekend: one of them) and Event type (Academic, Career, Social, Sports, Music, Arts and the
 * rest: any number, each with its glyph). Choices are drafted here and sent on "Show results"; Reset puts the defaults
 * back. Both pages of the tab, For you and All events, show the result.
 */
export function EventFilterSheet({ open, value, onApply, onClose }: { open: boolean; value: EventFilterChoice; onApply: (next: EventFilterChoice) => void; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const [when, setWhen] = useState<EventDateFilter>(value.dateFilter);
  const [types, setTypes] = useState<ReadonlySet<EventCategory>>(() => new Set(value.categories));
  // A fresh draft each time the sheet opens, from what is in force.
  useEffect(() => {
    if (!open) return;
    setWhen(value.dateFilter);
    setTypes(new Set(value.categories));
  }, [open, value]);
  const changed = when !== DEFAULT_EVENT_FILTERS.dateFilter || types.size > 0;
  function toggle(category: EventCategory) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const chip = (key: string, label: string, selected: boolean, onPress: () => void, icon?: IconName) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { opacity: 0.7 }]}>
      {icon ? <Icon name={icon} size={15} color={selected ? colors.brand : colors.muted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      {/* An event type is one of several picked: a tick says so. When is a single choice, its fill is enough. */}
      {selected && icon ? <Icon name="checkmark" size={14} color={colors.brand} /> : null}
    </Pressable>
  );

  return (
    <Sheet visible={open} onClose={onClose} closeLabel="Close filters" maxHeight="86%">
      <SheetHeader
        title="Filter events"
        leading={
          changed ? (
            <Pressable
              onPress={() => {
                setWhen(DEFAULT_EVENT_FILTERS.dateFilter);
                setTypes(new Set());
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.reset}>Reset</Text>
            </Pressable>
          ) : null
        }
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.group}>When</Text>
        <View style={styles.chips}>{EVENT_DATE_FILTERS.map((f) => chip(f.value, f.label, when === f.value, () => setWhen(f.value)))}</View>
        <View style={styles.groupRow}>
          <Text style={[styles.group, styles.groupInRow]}>Event type</Text>
          <Text style={styles.groupNote}>{types.size === 0 ? "All types" : `${types.size} picked`}</Text>
        </View>
        <View style={styles.chips}>{EVENT_CATEGORIES.map((c) => chip(c.value, c.label, types.has(c.value), () => toggle(c.value), categoryIcon(c.value).name))}</View>
      </ScrollView>
      <SheetFooter style={styles.footer}>
        <Button title="Show results" size="large" onPress={() => onApply({ dateFilter: when, categories: ordered(types) })} />
      </SheetFooter>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  reset: { fontSize: 15, fontWeight: "600", color: colors.brand },
  footer: { paddingHorizontal: 20 },
  body: { paddingHorizontal: 20, paddingBottom: space.md },
  group: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: space.md, marginBottom: 8, textTransform: "uppercase" },
  groupRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: space.md, marginBottom: 8 },
  groupInRow: { marginTop: 0, marginBottom: 0 },
  groupNote: { fontSize: 13, color: colors.faint },
  // The same pills as Explore's filter sheet, with the type's glyph.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
}));
