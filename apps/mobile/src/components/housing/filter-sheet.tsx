import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APARTMENT_SORTS, GENDER_PREFERENCES, ITEM_CONDITIONS, ITEM_SORTS, RADIUS_OPTIONS_MILES, type ApartmentSort, type GenderPref, type HousingSection, type ItemCondition, type ItemSort } from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { radius, shadows, space, type } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

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
  const insets = useSafeAreaInsets();
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
  /** One group of choices: an eyebrow over them, a hairline above every group but the first. */
  const group = (label: string, children: ReactNode, first = false) => (
    <View key={label} style={[styles.group, !first && styles.groupRule]}>
      <Text style={styles.groupLabel}>{label}</Text>
      {children}
    </View>
  );

  return (
    <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filters" />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {TITLES[section]}
            </Text>
            {changed ? (
              <Pressable onPress={() => setD(defaults)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset filters" style={({ pressed }) => pressed && { opacity: 0.6 }}>
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {section === "apartments" ? (
              <>
                {group("Sort by", <View style={styles.chips}>{APARTMENT_SORTS.map((s) => chip(s.label, d.sort === s.value, () => set({ sort: s.value }), s.value))}</View>, true)}
                {group(
                  "Bedrooms",
                  <View style={styles.chips}>
                    {chip("Any", d.minBedrooms === undefined, () => set({ minBedrooms: undefined }))}
                    {[1, 2, 3, 4].map((n) => chip(`${n}+`, d.minBedrooms === n, () => set({ minBedrooms: n }), String(n)))}
                  </View>,
                )}
                {group(
                  "Rent per month",
                  <View style={styles.pair}>
                    {money("Min", d.minPrice, (t) => set({ minPrice: t }))}
                    {money("Max", d.maxPrice, (t) => set({ maxPrice: t }))}
                  </View>,
                )}
                {group("Distance from campus", radiusChips)}
                {group(
                  "Only show",
                  <View style={styles.chips}>
                    {chip("Furnished", d.furnished, () => set({ furnished: !d.furnished }))}
                    {chip("Pets OK", d.petsAllowed, () => set({ petsAllowed: !d.petsAllowed }))}
                    {chip("Video tour", d.videoOnly, () => set({ videoOnly: !d.videoOnly }))}
                  </View>,
                )}
              </>
            ) : section === "roommates" ? (
              <>
                {group("Budget per month", <View style={styles.pair}>{money("Up to", d.maxBudget, (t) => set({ maxBudget: t }))}</View>, true)}
                {group(
                  "Open to",
                  <View style={styles.chips}>
                    {chip("Everyone", d.genderPreference === undefined, () => set({ genderPreference: undefined }))}
                    {GENDER_PREFERENCES.map((g) => chip(g.label, d.genderPreference === g.value, () => set({ genderPreference: g.value as GenderPref }), g.value))}
                  </View>,
                )}
                {group("Distance from campus", radiusChips)}
                {group("Only show", <View style={styles.chips}>{chip("With a video", d.videoOnly, () => set({ videoOnly: !d.videoOnly }))}</View>)}
              </>
            ) : (
              <>
                {group("Sort by", <View style={styles.chips}>{ITEM_SORTS.map((s) => chip(s.label, d.sort === s.value, () => set({ sort: s.value }), s.value))}</View>, true)}
                {group(
                  "Condition",
                  <View style={styles.chips}>
                    {chip("Any", d.condition === undefined, () => set({ condition: undefined }))}
                    {ITEM_CONDITIONS.map((c) => chip(c.label, d.condition === c.value, () => set({ condition: c.value as ItemCondition }), c.value))}
                  </View>,
                )}
                {group(
                  "Price",
                  <View style={styles.pair}>
                    {money("Min", d.minPrice, (t) => set({ minPrice: t }))}
                    {money("Max", d.maxPrice, (t) => set({ maxPrice: t }))}
                  </View>,
                )}
              </>
            )}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Button title="Show results" onPress={() => onApply(tidyAll(apply(section, filters, d)))} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function tidyAll(f: ExploreFilters): ExploreFilters {
  return { apartments: tidy(f.apartments), roommates: tidy(f.roommates), marketplace: tidy(f.marketplace) };
}

const useStyles = makeStyles((colors, scheme) => ({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  backdrop: { flex: 1 },
  // The sheet floats on the design system's sheet shadow in light; a shadow cannot be seen on black, so in the dark theme
  // a hairline edge keeps it apart from the page instead.
  sheet: { maxHeight: "86%", backgroundColor: colors.elevated, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderColor: colors.border, alignItems: "stretch", shadowColor: colors.shadow, ...(scheme === "light" ? shadows.sheet : { elevation: 0 }) },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: space.sm, marginBottom: space.xs },
  head: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 20, paddingVertical: space.sm },
  // The sheet's title in the serif of headlines; Reset is a quiet label in ink.
  title: { ...type.headline, flex: 1, color: colors.text },
  reset: { ...type.label, fontSize: 14, color: colors.brand },
  close: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 20, paddingBottom: space.md },
  // Each group of choices under an eyebrow, a hairline between the groups.
  group: { paddingVertical: space.lg, gap: space.md },
  groupRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  groupLabel: { ...type.eyebrow, color: colors.muted },
  // The design system's Chip, as in the row under the search box: a hairline capsule, an ink outline on the warm wash once chosen.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  chipSelected: { backgroundColor: colors.brandSoft, borderColor: colors.text },
  chipText: { ...type.label, fontSize: 13, color: colors.muted },
  chipTextSelected: { color: colors.text },
  pair: { flexDirection: "row", gap: space.md },
  // A Field's look: a soft fill in a hairline, the label small and grey (its words are the sheet's own, so no small caps).
  money: { flex: 1, gap: 6 },
  moneyLabel: { ...type.footnote, fontWeight: "600", color: colors.muted, marginLeft: 2 },
  moneyBox: { flexDirection: "row", alignItems: "center", gap: 6, height: 46, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  moneySign: { fontSize: 16, color: colors.muted },
  moneyInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  footer: { paddingHorizontal: 20, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
}));
