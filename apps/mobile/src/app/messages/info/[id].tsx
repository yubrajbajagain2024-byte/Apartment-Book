import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, Share, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  APP_NAME,
  blockUser,
  formatDate,
  getConversation,
  getProfile,
  isBlocked,
  leaveConversation,
  REPORT_REASONS,
  reportContent,
  unblockUser,
  type ConversationSummary,
  type ReportReason,
  type SharedContentKind,
  type SharedItem,
} from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { InfoActionList, InfoButtons, InfoGroupCard, InfoMemberRow, InfoPersonCard, InfoSectionTitle, type InfoButton, type InfoListAction } from "@/components/messages/info-card";
import { confirmAction, notify } from "@/components/messages/info-dialogs";
import { MediaViewer, type MediaViewerItem } from "@/components/messages/media-viewer";
import { useSharedContent, type SharedTab } from "@/components/messages/shared-content";
import { SharedFileRow } from "@/components/messages/shared-file-row";
import { SharedLinkRow } from "@/components/messages/shared-link-row";
import { SharedMediaRow } from "@/components/messages/shared-media-row";
import { SharedTabs } from "@/components/messages/shared-tabs";
import { profileUrl } from "@/components/profile/share-profile-sheet";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { openChatLink, openInBrowser, sharedPostHref } from "@/lib/message-attachments";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Squares per row in the Media grid, and the hairline between them (Instagram's grid). */
const COLUMNS = 3;
const GAP = 2;

const NO_VIEWER_ITEMS: MediaViewerItem[] = [];

/** The rows under the card: the tabs (row 0, which sticks to the top), then the open tab's content. */
type Row =
  | { type: "tabs"; key: string }
  | { type: "media"; key: string; start: number; items: SharedItem[] }
  | { type: "file"; key: string; item: SharedItem }
  | { type: "link"; key: string; item: SharedItem }
  | { type: "status"; key: string };

const EMPTY_TEXT: Record<SharedContentKind, { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = {
  media: { icon: "images-outline", title: "No photos or videos yet", body: "Photos and videos sent in this chat show up here." },
  files: { icon: "document-outline", title: "No files yet", body: "PDFs, documents and other files sent in this chat show up here." },
  links: { icon: "link-outline", title: "No links yet", body: "Links and shared posts sent in this chat show up here." },
};

/**
 * Chat info, opened from a chat's header. A direct chat shows the other person (photo, name, @username; the card opens
 * their profile), round Profile, Search and Share buttons, everything the two of you sent each other under Shared (Media |
 * Files | Links, loading more as you scroll), and Block and Report. A group shows its name, its members (each opens their
 * profile), Search, Shared and Leave group; groups cannot be reported (reports are about a person or a post). Block,
 * Report and Leave group are also in the ••• menu at the top, so they are never a long scroll away in a chat with lots
 * of photos.
 */
export default function ChatInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const userId = user?.id ?? "";
  const conversationQ = useQuery(() => (userId && id ? getConversation(supabase, id, userId) : Promise.resolve(null)), [id, userId]);
  useEffect(() => {
    if (!sessionLoading && !user) router.replace("/(auth)/login");
  }, [sessionLoading, user, router]);

  if (sessionLoading || !user || (conversationQ.loading && !conversationQ.data)) return <Loading />;
  if (!conversationQ.data) {
    if (conversationQ.error) {
      return (
        <View style={{ padding: space.lg }}>
          <ErrorBanner message="Couldn't load this chat. Check your connection and try again." onRetry={() => void conversationQ.refresh()} />
        </View>
      );
    }
    return <EmptyState icon="chatbubbles-outline" title="Conversation not found" />;
  }
  return <ChatInfo conversation={conversationQ.data} userId={userId} reload={conversationQ.refresh} />;
}

function ChatInfo({ conversation, userId, reload }: { conversation: ConversationSummary; userId: string; reload: () => Promise<void> }) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const show = useActionSheet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isGroup = conversation.type === "group";
  const other = isGroup ? null : (conversation.otherMembers[0] ?? null);
  const otherId = other?.id ?? null;
  const profileQ = useQuery(() => (otherId ? getProfile(supabase, otherId) : Promise.resolve(null)), [otherId]);
  const blockedQ = useQuery(() => (otherId ? isBlocked(supabase, userId, otherId) : Promise.resolve(false)), [otherId, userId]);
  const shared = useSharedContent(conversation.id);
  const { ensure, freshUrls } = shared;
  const [tab, setTab] = useState<SharedContentKind>("media");
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"block" | "report" | "leave" | null>(null);

  // A tab loads the first time it is opened, and keeps its pages when you switch away and back.
  useEffect(() => {
    ensure(tab);
  }, [ensure, tab]);

  const listRef = useRef<FlatList<Row>>(null);
  const scrollY = useRef(0);
  const headerHeight = useRef(0);
  /** Another tab starts from its top, under the tabs (which stay stuck to the top), when the list is scrolled that far. */
  const selectTab = useCallback((next: SharedContentKind) => {
    setTab(next);
    if (scrollY.current > headerHeight.current) listRef.current?.scrollToOffset({ offset: headerHeight.current, animated: false });
  }, []);

  const name = other?.full_name ?? (isGroup ? conversation.title : "Deleted user");
  const firstName = (other?.full_name ?? "").trim().split(/\s+/)[0] || "them";
  const blocked = blockedQ.data === true;
  const username = profileQ.data?.username ?? null;

  // "You" for your own messages, else the member's name; someone who has since left keeps just the date.
  const names = useMemo(() => new Map(conversation.members.map((m) => [m.id, m.id === userId ? "You" : m.full_name])), [conversation.members, userId]);
  const metaFor = useCallback(
    (item: SharedItem) => {
      const who = item.senderId ? names.get(item.senderId) : undefined;
      const when = formatDate(item.createdAt);
      return who ? `${who} · ${when}` : when;
    },
    [names],
  );
  const labelFor = useCallback(
    (item: SharedItem) => {
      const what = item.kind === "video" ? "Video" : "Photo";
      const who = item.senderId ? names.get(item.senderId) : undefined;
      const from = who === "You" ? `${what} you sent` : who ? `${what} from ${who}` : what;
      return `${from}, ${formatDate(item.createdAt)}`;
    },
    [names],
  );

  const openProfile = useCallback((id: string) => router.push({ pathname: "/profile/[id]", params: { id } }), [router]);
  const openSearch = useCallback(() => router.push({ pathname: "/messages/search/[id]", params: { id: conversation.id } }), [router, conversation.id]);

  // Stable for the memoized squares; reads the newest page through the ref.
  const mediaItems = shared.tabs.media.items;
  const mediaRef = useRef(mediaItems);
  mediaRef.current = mediaItems;
  const openMedia = useCallback(
    async (index: number) => {
      const items = mediaRef.current;
      if (!items[index]) return;
      // URLs signed close to an hour ago are signed again first, so a video does not stop halfway.
      const urls = await freshUrls(items.flatMap((it) => (it.attachment ? [it.attachment.path] : [])));
      const list: MediaViewerItem[] = [];
      let start = -1;
      items.forEach((it, i) => {
        if (it.kind !== "image" && it.kind !== "video") return;
        const uri = it.legacyImageUrl ?? (it.attachment ? urls[it.attachment.path] : undefined);
        if (!uri) return;
        if (i === index) start = list.length;
        list.push({ kind: it.kind, uri, cacheKey: it.kind === "image" && it.attachment ? it.attachment.path : undefined });
      });
      if (start === -1) return notify("Couldn't open this", "Check your connection and try again.");
      setViewer({ items: list, index: start });
    },
    [freshUrls],
  );
  const onOpenMedia = useCallback((index: number) => void openMedia(index), [openMedia]);

  /** Files open in the in-app browser (Safari's sheet on iOS previews PDFs and documents), from a URL that will last. */
  const openFile = useCallback(
    async (item: SharedItem) => {
      const path = item.attachment?.path;
      if (!path) return;
      const url = (await freshUrls([path]))[path];
      if (!url) return notify("Couldn't open this file", "It may have been deleted, or you're offline.");
      await openInBrowser(url, colors.brand);
    },
    [freshUrls, colors.brand],
  );

  const openLink = useCallback(
    (item: SharedItem) => {
      // A shared post, reel or listing opens its own screen; so does a link to one on our website. Anything else opens
      // in the in-app browser, the same as a link tapped in the chat.
      if (item.sharedPost) return router.push(sharedPostHref(item.sharedPost));
      if (item.url && /^https?:\/\//i.test(item.url)) openChatLink(item.url, router, colors.brand);
    },
    [router, colors.brand],
  );

  const shareLink = useCallback((item: SharedItem) => {
    const url = item.sharedPost ? `${SITE_URL}${item.sharedPost.path}` : item.url;
    if (!url) return;
    Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => {});
  }, []);

  async function shareProfile() {
    if (!other) return;
    const url = profileUrl(other.id);
    const words = `${other.full_name}${username ? ` (@${username})` : ""} on ${APP_NAME}`;
    try {
      if (Platform.OS === "web") {
        const nav = typeof navigator !== "undefined" ? navigator : null;
        if (typeof nav?.share === "function") await nav.share({ title: words, text: words, url });
        else if (nav?.clipboard) {
          await nav.clipboard.writeText(url);
          notify("Link copied", url);
        }
        return;
      }
      // iOS shares the link as a link (with its preview) next to the words; Android takes one text.
      await Share.share(Platform.OS === "ios" ? { message: words, url } : { message: `${words}: ${url}`, url, title: words });
    } catch {
      // Closed, or nothing to share with: nothing to do.
    }
  }

  async function toggleBlock() {
    if (!other || busy) return;
    const ok = await confirmAction(
      blocked
        ? { title: `Unblock ${firstName}?`, message: "You'll be able to message each other and see each other's posts again.", confirm: "Unblock", destructive: false }
        : { title: `Block ${firstName}?`, message: "They won't be able to message you, and you won't see each other's posts.", confirm: "Block" },
    );
    if (!ok) return;
    setBusy("block");
    try {
      if (blocked) await unblockUser(supabase, userId, other.id);
      else await blockUser(supabase, userId, other.id);
      blockedQ.setData(!blocked);
      hapticSuccess();
    } catch (e) {
      notify(blocked ? "Could not unblock" : "Could not block", errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendReport(reason: ReportReason) {
    if (!other) return;
    setBusy("report");
    try {
      await reportContent(supabase, userId, { targetType: "profile", targetId: other.id, reason });
      hapticSuccess();
      notify("Thanks for letting us know", `Our team will review ${firstName}'s profile.`);
    } catch (e) {
      notify("Could not send the report", errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function report() {
    if (!other || busy) return;
    show(
      REPORT_REASONS.map((r) => ({ label: r.label, onPress: () => void sendReport(r.value) })),
      `Why are you reporting ${firstName}?`,
    );
  }

  async function leave() {
    if (busy) return;
    const ok = await confirmAction({ title: `Leave ${conversation.title}?`, message: "You'll stop getting messages from this group, and it will leave your chats.", confirm: "Leave" });
    if (!ok) return;
    setBusy("leave");
    try {
      await leaveConversation(supabase, conversation.id, userId);
      hapticSuccess();
      // The chat under this screen is gone for you now: back to the chats list.
      router.dismissTo("/messages");
    } catch (e) {
      setBusy(null);
      notify("Could not leave the group", errorText(e));
    }
  }

  // The same actions at the bottom of the screen and in the ••• menu.
  const actions: InfoListAction[] = isGroup
    ? [{ key: "leave", label: "Leave group", icon: "exit-outline", onPress: () => void leave(), busy: busy === "leave", disabled: busy !== null }]
    : other
      ? [
          blocked
            ? { key: "block", label: `Unblock ${firstName}`, icon: "lock-open-outline", tone: "brand", onPress: () => void toggleBlock(), busy: busy === "block", disabled: busy !== null }
            : { key: "block", label: `Block ${firstName}`, icon: "ban-outline", onPress: () => void toggleBlock(), busy: busy === "block", disabled: busy !== null || (blockedQ.loading && blockedQ.data === null) },
          { key: "report", label: `Report ${firstName}`, icon: "flag-outline", onPress: report, busy: busy === "report", disabled: busy !== null },
        ]
      : [];
  const menu: SheetOption[] = actions.map((a) => ({ label: a.label, icon: a.icon, destructive: a.tone !== "brand", onPress: a.onPress }));
  const openMenu = () => {
    if (!busy) show(menu);
  };

  const buttons: InfoButton[] = other
    ? [
        { key: "profile", label: "Profile", icon: "person-outline", onPress: () => openProfile(other.id) },
        { key: "search", label: "Search", icon: "search", onPress: openSearch },
        { key: "share", label: "Share", icon: "share-outline", onPress: () => void shareProfile() },
      ]
    : [{ key: "search", label: "Search", icon: "search", onPress: openSearch }];

  const state: SharedTab = shared.tabs[tab];
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [{ type: "tabs", key: "tabs" }];
    if (state.status !== "ready" || state.items.length === 0) {
      out.push({ type: "status", key: `status-${tab}` });
      return out;
    }
    if (tab === "media") {
      for (let i = 0; i < state.items.length; i += COLUMNS) out.push({ type: "media", key: `media-${i}`, start: i, items: state.items.slice(i, i + COLUMNS) });
    } else {
      state.items.forEach((item, i) => out.push({ type: tab === "files" ? "file" : "link", key: `${tab}-${item.messageId}-${i}`, item }));
    }
    return out;
  }, [state, tab]);

  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([reload(), profileQ.refresh(), blockedQ.refresh(), shared.refresh(tab)]);
    } finally {
      setRefreshing(false);
    }
  }

  const members = useMemo(() => {
    const me = conversation.members.filter((m) => m.id === userId);
    return [...me, ...conversation.members.filter((m) => m.id !== userId)];
  }, [conversation.members, userId]);

  const header = (
    <View onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}>
      {other ? (
        <InfoPersonCard name={name} username={username} detail={profileQ.data?.university?.name ?? null} avatarUrl={other.avatar_url} userId={other.id} onPress={() => openProfile(other.id)} />
      ) : isGroup ? (
        <InfoGroupCard name={conversation.title} memberCount={conversation.members.length} />
      ) : (
        <InfoPersonCard name={name} />
      )}
      <InfoButtons buttons={buttons} />
      {isGroup ? (
        <View>
          <InfoSectionTitle title="Members" count={members.length} />
          {members.map((m) => (
            <InfoMemberRow key={m.id} member={m} isMe={m.id === userId} onPress={() => openProfile(m.id)} />
          ))}
        </View>
      ) : null}
      <InfoSectionTitle title="Shared" />
    </View>
  );

  function renderStatus() {
    if (state.status === "error") {
      return (
        <View style={styles.statusBox}>
          <ErrorBanner message={state.error ?? "Couldn't load this."} onRetry={() => shared.retry(tab)} />
        </View>
      );
    }
    if (state.status !== "ready") {
      return (
        <View style={styles.statusBox}>
          <ActivityIndicator color={colors.brand} />
        </View>
      );
    }
    const empty = EMPTY_TEXT[tab];
    return (
      <View style={styles.empty}>
        <Ionicons name={empty.icon} size={30} color={colors.faint} />
        <Text style={styles.emptyTitle}>{empty.title}</Text>
        <Text style={styles.emptyBody}>{empty.body}</Text>
      </View>
    );
  }

  function renderRow({ item: row }: { item: Row }) {
    switch (row.type) {
      case "tabs":
        return <SharedTabs active={tab} onSelect={selectTab} />;
      case "status":
        return renderStatus();
      case "media":
        return <SharedMediaRow items={row.items} start={row.start} size={tile} gap={GAP} urls={shared.urls} labelFor={labelFor} onOpen={onOpenMedia} />;
      case "file":
        return row.item.attachment ? <SharedFileRow attachment={row.item.attachment} url={shared.urls[row.item.attachment.path]} meta={metaFor(row.item)} onPress={() => void openFile(row.item)} /> : null;
      case "link":
        return <SharedLinkRow item={row.item} meta={metaFor(row.item)} onPress={() => openLink(row.item)} onLongPress={() => shareLink(row.item)} />;
    }
  }

  const footer = (
    <View style={{ paddingBottom: insets.bottom + space.xl }}>
      {state.loadingMore ? (
        <View style={styles.more}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : state.moreError ? (
        <View style={styles.statusBox}>
          <ErrorBanner message={state.moreError} onRetry={() => shared.retry(tab)} />
        </View>
      ) : null}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          <InfoActionList actions={actions} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: isGroup ? "Group info" : "Chat info",
          headerRight:
            menu.length > 0
              ? () => (
                  <Pressable onPress={openMenu} hitSlop={8} accessibilityRole="button" accessibilityLabel="More options" style={styles.headerButton}>
                    <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        // Row 0 of the data is the tabs row; the list header counts as 0 here.
        stickyHeaderIndices={[1]}
        onEndReached={() => void shared.loadMore(tab)}
        onEndReachedThreshold={1}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={64}
        showsVerticalScrollIndicator={false}
      />
      <MediaViewer visible={viewer !== null} items={viewer?.items ?? NO_VIEWER_ITEMS} index={viewer?.index ?? 0} onClose={() => setViewer(null)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  statusBox: { paddingHorizontal: space.lg, paddingVertical: space.xl, alignItems: "stretch", justifyContent: "center" },
  more: { paddingVertical: space.lg, alignItems: "center" },
  empty: { alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center", marginTop: 4 },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 19 },
  actions: { paddingTop: space.xl },
}));
