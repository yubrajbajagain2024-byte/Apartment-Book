import { useState, type ReactNode, type Ref } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { hapticSelect } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";
import type { InboxFilter } from "./inbox-utils";

/** Height of the bar with the avatar, the title and the filter pill (the safe area comes on top). */
const BAR = 48;
const MENU_WIDTH = 220;

export const INBOX_FILTERS: { value: InboxFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "all", label: "All", icon: "chatbubbles-outline" },
  { value: "unread", label: "Unread", icon: "mail-unread-outline" },
  { value: "groups", label: "Groups", icon: "people-outline" },
];

export function inboxFilterLabel(filter: InboxFilter): string {
  return INBOX_FILTERS.find((f) => f.value === filter)?.label ?? "All";
}

/**
 * The Messages tab's own top bar, X's Chat style: your photo on the left (it opens your profile), "Chat" in the middle and
 * the outlined "All ⌄" pill on the right, whose menu picks All, Unread or Groups. `children` (the search field) sits under
 * the bar on the same surface; a hairline under both appears once the list underneath has scrolled. `me` is null while
 * signed out: the bar then shows only the title.
 */
export function InboxHeader({ me, filter, unreadChats, onFilter, onAvatar, scrolled, children }: { me: { name: string | null; avatarUrl: string | null } | null; filter: InboxFilter; unreadChats: number; onFilter: (filter: InboxFilter) => void; onAvatar: () => void; scrolled: boolean; children?: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const label = inboxFilterLabel(filter);

  function pick(next: InboxFilter) {
    setOpen(false);
    if (next === filter) return;
    hapticSelect();
    onFilter(next);
  }

  return (
    <View style={[styles.chrome, { paddingTop: insets.top }, scrolled && styles.chromeScrolled]}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {me ? (
            <Pressable onPress={onAvatar} hitSlop={8} accessibilityRole="button" accessibilityLabel="Your profile" style={({ pressed }) => pressed && { opacity: 0.7 }}>
              {me.name ? <Avatar name={me.name} url={me.avatarUrl} size={32} online={false} /> : <View style={styles.avatarPlaceholder} />}
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Chat
        </Text>
        <View style={[styles.side, styles.sideEnd]}>
          {me ? (
            <Pressable
              onPress={() => setOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Filter chats"
              accessibilityHint="All chats, unread chats or group chats"
              accessibilityValue={{ text: label }}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => [styles.pill, pressed && { backgroundColor: colors.input }]}
            >
              <Text style={styles.pillText} numberOfLines={1}>
                {label}
              </Text>
              <Ionicons name="chevron-down" size={15} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {children}
      {/* X's filter menu: a card dropped just under the pill, the inbox still visible behind it; a tap outside closes it. */}
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close menu" />
        <View pointerEvents="box-none" style={[styles.anchor, { top: insets.top + BAR - 2 }]}>
          <View style={styles.menu} accessibilityRole="menu">
            {INBOX_FILTERS.map((f) => {
              const selected = f.value === filter;
              return (
                <Pressable key={f.value} onPress={() => pick(f.value)} accessibilityRole="menuitem" accessibilityLabel={f.value === "unread" && unreadChats > 0 ? `${f.label}, ${unreadChats}` : f.label} accessibilityState={{ selected }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.input }]}>
                  <Ionicons name={f.icon} size={20} color={colors.text} />
                  <Text style={[styles.itemText, selected && styles.itemSelected]} numberOfLines={1}>
                    {f.label}
                  </Text>
                  {f.value === "unread" && unreadChats > 0 ? <Text style={styles.itemCount}>{unreadChats > 99 ? "99+" : unreadChats}</Text> : null}
                  <View style={styles.check}>{selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}</View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
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
        <Ionicons name="search" size={18} color={colors.muted} />
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
            <Ionicons name="close-circle" size={18} color={colors.faint} />
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

const useStyles = makeStyles((colors, scheme) => ({
  // The hairline is always there, transparent until the list scrolls, so the list never jumps by its width.
  chrome: { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent", zIndex: 1 },
  chromeScrolled: { borderBottomColor: colors.border },
  bar: { height: BAR, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg },
  // Two equal sides keep the title truly centred whatever the pill says.
  side: { flex: 1, flexDirection: "row", alignItems: "center" },
  sideEnd: { justifyContent: "flex-end" },
  avatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.skeleton },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, paddingHorizontal: space.sm },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingLeft: 14, paddingRight: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  pillText: { fontSize: 14, fontWeight: "700", color: colors.text },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  anchor: { position: "absolute", right: space.md, alignItems: "flex-end" },
  // A shadow cannot be seen on black, so in the dark theme a hairline outline keeps the menu apart from the page.
  menu: { width: MENU_WIDTH, backgroundColor: colors.elevated, borderRadius: radius.lg, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10, borderWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderColor: colors.border },
  item: { height: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.lg },
  itemText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  itemSelected: { fontWeight: "800" },
  itemCount: { fontSize: 13, fontWeight: "600", color: colors.muted },
  check: { width: 20, alignItems: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: 2, paddingBottom: space.sm },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 14, height: 40 },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  cancel: { fontSize: 15, fontWeight: "600", color: colors.text },
}));
