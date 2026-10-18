import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { formatDayLabel, formatMessageTime, isSameDay, searchConversationMessages, type MessageWithSender } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { sharedErrorText } from "@/components/messages/shared-content";
import { ErrorBanner, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { radius, space } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

/** The newest matches only; the database caps a search at 100. */
const LIMIT = 50;
/** A match further into a long message than this many characters gets the text before it cut, so the match shows. */
const LEAD = 40;

/** The query as a pattern that matches its exact characters in any case ("%" and "_" are plain characters, as in the database). */
function patternFor(query: string, flags: string): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  try {
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch {
    return null;
  }
}

/** The message on one line, starting a little before the first match when the match is far in ("…the words before it"). */
function snippet(content: string, query: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const pattern = patternFor(query, "iu");
  const index = pattern ? flat.search(pattern) : -1;
  if (index <= LEAD) return flat;
  let start = index - LEAD;
  // Start on a word, and never in the middle of an emoji.
  const space = flat.indexOf(" ", start);
  if (space !== -1 && space < index) start = space + 1;
  else if (/[\uDC00-\uDFFF]/.test(flat.charAt(start))) start += 1;
  return `…${flat.slice(start)}`;
}

/** The text cut into plain parts and matches, so each match can be bold. */
function matchParts(text: string, query: string): { text: string; match: boolean }[] {
  const pattern = patternFor(query, "giu");
  if (!pattern) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/** "14:05" today, else "Yesterday", "Mon, 3 Mar" or "Mon, 3 Mar 2025". */
function resultDate(iso: string): string {
  return isSameDay(iso, new Date().toISOString()) ? formatMessageTime(iso) : formatDayLabel(iso);
}

/**
 * Search inside one chat, opened from Search on the chat's info. The box is ready to type in; results (the newest 50
 * messages containing what you typed, in any case) come in as you stop typing, each with who sent it, when, and the
 * match in bold. Tapping one goes back to the chat at that message (`at`), which scrolls to it and highlights it.
 */
export default function ChatSearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  // Wait until typing stops before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (!sessionLoading && !user) router.replace("/(auth)/login");
  }, [sessionLoading, user, router]);
  const me = user?.id ?? null;
  const results = useQuery(async () => {
    if (!q || !me || !id) return null;
    try {
      // The query travels with its rows, so the bold always marks the words these rows matched.
      return { q, rows: await searchConversationMessages(supabase, id, q, { limit: LIMIT }) };
    } catch (e) {
      throw new Error(sharedErrorText(e, "Couldn't search. Check your connection and try again."));
    }
  }, [q, id, me]);

  /** Back to the chat at this message: the chat under this screen when it is this one, else a fresh one in its place. */
  function open(message: MessageWithSender) {
    Keyboard.dismiss();
    const href = { pathname: "/messages/[id]", params: { id, at: message.id } } as const;
    const routes = navigation.getState()?.routes ?? [];
    const thread = [...routes].reverse().find((r) => r.name === "messages/[id]");
    const threadId = (thread?.params as { id?: string } | undefined)?.id;
    if (threadId === id) router.dismissTo(href);
    else router.replace(href);
  }

  const shown = q && results.data ? results.data : null;
  const rows = q ? (shown?.rows ?? []) : [];
  const searching = results.loading && Boolean(q);
  const count = rows.length >= LIMIT ? `The latest ${LIMIT} results` : rows.length === 1 ? "1 result" : `${rows.length} results`;

  if (sessionLoading || !user) return <Loading />;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.search}>
          {searching ? <ActivityIndicator size="small" color={colors.muted} style={styles.icon} /> : <Ionicons name="search" size={18} color={colors.muted} style={styles.icon} />}
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => setQ(text.trim())}
            placeholder="Search messages"
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Search messages in this chat"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={200}
            style={styles.input}
          />
          {text ? (
            <Pressable onPress={() => setText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {results.error && !results.loading && q ? (
        <View style={styles.banner}>
          <ErrorBanner message={results.error} onRetry={() => void results.refresh()} />
        </View>
      ) : null}
      {/* Rows from the last search stay up while the next one runs, so the list does not flash on every keystroke. */}
      <FlatList
        data={rows}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, paddingBottom: space.xl }}
        ListHeaderComponent={rows.length > 0 ? <Text style={styles.count}>{count}</Text> : null}
        renderItem={({ item }) => <ResultRow message={item} query={shown?.q ?? q} me={me} onPress={() => open(item)} />}
        ListEmptyComponent={
          !q ? (
            <Hint icon="search-outline" title="Search this chat" body="Find messages by a word or phrase in them." />
          ) : results.error ? null : !shown || searching ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <Hint icon="chatbubble-ellipses-outline" title="No messages found" body={`Nothing in this chat says “${shown.q}”.`} />
          )
        }
      />
    </View>
  );
}

/** One result: who sent it and their photo, when, and the message with the words in bold. */
function ResultRow({ message, query, me, onPress }: { message: MessageWithSender; query: string; me: string | null; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const mine = message.sender_id !== null && message.sender_id === me;
  const name = mine ? "You" : (message.sender?.full_name ?? "Deleted user");
  const date = resultDate(message.created_at);
  const parts = matchParts(snippet(message.content, query), query);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${date}: ${message.content}`}
      accessibilityHint="Opens the chat at this message"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }]}
    >
      <Avatar name={message.sender?.full_name ?? name} url={message.sender?.avatar_url} size="md" online={false} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.date}>{date}</Text>
        </View>
        <Text style={styles.text} numberOfLines={3}>
          {parts.map((p, i) => (
            <Text key={i} style={p.match ? styles.match : undefined}>
              {p.text}
            </Text>
          ))}
        </Text>
      </View>
    </Pressable>
  );
}

function Hint({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.hint}>
      <View style={styles.hintIcon}>
        <Ionicons name={icon} size={26} color={colors.brand} />
      </View>
      <Text style={styles.hintTitle}>{title}</Text>
      <Text style={styles.hintBody}>{body}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  // The input fill, not the card colour: the screen behind it is white in light and black in dark.
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 14, height: 42 },
  icon: { width: 18 },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  count: { fontSize: 13, fontWeight: "600", color: colors.muted, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  name: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  date: { fontSize: 12, color: colors.muted },
  text: { fontSize: 14, lineHeight: 19, color: colors.muted },
  match: { fontWeight: "800", color: colors.text },
  loading: { paddingTop: space.xl, alignItems: "center" },
  hint: { alignItems: "center", paddingHorizontal: space.xl, paddingTop: 48, gap: space.sm },
  hintIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  hintTitle: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  hintBody: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 19 },
}));
