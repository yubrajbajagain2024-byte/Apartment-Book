import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, FlatList, Keyboard, Platform, RefreshControl, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type TextInput } from "react-native";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { listConversations, listFriends, markConversationRead, type ConversationSummary, type MessageWithSender, type ProfileSummary } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { INBOX_PAGES, InboxHeader, InboxSearchField } from "@/components/messages/inbox-header";
import { InboxMessageRow, InboxNote, InboxRow, InboxSectionHeader } from "@/components/messages/inbox-row";
import { inInbox, matchConversations, useMessageSearch, useNow, useUsernames, type InboxFilter, type InboxPage } from "@/components/messages/inbox-utils";
import { InboxOnlineFriends, useOpenFriendChat } from "@/components/messages/online-friends";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { hapticSwipe, hapticTap } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useTabBarInset } from "@/lib/tab-bar";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useMessageRequests } from "@/lib/use-message-requests";

/** One line of a list: a chat, or while searching also section titles, found messages and status lines. */
type Item =
  | { key: string; type: "chat"; conversation: ConversationSummary }
  | { key: string; type: "header"; title: string }
  | { key: string; type: "message"; message: MessageWithSender; conversation: ConversationSummary | null }
  | { key: string; type: "more"; count: number }
  | { key: string; type: "searching" }
  | { key: string; type: "failed" };

const NO_CHATS: ConversationSummary[] = [];
const NO_FRIENDS: ProfileSummary[] = [];
/** While searching, this many chats show above the messages until "Show all" is tapped. */
const CHAT_MATCHES = 5;
const ORDER = INBOX_PAGES.map((p) => p.value);
/** A page change waits until the pager is this share of a page past the halfway point, so a finger resting on the line cannot knock back and forth. */
const MARGIN = 0.02;
const NOT_SCROLLED: Record<InboxPage, boolean> = { chats: false, groups: false };

/**
 * The Messages tab (between Explore and Profile in the bottom bar): its own top bar (the new-message pencil, the big
 * "Messages" title, Chats | Groups), a search box and the All | Unread | Requests pills, then the two pages side by side
 * in a pager like Home's: your direct chats and your group chats, newest first, a swipe or a tap on a label moving
 * between them with the same knock Home gives. Requests, a pill on Chats, holds the direct chats people you do not
 * follow started with you, until you reply (see useMessageRequests); the Messages tab's unread count counts them too.
 * Above the chats, right under the pills, Messenger's row of your friends who are online now (a tap opens your chat with
 * them) scrolls away with the list. Typing searches the page on screen by name, @username or group title, and below the
 * chats the words of every message you can read there; a found message opens its chat at that message. The lists follow
 * new messages live, and the row follows who comes online or goes offline.
 */
export default function MessagesScreen() {
  const styles = useStyles();
  const tabBar = useTabBarInset();
  const colors = useColors();
  const router = useRouter();
  const showSheet = useActionSheet();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const { user, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;
  const { data, error, loading, refresh, setData } = useQuery(() => (userId ? listConversations(supabase, userId) : Promise.resolve(NO_CHATS)), [userId]);
  const { data: friends, refresh: refreshFriends } = useQuery(() => (userId ? listFriends(supabase) : Promise.resolve(NO_FRIENDS)), [userId]);
  const { openingFriend, openFriend } = useOpenFriendChat();
  const [page, setPage] = useState<InboxPage>("chats");
  const pageRef = useRef<InboxPage>("chats");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [text, setText] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [allChatMatches, setAllChatMatches] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [scrolledPages, setScrolledPages] = useState(NOT_SCROLLED);
  const inputRef = useRef<TextInput>(null);
  const now = useNow(focused);

  // ---- The pager: Chats | Groups side by side, as on Home. The underline follows the finger on the native driver (scrollX);
  // the page is committed when the pager crosses the halfway point (one knock) or when a label is tapped (one knock).
  const pager = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  /** The page under the finger, by the halfway rule: one knock each time it changes. */
  const under = useRef(0);
  /** Page a label tap is scrolling to; until it gets there the scroll is not a swipe. */
  const target = useRef<number | null>(null);
  /** False until the pager has been placed at the current width, so the first layout cannot change the page. */
  const ready = useRef(false);
  const initialOffset = useRef({ x: 0, y: 0 });
  const show = useCallback((i: number) => {
    const next = ORDER[i];
    if (!next || next === pageRef.current) return;
    pageRef.current = next;
    setPage(next);
  }, []);
  const place = useCallback(() => {
    if (width <= 0) return;
    pager.current?.scrollTo({ x: ORDER.indexOf(pageRef.current) * width, animated: false });
    ready.current = true;
  }, [width]);
  useEffect(() => {
    ready.current = false;
  }, [width]);
  const selectPage = useCallback(
    (next: InboxPage) => {
      const i = ORDER.indexOf(next);
      if (i < 0 || next === pageRef.current) return;
      hapticSwipe();
      target.current = i;
      under.current = i;
      show(i);
      pager.current?.scrollTo({ x: i * width, animated: true });
    },
    [show, width],
  );
  const onPagerScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          if (width <= 0 || !ready.current) return;
          const pos = e.nativeEvent.contentOffset.x / width;
          if (target.current !== null) {
            if (Math.abs(pos - target.current) < MARGIN) target.current = null;
            return;
          }
          // A swipe: one knock each time the page under the finger changes, halfway across.
          if (Math.abs(pos - under.current) > 0.5 + MARGIN) {
            const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(pos)));
            if (i !== under.current) {
              under.current = i;
              hapticSwipe();
              show(i);
            }
          }
        },
      }),
    [scrollX, show, width],
  );
  const onSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      target.current = null;
      if (width <= 0) return;
      const i = Math.min(ORDER.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
      under.current = i;
      show(i);
    },
    [show, width],
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void refresh();
      void refreshFriends();
    }, [userId, refresh, refreshFriends]),
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
  const { requestIds } = useMessageRequests(conversations, userId);
  const requestCount = useMemo(() => conversations.filter((c) => requestIds.has(c.id)).length, [conversations, requestIds]);
  const query = text.trim();
  const searching = Boolean(userId) && query.length > 0;
  const messageSearch = useMessageSearch(text, Boolean(userId));

  // Direct chats show the other person's @username; group members' handles are only needed to search by them.
  const handleIds = useMemo(() => conversations.flatMap((c) => (c.type !== "group" || searching ? c.otherMembers.map((m) => m.id) : [])), [conversations, searching]);
  const usernameOf = useUsernames(handleIds);

  const byId = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  // The Unread pill's count: the chats with unread messages on the page on screen (requests not counted; they have their own pill).
  const unreadChats = useMemo(() => conversations.filter((c) => inInbox(c, page, "unread", requestIds)).length, [conversations, page, requestIds]);
  useEffect(() => setAllChatMatches(false), [query]);
  // Groups has no Requests pill: moving there with it chosen shows every group.
  const filterOn = useCallback((p: InboxPage): InboxFilter => (p === "groups" && filter === "requests" ? "all" : filter), [filter]);

  /** What page `p` lists right now: its chats under the pill, or the search's chats and messages among them. */
  const itemsFor = useCallback(
    (p: InboxPage): Item[] => {
      const f = filterOn(p);
      const visible = conversations.filter((c) => inInbox(c, p, f, requestIds));
      if (!searching) return visible.map((c) => ({ key: c.id, type: "chat", conversation: c }));
      const out: Item[] = [];
      const chatMatches = matchConversations(visible, query, usernameOf);
      if (chatMatches.length > 0) {
        out.push({ key: "chats", type: "header", title: p === "groups" ? "Groups" : "Chats" });
        const shown = allChatMatches ? chatMatches : chatMatches.slice(0, CHAT_MATCHES);
        for (const c of shown) out.push({ key: `chat-${c.id}`, type: "chat", conversation: c });
        if (shown.length < chatMatches.length) out.push({ key: "more", type: "more", count: chatMatches.length });
      }
      // A message from a chat this list does not know only shows under Chats, All.
      const messageMatches = messageSearch.rows.filter((m) => {
        const c = byId.get(m.conversation_id);
        return c ? inInbox(c, p, f, requestIds) : p === "chats" && f === "all";
      });
      if (messageMatches.length > 0) {
        out.push({ key: "messages", type: "header", title: "Messages" });
        for (const m of messageMatches) out.push({ key: `message-${m.id}`, type: "message", message: m, conversation: byId.get(m.conversation_id) ?? null });
      }
      if (messageSearch.loading) {
        if (out.length > 0) out.push({ key: "searching", type: "searching" });
      } else if (messageSearch.failed) out.push({ key: "failed", type: "failed" });
      return out;
    },
    [filterOn, conversations, requestIds, searching, query, usernameOf, allChatMatches, messageSearch.rows, messageSearch.loading, messageSearch.failed, byId],
  );
  const lists = useMemo(() => ORDER.map(itemsFor), [itemsFor]);

  // The hairline under the top bar shows once the page on screen has moved; a new list (search, another pill) starts at the top.
  const listKey = searching ? "search" : filter;
  useEffect(() => setScrolledPages(NOT_SCROLLED), [listKey]);
  const onListScroll = useCallback((p: InboxPage, e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > 0;
    setScrolledPages((prev) => (prev[p] === next ? prev : { ...prev, [p]: next }));
  }, []);
  const scrolled = scrolledPages[page];

  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([refresh(), refreshFriends()]);
    } finally {
      setPulling(false);
    }
  }, [refresh, refreshFriends]);

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
        <InboxHeader signedIn={false} page="chats" onPage={selectPage} scrollX={scrollX} pageWidth={width} requestCount={0} filter="all" unreadChats={0} onFilter={setFilter} scrolled={false} onNewChat={newChat} />
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

  function empty(p: InboxPage) {
    const f = filterOn(p);
    const everything = p === "chats" && f === "all";
    const showAll = () => {
      selectPage("chats");
      setFilter("all");
    };
    if (searching) {
      if (messageSearch.loading || (loading && !data)) return <InboxNote loading />;
      const scope = f === "requests" ? "message requests" : p === "groups" ? (f === "unread" ? "unread group chats" : "group chats") : "unread chats";
      return (
        <View style={styles.searchEmpty}>
          <EmptyState icon="search-outline" title={`No results for “${query}”`} body={everything ? "Try another name, @username or word." : `Nothing in your ${scope} matches.`} action={everything ? undefined : <Button title="Search all chats" variant="secondary" onPress={showAll} />} />
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
    if (f === "requests") return <EmptyState icon="mail-outline" title="No message requests" body="When someone you don't follow messages you, their chat shows up here. Reply to move it to All." />;
    if (f === "unread") return <EmptyState icon="mail-open-outline" title="You're all caught up" body={p === "groups" ? "Group chats with messages you haven't read show up here." : "Chats with messages you haven't read show up here."} action={<Button title="Show all" variant="secondary" onPress={() => setFilter("all")} />} />;
    if (p === "groups") return <EmptyState icon="people-outline" title="No group chats" body="Group chats you're in show up here." action={<Button title="Start a chat" onPress={newChat} />} />;
    return <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Message someone from a post, or start a new chat." action={<Button title="Start a chat" onPress={newChat} />} />;
  }

  const placeholder = page === "groups" ? "Search groups" : filter === "requests" ? "Search requests" : "Search chats";

  return (
    <View style={styles.screen}>
      <InboxHeader signedIn={Boolean(user)} page={page} onPage={selectPage} scrollX={scrollX} pageWidth={width} requestCount={requestCount} filter={filter} unreadChats={unreadChats} onFilter={setFilter} scrolled={scrolled} onNewChat={newChat}>
        {user ? <InboxSearchField value={text} onChangeText={setText} placeholder={placeholder} inputRef={inputRef} onFocusChange={setSearchFocused} showCancel={searchFocused || text.length > 0} onCancel={cancelSearch} accessibilityLabel="Search chats and messages" /> : null}
      </InboxHeader>
      {!user ? (
        <Loading />
      ) : (
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentOffset={initialOffset.current}
          scrollEventThrottle={16}
          onContentSizeChange={place}
          onScrollBeginDrag={() => {
            target.current = null;
          }}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onSettled}
          style={{ flex: 1 }}
        >
          {ORDER.map((p, i) => (
            <View key={p} style={{ width, flex: 1 }}>
              <FlatList
                key={`${p}:${listKey}`}
                data={lists[i]}
                keyExtractor={(item) => item.key}
                renderItem={renderItem}
                onScroll={(e) => onListScroll(p, e)}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={[searching ? styles.searchContent : styles.listContent, { paddingBottom: (searching ? space.xl : 96) + tabBar }]}
                refreshControl={searching ? undefined : <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.muted} colors={[colors.brand]} progressBackgroundColor={colors.elevated} />}
                ListHeaderComponent={
                  searching ? null : p === "chats" && filterOn(p) === "requests" ? (
                    requestCount > 0 ? <InboxNote text="From people you don't follow. Reply to move a chat to All." /> : null
                  ) : p === "chats" ? (
                    <InboxOnlineFriends friends={friends ?? NO_FRIENDS} me={userId} scrolled={scrolledPages.chats} opening={openingFriend} onOpen={openFriend} />
                  ) : null
                }
                ListEmptyComponent={empty(p)}
              />
            </View>
          ))}
        </Animated.ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  listContent: { flexGrow: 1, paddingBottom: 96 },
  searchContent: { paddingBottom: space.xl },
  searchEmpty: { paddingTop: space.xl },
  pad: { padding: space.lg },
}));
