import { type ReactNode, type Ref } from "react";
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SlidingTabs } from "@/components/sliding-tabs";
import { hapticSelect } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import type { InboxFilter, InboxPage } from "./inbox-utils";
import { Icon } from "@/components/icon";

/** The two pages of the inbox, left to right: the order of the pager and of the labels above it. */
export const INBOX_PAGES: { value: InboxPage; label: string }[] = [
  { value: "chats", label: "Chats" },
  { value: "groups", label: "Groups" },
];

/** The pills under the search box; Requests is only offered on Chats (a request is a direct chat). */
export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "requests", label: "Requests" },
];

/** Height of the Chats | Groups row. */
const TABS_ROW = 44;

/**
 * The Messages tab's own top bar: the big "Messages" title with the new-message pencil at the right of the same row, then
 * Chats | Groups above the pager with Home's sliding violet underline (`scrollX` is the pager's offset and `pageWidth`
 * the width of one page, so the underline follows the finger), `children` (the search field) and the All | Unread |
 * Requests pills that narrow the page (Requests on Chats only, each pill carrying its count). A hairline under it all
 * appears once the list underneath has scrolled. Signed out, the bar shows only the title.
 */
export function InboxHeader({ signedIn, page, onPage, scrollX, pageWidth, requestCount, filter, unreadChats, onFilter, scrolled, onNewChat, children }: { signedIn: boolean; page: InboxPage; onPage: (page: InboxPage) => void; scrollX: Animated.Value; pageWidth: number; requestCount: number; filter: InboxFilter; unreadChats: number; onFilter: (filter: InboxFilter) => void; scrolled: boolean; onNewChat: () => void; children?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  function pickFilter(next: InboxFilter) {
    if (next === filter) return;
    hapticSelect();
    onFilter(next);
  }
  const pills = page === "groups" ? INBOX_FILTERS.filter((f) => f.value !== "requests") : INBOX_FILTERS;
  const countOf = (f: InboxFilter) => (f === "unread" ? unreadChats : f === "requests" ? requestCount : 0);

  return (
    <View style={[styles.chrome, { paddingTop: insets.top }, scrolled && styles.chromeScrolled]}>
      <View style={styles.topRow}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Messages
        </Text>
        {signedIn ? (
          <Pressable onPress={onNewChat} hitSlop={8} accessibilityRole="button" accessibilityLabel="New message" style={({ pressed }) => [styles.compose, pressed && { opacity: 0.6 }]}>
            <Icon name="create-outline" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {signedIn ? (
        <View style={styles.tabs}>
          <SlidingTabs sections={INBOX_PAGES} section={page} onSelect={onPage} scrollX={scrollX} pageWidth={pageWidth} tint={colors.accent} labelColor={colors.text} dimColor={colors.muted} gap={110} fontSize={16} />
        </View>
      ) : null}
      {children}
      {signedIn ? (
        <View style={styles.filters} accessibilityRole="tablist">
          {pills.map((f) => {
            const selected = f.value === filter;
            const n = countOf(f.value);
            const count = n > 0 ? (n > 99 ? "99+" : String(n)) : null;
            return (
              <Pressable key={f.value} onPress={() => pickFilter(f.value)} accessibilityRole="tab" accessibilityLabel={count ? `${f.label}, ${count}` : f.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && { opacity: 0.7 }]}>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.label}</Text>
                {count ? <Text style={[styles.chipCount, selected && styles.chipTextSelected]}>{count}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The rounded search box of the inbox and the new-chat screen: magnifier, the words, a clear button once something is
 * typed, and (when `onCancel` is given and the box is in use) a Cancel that leaves the search.
 */
export function InboxSearchField({ value, onChangeText, placeholder = "Search", autoFocus, inputRef, onFocusChange, showCancel = false, onCancel, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; placeholder?: string; autoFocus?: boolean; inputRef?: Ref<TextInput>; onFocusChange?: (focused: boolean) => void; showCancel?: boolean; onCancel?: () => void; accessibilityLabel?: string }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  return (
    <View style={styles.searchRow}>
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardAppearance={isDark ? "dark" : "light"}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus={autoFocus}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          accessibilityLabel={accessibilityLabel ?? placeholder}
          style={styles.input}
        />
        {value ? (
          <Pressable onPress={() => onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
      {showCancel && onCancel ? (
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel search" style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The hairline is always there, transparent until the list scrolls, so the list never jumps by its width.
  chrome: { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent", zIndex: 1 },
  chromeScrolled: { borderBottomColor: colors.border },
  // The title and the pencil share one row, so the tabs and the search box sit a row higher.
  topRow: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: space.lg },
  compose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flexShrink: 1, fontSize: 30, fontWeight: "800", letterSpacing: -0.5, color: colors.text },
  // The labels row, as tall as Home's, with the hairline the sliding underline sits on.
  tabs: { height: TABS_ROW, flexDirection: "row", marginHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  filters: { flexDirection: "row", gap: space.sm, paddingHorizontal: 20, paddingBottom: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.input },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: colors.brand },
  chipCount: { fontSize: 12, fontWeight: "700", color: colors.muted },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 20, paddingTop: space.md, paddingBottom: space.md },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 16, height: 46 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.text },
}));
