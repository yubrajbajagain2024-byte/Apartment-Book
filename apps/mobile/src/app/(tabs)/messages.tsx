import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, Keyboard, Platform, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from "react-native";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { listConversations, markConversationRead, type ConversationSummary, type MessageWithSender } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { InboxHeader, InboxSearchField, inboxFilterLabel } from "@/components/messages/inbox-header";
import { InboxMessageRow, InboxNewChatButton, InboxNote, InboxRow, InboxSectionHeader } from "@/components/messages/inbox-row";
import { inFilter, matchConversations, useMessageSearch, useNow, useUsernames, type InboxFilter } from "@/components/messages/inbox-utils";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { hapticTap } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** One line of the list: a chat, or while searching also section titles, found messages and status lines. */
type Item =
  | { key: string; type: "chat"; conversation: ConversationSummary }
  | { key: string; type: "header"; title: string }
  | { key: string; type: "message"; message: MessageWithSender; conversation: ConversationSummary | null }
  | { key: string; type: "more"; count: number }
  | { key: string; type: "searching" }
  | { key: string; type: "failed" };

const NO_CHATS: ConversationSummary[] = [];
/** While searching, this many chats show above the messages until "Show all" is tapped. */
const CHAT_MATCHES = 5;

/**
 * The Messages tab (between Housing and Marketplace in the bottom bar), in the style of X's Chat: its own top bar (your
 * photo, "Chat", the All | Unread | Groups pill), a search box, then your chats newest first with the round new-chat
 * button in the corner. Typing searches chats by name, @username or group title, and below them the words of every
 * message you can read; a found message opens its chat at that message. The list follows new messages live.
 */
export default function MessagesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const showSheet = useActionSheet();
  const focused = useIsFocused();
  const { user, profile, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;
  const { data, error, loading, refresh, setData } = useQuery(() => (userId ? listConversations(supabase, userId) : Promise.resolve(NO_CHATS)), [userId]);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [text, setText] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [allChatMatches, setAllChatMatches] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const now = useNow(focused);

  useFocusEffect(
    useCallback(() => {
      if (userId) void refresh();
    }, [userId, refresh]),
  );
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`chats:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const conversations = data ?? NO_CHATS;
  const query = text.trim();
  const searching = Boolean(userId) && query.length > 0;
  const messageSearch = useMessageSearch(text, Boolean(userId));

  // Direct chats show the other person's @username; group members' handles are only needed to search by them.
  const handleIds = useMemo(() => conversations.flatMap((c) => (c.type !== "group" || searching ? c.otherMembers.map((m) => m.id) : [])), [conversations, searching]);
  const usernameOf = useUsernames(handleIds);

  const visible = useMemo(() => conversations.filter((c) => inFilter(c, filter)), [conversations, filter]);
  const unreadChats = useMemo(() => conversations.filter((c) => c.unreadCount > 0).length, [conversations]);
  const byId = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const chatMatches = useMemo(() => (searching ? matchConversations(visible, query, usernameOf) : NO_CHATS), [searching, visible, query, usernameOf]);
  // The pill's filter applies to the search too; a message from a chat this list does not know only shows under All.
  const messageMatches = useMemo(
    () =>
      messageSearch.rows.filter((m) => {
        const c = byId.get(m.conversation_id);
        return c ? inFilter(c, filter) : filter === "all";
      }),
    [messageSearch.rows, byId, filter],
  );
  useEffect(() => setAllChatMatches(false), [query]);

  const items = useMemo<Item[]>(() => {
    if (!searching) return visible.map((c) => ({ key: c.id, type: "chat", conversation: c }));
    const out: Item[] = [];
    if (chatMatches.length > 0) {
      out.push({ key: "chats", type: "header", title: "Chats" });
      const shown = allChatMatches ? chatMatches : chatMatches.slice(0, CHAT_MATCHES);
      for (const c of shown) out.push({ key: `chat-${c.id}`, type: "chat", conversation: c });
      if (shown.length < chatMatches.length) out.push({ key: "more", type: "more", count: chatMatches.length });
    }
    if (messageMatches.length > 0) {
      out.push({ key: "messages", type: "header", title: "Messages" });
      for (const m of messageMatches) out.push({ key: `message-${m.id}`, type: "message", message: m, conversation: byId.get(m.conversation_id) ?? null });
    }
    if (messageSearch.loading) {
      if (out.length > 0) out.push({ key: "searching", type: "searching" });
    } else if (messageSearch.failed) out.push({ key: "failed", type: "failed" });
    return out;
  }, [searching, visible, chatMatches, allChatMatches, messageMatches, messageSearch.loading, messageSearch.failed, byId]);

  // The hairline under the top bar shows once the list has moved; a new list (search, another filter) starts at the top.
  const listKey = searching ? "search" : filter;
  useEffect(() => {
    scrolledRef.current = false;
    setScrolled(false);
  }, [listKey]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > 0;
    if (next === scrolledRef.current) return;
    scrolledRef.current = next;
    setScrolled(next);
  }, []);

  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const cancelSearch = useCallback(() => {
    setText("");
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);
  // Android's back button leaves the search before it leaves the tab (there is no such button on iOS or the web).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || (!searching && !searchFocused)) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        cancelSearch();
        return true;
      });
      return () => sub.remove();
    }, [searching, searchFocused, cancelSearch]),
  );

  const openChat = useCallback(
    (c: ConversationSummary) => {
      Keyboard.dismiss();
      router.push({ pathname: "/messages/[id]", params: { id: c.id } });
    },
    [router],
  );
  const openMessage = useCallback(
    (m: MessageWithSender) => {
      Keyboard.dismiss();
      router.push({ pathname: "/messages/[id]", params: { id: m.conversation_id, at: m.id } });
    },
    [router],
  );
  const newChat = useCallback(() => router.push("/messages/new"), [router]);
  const openMyProfile = useCallback(() => router.navigate("/(tabs)/profile"), [router]);

  const chatMenu = useCallback(
    (c: ConversationSummary) => {
      hapticTap();
      const options: SheetOption[] = [];
      if (c.unreadCount > 0) {
        options.push({
          label: "Mark as read",
          icon: "checkmark-done-outline",
          onPress: () => {
            setData((prev) => prev?.map((x) => (x.id === c.id ? { ...x, unreadCount: 0 } : x)) ?? prev);
            markConversationRead(supabase, c.id).catch(() => void refresh());
          },
        });
      }
      const other = c.type === "group" ? undefined : c.otherMembers[0];
      if (other) options.push({ label: "View profile", icon: "person-circle-outline", onPress: () => router.push({ pathname: "/profile/[id]", params: { id: other.id } }) });
      options.push({ label: "Chat info", icon: "information-circle-outline", onPress: () => router.push({ pathname: "/messages/info/[id]", params: { id: c.id } }) });
      showSheet(options, c.title);
    },
    [router, setData, refresh, showSheet],
  );

  if (!sessionLoading && !user) {
    return (
      <View style={styles.screen}>
        <InboxHeader me={null} filter="all" unreadChats={0} onFilter={setFilter} onAvatar={openMyProfile} scrolled={false} />
        <EmptyState icon="chatbubbles-outline" title="Log in to see your messages" action={<Button title="Log in" onPress={() => router.push("/(auth)/login")} />} />
      </View>
    );
  }

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.type) {
      case "chat": {
        const c = item.conversation;
        return <InboxRow conversation={c} username={c.type === "group" ? null : usernameOf(c.otherMembers[0]?.id)} now={now} onOpen={openChat} onMenu={chatMenu} />;
      }
      case "header":
        return <InboxSectionHeader title={item.title} />;
      case "message":
        return <InboxMessageRow message={item.message} conversation={item.conversation} query={messageSearch.query} me={userId} now={now} onOpen={openMessage} />;
      case "more":
        return <InboxNote action={`Show all ${item.count} chats`} onAction={() => setAllChatMatches(true)} />;
      case "searching":
        return <InboxNote loading />;
      case "failed":
        return <InboxNote text="Couldn't search your messages." action="Try again" onAction={messageSearch.retry} />;
      default:
        return null;
    }
  };

  function empty() {
    if (searching) {
      if (messageSearch.loading || (loading && !data)) return <InboxNote loading />;
      const label = inboxFilterLabel(filter).toLowerCase();
      return (
        <View style={styles.searchEmpty}>
          <EmptyState
            icon="search-outline"
            title={`No results for “${query}”`}
            body={filter === "all" ? "Try another name, @username or word." : `Nothing in your ${label} chats matches.`}
            action={filter === "all" ? undefined : <Button title="Search all chats" variant="secondary" onPress={() => setFilter("all")} />}
          />
        </View>
      );
    }
    if (loading && !data) return <Loading />;
    if (error && !data)
      return (
        <View style={styles.pad}>
          <ErrorBanner message={error} onRetry={() => void refresh()} />
        </View>
      );
    if (filter === "unread") return <EmptyState icon="mail-open-outline" title="You're all caught up" body="Chats with messages you haven't read show up here." action={<Button title="Show all chats" variant="secondary" onPress={() => setFilter("all")} />} />;
    if (filter === "groups") return <EmptyState icon="people-outline" title="No group chats" body="Group chats you're in show up here." action={<Button title="Show all chats" variant="secondary" onPress={() => setFilter("all")} />} />;
    return <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Message someone from a post, or start a new chat." action={<Button title="Start a chat" onPress={newChat} />} />;
  }

  return (
    <View style={styles.screen}>
      <InboxHeader me={user ? { name: profile?.full_name ?? null, avatarUrl: profile?.avatar_url ?? null } : null} filter={filter} unreadChats={unreadChats} onFilter={setFilter} onAvatar={openMyProfile} scrolled={scrolled}>
        {user ? <InboxSearchField value={text} onChangeText={setText} inputRef={inputRef} onFocusChange={setSearchFocused} showCancel={searchFocused || text.length > 0} onCancel={cancelSearch} accessibilityLabel="Search chats and messages" /> : null}
      </InboxHeader>
      {!user ? (
        <Loading />
      ) : (
        <FlatList
          key={listKey}
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={searching ? styles.searchContent : styles.listContent}
          refreshControl={searching ? undefined : <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.muted} colors={[colors.brand]} progressBackgroundColor={colors.elevated} />}
          ListEmptyComponent={empty()}
        />
      )}
      {user && !searching && !searchFocused ? <InboxNewChatButton onPress={newChat} /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Room under the last chat for the new-chat button.
  listContent: { flexGrow: 1, paddingBottom: 96 },
  searchContent: { paddingBottom: space.xl },
  searchEmpty: { paddingTop: space.xl },
  pad: { padding: space.lg },
}));
