import { memo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ConversationSummary, MessageWithSender, ProfileSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { highlightParts, inboxTime } from "./inbox-utils";

/** Inbox rows' photo size, as in X's Chat list. */
export const INBOX_AVATAR = 56;

/**
 * A chat's photo: the other person's (with the green dot while they are online) for a direct chat; for a group, two of
 * its members overlapping, or the people icon when it has fewer than two others.
 */
export function InboxAvatar({ conversation: c, size = INBOX_AVATAR }: { conversation: ConversationSummary; size?: number }) {
  const styles = useStyles();
  const colors = useColors();
  if (c.type !== "group") {
    const other = c.otherMembers[0];
    return <Avatar name={other?.full_name ?? c.title} url={other?.avatar_url} size={size} userId={other?.id} />;
  }
  const [first, second] = c.otherMembers;
  if (first && second) {
    const small = Math.round(size * 0.68);
    return (
      <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.groupBack}>
          <Avatar name={second.full_name} url={second.avatar_url} size={small} online={false} />
        </View>
        <View style={[styles.groupFront, { borderRadius: small / 2 + 2 }]}>
          <Avatar name={first.full_name} url={first.avatar_url} size={small} online={false} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.groupIcon, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="people" size={Math.round(size * 0.42)} color={colors.brand} />
    </View>
  );
}

/**
 * One chat in the inbox, X style: the photo, the name in bold with the @username after it while there is room (direct
 * chats) and the short time ("3h"), the last message in grey under it (the server writes "Sent a photo" and the like),
 * and for unread chats bolder text and the blue count. Long press (or the screen reader's action) opens `onMenu`.
 * The label stays "Chat with <name>": the end-to-end flows tap rows by it.
 */
export const InboxRow = memo(function InboxRow({ conversation: c, username, now, onOpen, onMenu }: { conversation: ConversationSummary; username: string | null; now: number; onOpen: (c: ConversationSummary) => void; onMenu?: (c: ConversationSummary) => void }) {
  const styles = useStyles();
  const unread = c.unreadCount > 0;
  const time = inboxTime(c.lastMessageAt, now);
  const preview = (c.lastMessagePreview ?? "").replace(/\s+/g, " ").trim() || "Say hello 👋";
  const count = c.unreadCount > 99 ? "99+" : String(c.unreadCount);
  return (
    <Pressable
      onPress={() => onOpen(c)}
      onLongPress={onMenu ? () => onMenu(c) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${c.title}`}
      accessibilityHint={`${unread ? `${count} unread. ` : ""}${preview}${time ? `, ${time}` : ""}`}
      accessibilityActions={onMenu ? [{ name: "longpress", label: "Chat options" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") onMenu?.(c);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <InboxAvatar conversation={c} />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.nameLine} numberOfLines={1}>
            <Text style={[styles.name, unread && styles.nameUnread]}>{c.title}</Text>
            {username ? <Text style={styles.handle}>{` @${username}`}</Text> : null}
          </Text>
          {time ? <Text style={styles.time}>{` · ${time}`}</Text> : null}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "Someone";

/**
 * A message the search found: the chat's photo and name, the short time, and the text with the words in bold ("You: "
 * in front of your own, the sender's first name in groups). Opens the chat at that message.
 */
export const InboxMessageRow = memo(function InboxMessageRow({ message: m, conversation: c, query, me, now, onOpen }: { message: MessageWithSender; conversation: ConversationSummary | null; query: string; me: string | null; now: number; onOpen: (m: MessageWithSender) => void }) {
  const styles = useStyles();
  const title = c?.title ?? m.sender?.full_name ?? "Chat";
  const who = m.sender_id && m.sender_id === me ? "You: " : c?.type === "group" && m.sender ? `${firstName(m.sender.full_name)}: ` : "";
  const parts = highlightParts(m.content, query);
  const time = inboxTime(m.created_at, now);
  return (
    <Pressable
      onPress={() => onOpen(m)}
      accessibilityRole="button"
      accessibilityLabel={`Message in ${title}: ${who}${m.content}`}
      accessibilityHint="Opens the chat at this message"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {c ? <InboxAvatar conversation={c} size={48} /> : <Avatar name={m.sender?.full_name ?? title} url={m.sender?.avatar_url} size={48} online={false} />}
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.nameLine, styles.name]} numberOfLines={1}>
            {title}
          </Text>
          {time ? <Text style={styles.time}>{` · ${time}`}</Text> : null}
        </View>
        <Text style={styles.preview} numberOfLines={2}>
          {who}
          {parts.map((p, i) => (
            <Text key={i} style={p.match ? styles.match : undefined}>
              {p.text}
            </Text>
          ))}
        </Text>
      </View>
    </Pressable>
  );
});

/** A person to start a chat with (the new-chat screen): photo, name, @username, and a spinner while the chat opens. */
export function InboxPersonRow({ person: p, username, busy = false, disabled = false, onPress }: { person: ProfileSummary; username: string | null; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={p.full_name} accessibilityHint="Opens a chat with them" accessibilityState={{ disabled, busy }} style={({ pressed }) => [styles.row, styles.personRow, pressed && styles.pressed]}>
      <Avatar name={p.full_name} url={p.avatar_url} size={48} userId={p.id} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {p.full_name}
        </Text>
        {username ? (
          <Text style={styles.preview} numberOfLines={1}>
            @{username}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={colors.muted} /> : null}
    </Pressable>
  );
}

/** A bold section title in a list: "Chats" and "Messages" while searching, "Suggested" when starting a chat. */
export function InboxSectionHeader({ title }: { title: string }) {
  const styles = useStyles();
  return (
    <Text style={styles.section} accessibilityRole="header">
      {title}
    </Text>
  );
}

/** A quiet line in a list (searching, could not search, show more), optionally with a tappable action in blue. */
export function InboxNote({ text, action, onAction, loading = false }: { text?: string; action?: string; onAction?: () => void; loading?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.note}>
      {loading ? <ActivityIndicator color={colors.muted} /> : null}
      {text ? <Text style={styles.noteText}>{text}</Text> : null}
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={styles.noteAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** X's round blue new-chat button in the bottom-right corner: a chat bubble with a plus. */
export function InboxNewChatButton({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="New message" style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.brandDark }]}>
      <MaterialCommunityIcons name="chat-plus-outline" size={26} color={colors.onBrand} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  personRow: { paddingVertical: 8 },
  pressed: { backgroundColor: colors.input },
  body: { flex: 1, minWidth: 0, gap: 2 },
  topLine: { flexDirection: "row", alignItems: "baseline" },
  // Shrinks first, so a long name or @username ends in "…" while the time always shows.
  nameLine: { flexShrink: 1, fontSize: 15, color: colors.text },
  name: { fontSize: 15, fontWeight: "700", color: colors.text },
  nameUnread: { fontWeight: "800" },
  handle: { fontSize: 15, fontWeight: "400", color: colors.muted },
  time: { flexShrink: 0, fontSize: 15, color: colors.muted },
  preview: { fontSize: 15, lineHeight: 20, color: colors.muted },
  previewUnread: { color: colors.text, fontWeight: "600" },
  match: { fontWeight: "800", color: colors.text },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.onBrand, fontSize: 12, fontWeight: "800" },
  // The back member sits top right; the front one bottom left with a ring of the screen colour, so the two read apart.
  groupBack: { position: "absolute", top: 0, right: 0 },
  groupFront: { position: "absolute", left: 0, bottom: 0, padding: 2, backgroundColor: colors.bg },
  groupIcon: { backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  section: { fontSize: 17, fontWeight: "800", color: colors.text, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs },
  note: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  noteText: { fontSize: 14, color: colors.muted, textAlign: "center" },
  noteAction: { fontSize: 14, fontWeight: "700", color: colors.brand },
  fab: { position: "absolute", right: space.lg, bottom: space.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
}));
