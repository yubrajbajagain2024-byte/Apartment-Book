import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { APARTMENT_SORTS, GENDER_PREFERENCES, ITEM_CONDITIONS, ITEM_SORTS, RADIUS_OPTIONS_MILES, type ApartmentSort, type GenderPref, type HousingSection, type ItemCondition, type ItemSort } from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";

/** What narrows each page of Explore beyond its search box and pills. Toggles are `true` or left out, never false. */
export type RoomFilters = { sort: ApartmentSort; minBedrooms?: number; minPrice?: number; maxPrice?: number; radiusMiles?: number; furnished?: true; petsAllowed?: true; videoOnly?: true };
export type RoommateFilters = { maxBudget?: number; genderPreference?: GenderPref; radiusMiles?: number; videoOnly?: true };
export type MarketFilters = { sort: ItemSort; condition?: ItemCondition; minPrice?: number; maxPrice?: number };
export type ExploreFilters = { apartments: RoomFilters; roommates: RoommateFilters; marketplace: MarketFilters };
export const DEFAULT_FILTERS: ExploreFilters = { apartments: { sort: "newest" }, roommates: {}, marketplace: { sort: "newest" } };

const TITLES: Record<HousingSection, string> = { apartments: "Filter rooms", roommates: "Filter roommate posts", marketplace: "Filter items" };

/** How many choices on a page differ from the defaults: the badge on the filter button. */
export function activeFilterCount(section: HousingSection, filters: ExploreFilters): number {
  const chosen = filters[section] as Record<string, unknown>;
  const defaults = DEFAULT_FILTERS[section] as Record<string, unknown>;
  const keys = new Set([...Object.keys(chosen), ...Object.keys(defaults)]);
  let n = 0;
  for (const k of keys) if (chosen[k] !== defaults[k]) n++;
  return n;
}

/** A price typed in the sheet: digits only, or nothing. */
function toNumber(text: string): number | undefined {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
}
const fromNumber = (n: number | undefined) => (n === undefined ? "" : String(n));

type Draft = {
  sort: string;
  minBedrooms?: number;
  minPrice: string;
  maxPrice: string;
  maxBudget: string;
  radiusMiles?: number;
  genderPreference?: GenderPref;
  condition?: ItemCondition;
  furnished: boolean;
  petsAllowed: boolean;
  videoOnly: boolean;
};

/** The sheet's draft holds only the page's own fields, so Reset and "changed" never see another page's choices. */
function draftOf(section: HousingSection, filters: ExploreFilters): Draft {
  const blank: Draft = { sort: "newest", minPrice: "", maxPrice: "", maxBudget: "", furnished: false, petsAllowed: false, videoOnly: false };
  if (section === "apartments") {
    const a = filters.apartments;
    return { ...blank, sort: a.sort, minBedrooms: a.minBedrooms, minPrice: fromNumber(a.minPrice), maxPrice: fromNumber(a.maxPrice), radiusMiles: a.radiusMiles, furnished: Boolean(a.furnished), petsAllowed: Boolean(a.petsAllowed), videoOnly: Boolean(a.videoOnly) };
  }
  if (section === "roommates") {
    const r = filters.roommates;
    return { ...blank, maxBudget: fromNumber(r.maxBudget), genderPreference: r.genderPreference, radiusMiles: r.radiusMiles, videoOnly: Boolean(r.videoOnly) };
  }
  const m = filters.marketplace;
  return { ...blank, sort: m.sort, condition: m.condition, minPrice: fromNumber(m.minPrice), maxPrice: fromNumber(m.maxPrice) };
}

function apply(section: HousingSection, filters: ExploreFilters, d: Draft): ExploreFilters {
  const on = (v: boolean) => (v ? (true as const) : undefined);
  if (section === "apartments") {
    return { ...filters, apartments: { sort: d.sort as ApartmentSort, minBedrooms: d.minBedrooms, minPrice: toNumber(d.minPrice), maxPrice: toNumber(d.maxPrice), radiusMiles: d.radiusMiles, furnished: on(d.furnished), petsAllowed: on(d.petsAllowed), videoOnly: on(d.videoOnly) } };
  }
  if (section === "roommates") {
    return { ...filters, roommates: { maxBudget: toNumber(d.maxBudget), genderPreference: d.genderPreference, radiusMiles: d.radiusMiles, videoOnly: on(d.videoOnly) } };
  }
  return { ...filters, marketplace: { sort: d.sort as ItemSort, condition: d.condition, minPrice: toNumber(d.minPrice), maxPrice: toNumber(d.maxPrice) } };
}

/** Filters that are not set are left out, so the badge and the queries see a clean object. */
function tidy<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The sheet behind the filter button beside Explore's search box: the choices that narrow the page on screen beyond its
 * search and pills. Rooms: sort, bedrooms, rent, distance from campus, furnished, pets, video tours. Roommate posts: a
 * budget cap, who the post is open to, distance, video. Items: sort, condition, price. Choices are drafted here and
 * sent on "Show results"; Reset puts the page's defaults back. Each page keeps its own choices while the tab is open.
 */
export function FilterSheet({ section, open, filters, onApply, onClose }: { section: HousingSection; open: boolean; filters: ExploreFilters; onApply: (next: ExploreFilters) => void; onClose: () => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const [d, setD] = useState<Draft>(() => draftOf(section, filters));
  // A fresh draft each time the sheet opens, for the page it opens on.
  useEffect(() => {
    if (open) setD(draftOf(section, filters));
  }, [open, section, filters]);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const defaults = draftOf(section, DEFAULT_FILTERS);
  const changed = JSON.stringify(d) !== JSON.stringify(defaults);

  const chip = (label: string, selected: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { opacity: 0.7 }]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
  const money = (label: string, value: string, onChangeText: (t: string) => void) => (
    <View style={styles.money}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <View style={styles.moneyBox}>
        <Text style={styles.moneySign}>$</Text>
        <TextInput value={value} onChangeText={onChangeText} placeholder="Any" placeholderTextColor={colors.faint} keyboardType="number-pad" keyboardAppearance={isDark ? "dark" : "light"} accessibilityLabel={label} maxLength={7} style={styles.moneyInput} />
      </View>
    </View>
  );
  const radiusChips = (
    <View style={styles.chips}>
      {chip("Any distance", d.radiusMiles === undefined, () => set({ radiusMiles: undefined }))}
      {RADIUS_OPTIONS_MILES.map((m) => chip(`${m} mi`, d.radiusMiles === m, () => set({ radiusMiles: m }), String(m)))}
    </View>
  );

  return (
    <Sheet visible={open} onClose={onClose} closeLabel="Close filters" maxHeight="86%" keyboard>
      <SheetHeader
        title={TITLES[section]}
        leading={
          changed ? (
            <Pressable onPress={() => setD(defaults)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset filters" style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={styles.reset}>Reset</Text>
            </Pressable>
          ) : null
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {section === "apartments" ? (
          <>
            <Text style={styles.group}>Sort by</Text>
            <View style={styles.chips}>{APARTMENT_SORTS.map((s) => chip(s.label, d.sort === s.value, () => set({ sort: s.value }), s.value))}</View>
            <Text style={styles.group}>Bedrooms</Text>
            <View style={styles.chips}>
              {chip("Any", d.minBedrooms === undefined, () => set({ minBedrooms: undefined }))}
              {[1, 2, 3, 4].map((n) => chip(`${n}+`, d.minBedrooms === n, () => set({ minBedrooms: n }), String(n)))}
            </View>
            <Text style={styles.group}>Rent per month</Text>
            <View style={styles.pair}>
              {money("Min", d.minPrice, (t) => set({ minPrice: t }))}
              {money("Max", d.maxPrice, (t) => set({ maxPrice: t }))}
            </View>
            <Text style={styles.group}>Distance from campus</Text>
            {radiusChips}
            <Text style={styles.group}>Only show</Text>
            <View style={styles.chips}>
              {chip("Furnished", d.furnished, () => set({ furnished: !d.furnished }))}
              {chip("Pets OK", d.petsAllowed, () => set({ petsAllowed: !d.petsAllowed }))}
              {chip("Video tour", d.videoOnly, () => set({ videoOnly: !d.videoOnly }))}
            </View>
          </>
        ) : section === "roommates" ? (
          <>
            <Text style={styles.group}>Budget per month</Text>
            <View style={styles.pair}>{money("Up to", d.maxBudget, (t) => set({ maxBudget: t }))}</View>
            <Text style={styles.group}>Open to</Text>
            <View style={styles.chips}>
              {chip("Everyone", d.genderPreference === undefined, () => set({ genderPreference: undefined }))}
              {GENDER_PREFERENCES.map((g) => chip(g.label, d.genderPreference === g.value, () => set({ genderPreference: g.value as GenderPref }), g.value))}
            </View>
            <Text style={styles.group}>Distance from campus</Text>
            {radiusChips}
            <Text style={styles.group}>Only show</Text>
            <View style={styles.chips}>{chip("With a video", d.videoOnly, () => set({ videoOnly: !d.videoOnly }))}</View>
          </>
        ) : (
          <>
            <Text style={styles.group}>Sort by</Text>
            <View style={styles.chips}>{ITEM_SORTS.map((s) => chip(s.label, d.sort === s.value, () => set({ sort: s.value }), s.value))}</View>
            <Text style={styles.group}>Condition</Text>
            <View style={styles.chips}>
              {chip("Any", d.condition === undefined, () => set({ condition: undefined }))}
              {ITEM_CONDITIONS.map((c) => chip(c.label, d.condition === c.value, () => set({ condition: c.value as ItemCondition }), c.value))}
            </View>
            <Text style={styles.group}>Price</Text>
            <View style={styles.pair}>
              {money("Min", d.minPrice, (t) => set({ minPrice: t }))}
              {money("Max", d.maxPrice, (t) => set({ maxPrice: t }))}
            </View>
          </>
        )}
      </ScrollView>
      <SheetFooter style={styles.footer}>
        <Button title="Show results" size="large" onPress={() => onApply(tidyAll(apply(section, filters, d)))} />
      </SheetFooter>
    </Sheet>
  );
}

function tidyAll(f: ExploreFilters): ExploreFilters {
  return { apartments: tidy(f.apartments), roommates: tidy(f.roommates), marketplace: tidy(f.marketplace) };
}

const useStyles = makeStyles((colors, scheme) => ({
  reset: { fontSize: 15, fontWeight: "600", color: colors.brand },
  footer: { paddingHorizontal: 20 },
  body: { paddingHorizontal: 20, paddingBottom: space.md },
  group: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: space.md, marginBottom: 8, textTransform: "uppercase" },
  // The same pills as the row under the search box.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
  pair: { flexDirection: "row", gap: space.sm },
  money: { flex: 1, gap: 6 },
  moneyLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  moneyBox: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 12, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.input },
  moneySign: { fontSize: 16, fontWeight: "700", color: colors.muted },
  moneyInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
}));
