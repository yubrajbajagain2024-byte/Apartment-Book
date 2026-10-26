import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BUZZ_FEED_COPY,
  BUZZ_LIMITS,
  BUZZ_PAGE,
  BUZZ_REPLY_COPY,
  buildBuzzReplyTree,
  buzzErrorMessage,
  compactCount,
  createBuzzReply,
  getBuzzReplies,
  getBuzzThread,
  isBuzzError,
  type Buzz,
  type BuzzReply,
} from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { buzzWriteTarget, noteBuzzReadError } from "@/lib/buzz-actions";
import { buzzState, getBuzzItem, getBuzzState, onBuzzEvent, patchBuzzItem, putBuzzItems, useBuzzItem, useBuzzState, type ReplyDraft } from "@/lib/buzz-store";
import { hapticSuccess } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { BuzzGatePanel, BuzzSignedOutPanel, useBuzzGate } from "./gate";
import { ComposerGuard, ComposerModeBanner, useBuzzPostingStatus } from "./guard";
import { BuzzActionsHost, useBuzzItemMenu } from "./item-menu";
import { BuzzMediaActive, BuzzMediaView } from "./media";
import { useBuzzModeration } from "./moderation";
import { AliasLine, BuzzContent, BuzzText, CollapsedFold, MoreButton, PollView, ShareButton, StatusChip, SupportLink, VoteCluster } from "./parts";
import { BuzzToastHost } from "./toast";
import { Badge, EmptyState, ErrorState, GUTTER, P, PageHeader, PIconButton, R, Skeleton, T } from "./ui";

/*
 * A Buzz thread (UniVerse's ThreadPage, design §7.2): a compact "Thread" header with the root's menu; the root large,
 * without card chrome; replies two levels deep (a depth-2 reply sits under its parent behind a 2pt rail, deeper ones
 * arrive flattened from the server with "↳ replying to Anon X"); Reply on each; folds for community-collapsed replies
 * and anons you hid here; placeholders for removed and deleted ones; more replies as you scroll. At the bottom, the
 * reply bar: "You're anonymous", the "replying to" chip, the words (500, the count near the end) and send; or the
 * locked / closed line. Publication is delayed by a random jitter, so nothing is pushed live: the thread loads again
 * when it comes back on screen, on pull to refresh, after your own reply, and every 30 seconds while it is open.
 */

const POLL_MS = 30_000;
/** A refresh asks for the replies already shown, up to this many, in one call. */
const REFRESH_LIMIT = 100;

type ReplyRowData = { id: string; child: boolean };
type ThreadState = { status: "loading" | "ready" | "error" | "missing"; error: string | null; replyIds: string[]; nextOffset: number | null };

export function BuzzThreadScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { user, loading } = useSession();
  const gate = useBuzzGate();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)")), [router]);
  let body;
  if (!loading && !user) body = <Padded><BuzzSignedOutPanel /></Padded>;
  else if (gate.status === "accepted") return <Thread threadId={threadId} onBack={back} />;
  else if (gate.status === "required") body = <Padded><BuzzGatePanel variant="page" onDismiss={back} /></Padded>;
  else if (gate.status === "error") body = <ErrorState title={BUZZ_FEED_COPY.loadError} message={gate.error} onRetry={gate.retry} style={{ paddingTop: 32 }} />;
  else body = <ThreadSkeleton />;
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <PageHeader title="Thread" onBack={back} />
      {body}
    </View>
  );
}

function Padded({ children }: { children: ReactNode }) {
  return <View style={{ paddingTop: 12 }}>{children}</View>;
}

function Thread({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [state, setState] = useState<ThreadState>({ status: "loading", error: null, replyIds: [], nextOffset: null });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seq = useRef(0);
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<ReplyRowData>>(null);
  const root = useBuzzItem<Buzz>(threadId);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "quiet") => {
      const id = ++seq.current;
      const shown = stateRef.current.replyIds;
      try {
        const t = await getBuzzThread(supabase, threadId, Math.min(REFRESH_LIMIT, Math.max(BUZZ_PAGE.replies, shown.length)));
        if (id !== seq.current) return;
        putBuzzItems([t.root, ...t.replies.items]);
        const fresh = t.replies.items.map((r) => r.id);
        const seen = new Set(fresh);
        // Replies paged in beyond what the refresh asked for stay, after it.
        const tail = shown.filter((x) => !seen.has(x) && shown.indexOf(x) >= fresh.length);
        const prev = stateRef.current.nextOffset;
        setState({ status: "ready", error: null, replyIds: [...fresh, ...tail], nextOffset: tail.length > 0 && prev !== null ? Math.max(prev, t.replies.nextOffset ?? 0) : t.replies.nextOffset });
      } catch (e) {
        if (id !== seq.current) return;
        const message = noteBuzzReadError(e);
        if (isBuzzError(e, "not_found")) setState((s) => ({ ...s, status: "missing", error: message }));
        else if (mode === "initial" || stateRef.current.status !== "ready") setState((s) => ({ ...s, status: "error", error: message }));
        else if (mode === "refresh") buzzState.toast(message, { tone: "error" });
      } finally {
        if (id === seq.current) setRefreshing(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  // Back on screen: load again (not on the first focus, which the effect above covers).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load("quiet");
    }, [load]),
  );

  // Every 30 seconds while the thread is on screen and the app in front.
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load("quiet");
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [focused, load]);

  useEffect(
    () =>
      onBuzzEvent((e) => {
        if (e.type === "removed") {
          if (e.id === threadId) return;
          setState((s) => (s.replyIds.includes(e.id) ? { ...s, replyIds: s.replyIds.filter((x) => x !== e.id) } : s));
        } else if (e.type === "thread" && e.threadId === threadId) void load("quiet");
      }),
    [threadId, load],
  );

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.status !== "ready" || s.nextOffset === null || loadingMore) return;
    const id = seq.current;
    setLoadingMore(true);
    try {
      const page = await getBuzzReplies(supabase, threadId, s.nextOffset);
      if (id !== seq.current) return;
      putBuzzItems(page.items);
      setState((cur) => {
        const have = new Set(cur.replyIds);
        return { ...cur, replyIds: [...cur.replyIds, ...page.items.map((r) => r.id).filter((x) => !have.has(x))], nextOffset: page.nextOffset };
      });
    } catch (e) {
      if (id === seq.current) buzzState.toast(noteBuzzReadError(e), { tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [threadId, loadingMore]);

  // Two visual levels: each depth-1 reply, then its children behind the rail.
  const rows = useMemo<ReplyRowData[]>(() => {
    const replies = state.replyIds.map((id) => getBuzzItem<BuzzReply>(id)).filter((r): r is BuzzReply => r?.kind === "reply");
    const out: ReplyRowData[] = [];
    for (const node of buildBuzzReplyTree(threadId, replies)) {
      out.push({ id: node.reply.id, child: false });
      for (const c of node.children) out.push({ id: c.id, child: true });
    }
    return out;
  }, [state.replyIds, threadId]);

  const locked = root ? root.locked || root.status !== "active" : false;
  const replyTo = useCallback(
    (parentId: string | null) => {
      const draft = currentReplyDraft(threadId);
      buzzState.setReplyDraft(threadId, { text: draft.text, parentId });
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [threadId],
  );

  /** Your new reply, to bring on screen once it is on the list (a depth-2 one lands under its parent, not at the end). */
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    const target = scrollTo.current;
    if (!target) return;
    const index = rows.findIndex((r) => r.id === target);
    if (index < 0) return;
    scrollTo.current = null;
    // Once the row is laid out (no cleanup: a later change of rows must not cancel it).
    setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.6 }), 120);
  }, [rows]);

  const onSent = useCallback(
    (reply: BuzzReply) => {
      scrollTo.current = reply.id;
      setState((s) => (s.replyIds.includes(reply.id) ? s : { ...s, replyIds: [...s.replyIds, reply.id] }));
      patchBuzzItem(threadId, (it) => (it.kind === "buzz" ? { ...it, replyCount: it.replyCount + 1 } : it));
      // The server's own order (and anything that arrived meanwhile) a moment later.
      setTimeout(() => void load("quiet"), 1500);
    },
    [threadId, load],
  );

  const header =
    state.status === "ready" && root ? (
      <View>
        <RootArticle root={root} />
        <View style={styles.divider} />
        {rows.length === 0 ? (
          <EmptyState
            icon="chatbubble-outline"
            title={BUZZ_REPLY_COPY.emptyTitle}
            body={BUZZ_REPLY_COPY.emptyBody}
            action={!locked ? { label: BUZZ_REPLY_COPY.emptyAction, onPress: () => replyTo(null) } : undefined}
          />
        ) : null}
      </View>
    ) : null;

  let content;
  if (state.status === "loading") content = <ThreadSkeleton />;
  else if (state.status === "missing") content = <ErrorState title="That buzz isn't available." message="It may have been deleted, or it is hidden for you." style={{ paddingTop: 32 }} />;
  else if (state.status === "error" || !root) content = <ErrorState title={BUZZ_FEED_COPY.loadError} message={state.error} onRetry={() => void load("initial")} style={{ paddingTop: 32 }} />;
  else
    content = (
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <ReplyRow id={item.id} child={item.child} locked={locked} onReply={replyTo} />}
        ListHeaderComponent={header ?? undefined}
        ListFooterComponent={loadingMore ? <View style={{ paddingHorizontal: GUTTER, paddingVertical: 12, gap: 8 }}><Skeleton w="70%" h={14} /><Skeleton w="40%" h={14} /></View> : <View style={{ height: 16 }} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        onScrollToIndexFailed={(info) => {
          // Not measured yet: get near it, then try once more.
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.6 }), 150);
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        indicatorStyle="white"
        windowSize={11}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load("refresh");
            }}
            tintColor={P.accent}
            colors={[P.accent]}
            progressBackgroundColor={P.surface2}
          />
        }
      />
    );

  return (
    <BuzzMediaActive.Provider value={focused}>
      <BuzzActionsHost>
        <View style={styles.screen}>
          <StatusBar style="light" />
          <ThreadHeader root={state.status === "ready" ? (root ?? null) : null} onBack={onBack} />
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.flex}>{content}</View>
            {state.status === "ready" && root ? (
              locked ? (
                <View style={[styles.lockedBar, { paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityRole="summary">
                  <Icon name="lock-closed-outline" size={15} color={P.ink3} />
                  <Text style={[T.footnote, { color: P.ink3 }]}>{root.locked ? BUZZ_REPLY_COPY.locked : BUZZ_REPLY_COPY.closed}</Text>
                </View>
              ) : (
                <ReplyBar threadId={threadId} inputRef={inputRef} bottom={insets.bottom} onSent={onSent} onLocked={() => void load("quiet")} />
              )
            ) : null}
          </KeyboardAvoidingView>
          <BuzzToastHost bottom={Math.max(insets.bottom, 12) + 112} enabled={focused} />
        </View>
      </BuzzActionsHost>
    </BuzzMediaActive.Provider>
  );
}

/** The header's "…" opens the root's menu: hiding, reporting or deleting it leaves the screen. */
function ThreadHeader({ root, onBack }: { root: Buzz | null; onBack: () => void }) {
  const openMenu = useBuzzItemMenu();
  return <PageHeader title="Thread" onBack={onBack} actions={root ? <MoreButton onPress={() => openMenu(root, { onHidden: onBack, onDeleted: onBack })} /> : undefined} />;
}

/** The root, large and without card chrome: alias line, words, media, poll, support link, votes, replies, share. */
function RootArticle({ root }: { root: Buzz }) {
  const revealed = useBuzzState(useCallback((s) => s.revealed[root.id] === true, [root.id]));
  const folded = root.collapsed && !root.isMine && !revealed;
  return (
    <View style={styles.root} accessibilityLabel="Buzz">
      <AliasLine alias={root.alias} isMine={root.isMine} createdAt={root.createdAt} size="md" trailing={root.isMine ? <StatusChip status={root.status} /> : root.campusShortName ? <Badge label={root.campusShortName} /> : null} />
      {folded ? (
        <CollapsedFold id={root.id} reason="community">
          {null}
        </CollapsedFold>
      ) : (
        <>
          <BuzzContent buzz={root} large />
          <BuzzMediaView media={root.media} />
        </>
      )}
      {root.poll ? <PollView threadId={root.id} poll={root.poll} isMine={root.isMine} disabled={root.status !== "active"} /> : null}
      {root.supportLink ? <SupportLink /> : null}
      <View style={styles.rootFooter}>
        <VoteCluster item={root} size="md" />
        <View style={styles.replyCount} accessible accessibilityLabel={`${root.replyCount} ${root.replyCount === 1 ? "reply" : "replies"}`}>
          <Icon name="chatbubble-outline" size={18} color={P.ink3} />
          <Text style={[T.footnote, { color: P.ink3, fontVariant: ["tabular-nums"] }]}>{compactCount(root.replyCount)}</Text>
        </View>
        <View style={styles.flex} />
        <ShareButton buzz={root} />
      </View>
    </View>
  );
}

/** One reply: its alias line and menu, "↳ replying to …" when it was flattened, the words, votes and Reply. */
const ReplyRow = memo(function ReplyRow({ id, child, locked, onReply }: { id: string; child: boolean; locked: boolean; onReply: (parentId: string) => void }) {
  const reply = useBuzzItem<BuzzReply>(id);
  const openMenu = useBuzzItemMenu();
  const revealed = useBuzzState(useCallback((s) => s.revealed[id] === true, [id]));
  if (!reply || reply.kind !== "reply") return null;
  const folded = reply.collapsed && !reply.isMine && !revealed;
  return (
    <View style={[styles.reply, child && styles.child]}>
      <View style={[child && styles.rail, reply.status === "deleted" && styles.deleted]}>
        {folded ? (
          <CollapsedFold id={reply.id} reason={reply.score <= -5 ? "community" : "anon"}>
            {null}
          </CollapsedFold>
        ) : (
          <View style={styles.replyBody}>
            <AliasLine
              alias={reply.alias}
              isMine={reply.isMine}
              isOp={reply.isOp}
              createdAt={reply.createdAt}
              trailing={
                <View style={styles.trailing}>
                  {reply.isMine ? <StatusChip status={reply.status} /> : null}
                  <MoreButton onPress={() => openMenu(reply)} />
                </View>
              }
            />
            {reply.replyingTo ? (
              <View style={styles.replyingTo} accessible accessibilityLabel={`Replying to ${reply.replyingTo.label}`}>
                <Icon name="return-down-forward" size={13} color={P.ink3} />
                <Text style={[T.caption, { color: P.ink3 }]} numberOfLines={1}>
                  replying to {reply.replyingTo.emoji} {reply.replyingTo.label}
                </Text>
              </View>
            ) : null}
            <BuzzText text={reply.text} status={reply.status} />
            {reply.supportLink ? <SupportLink /> : null}
            <View style={styles.replyActions}>
              <VoteCluster item={reply} />
              {!locked && reply.status === "active" ? (
                <Pressable onPress={() => onReply(reply.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Reply to ${reply.alias.label}`} style={({ pressed }) => [styles.replyButton, pressed && { backgroundColor: P.surface2 }]}>
                  <Text style={[T.labelSm, { color: P.ink2 }]}>Reply</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </View>
  );
});

/** The thread's reply draft as it is now (read when needed, not a subscription). */
function currentReplyDraft(threadId: string) {
  return getBuzzState().replyDrafts[threadId] ?? EMPTY_REPLY;
}

/** The bottom reply bar (UniVerse's footer): the inline banner, the "replying to" chip, the words and send. */
function ReplyBar({ threadId, inputRef, bottom, onSent, onLocked }: { threadId: string; inputRef: RefObject<TextInputInstance | null>; bottom: number; onSent: (reply: BuzzReply) => void; onLocked: () => void }) {
  const draft = useBuzzState(useCallback((s) => s.replyDrafts[threadId], [threadId])) ?? EMPTY_REPLY;
  const parent = useBuzzItem<BuzzReply>(draft.parentId);
  const posting = useBuzzPostingStatus();
  const moderation = useBuzzModeration();
  const [sending, setSending] = useState(false);
  const text = draft.text.trim();

  const send = async () => {
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await createBuzzReply(await buzzWriteTarget(), threadId, { text, ...(draft.parentId ? { parentId: draft.parentId } : {}) });
      const { moderation: notice, ...reply } = res;
      putBuzzItems([reply]);
      buzzState.setReplyDraft(threadId, null);
      hapticSuccess();
      onSent(reply);
      if (notice.status !== "held") buzzState.toast(BUZZ_REPLY_COPY.replied(reply.alias.label), { tone: "success" });
      moderation.showNotice(notice);
    } catch (e) {
      if (isBuzzError(e, "locked")) {
        buzzState.toast(BUZZ_REPLY_COPY.locked, { tone: "error" });
        onLocked();
      } else if (!moderation.handleWriteError(e, { onEdit: () => inputRef.current?.focus() })) buzzState.toast(buzzErrorMessage(e), { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  const canSend = text.length > 0 && !sending;
  return (
    <View style={[styles.replyBar, { paddingBottom: Math.max(bottom, 10) }]}>
      <ComposerGuard status={posting}>
        <View style={styles.barTop}>
          <ComposerModeBanner inline />
          {parent ? (
            <View style={styles.replyingChip}>
              <Icon name="return-down-forward" size={13} color={P.ink2} />
              <Text style={[T.caption, styles.shrink, { color: P.ink2 }]} numberOfLines={1}>
                {parent.alias.label}
              </Text>
              <Pressable onPress={() => buzzState.setReplyDraft(threadId, { text: draft.text, parentId: null })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Reply to the buzz instead">
                <Icon name="close" size={13} color={P.ink3} />
              </Pressable>
            </View>
          ) : null}
        </View>
        <View style={styles.barInput}>
          <View style={styles.inputBox}>
            <TextInput
              ref={inputRef}
              value={draft.text}
              onChangeText={(v) => buzzState.setReplyDraft(threadId, { text: v, parentId: draft.parentId })}
              placeholder={BUZZ_REPLY_COPY.placeholder}
              placeholderTextColor={P.ink4}
              keyboardAppearance="dark"
              multiline
              maxLength={BUZZ_LIMITS.replyText}
              style={[T.body, styles.input]}
              accessibilityLabel="Reply anonymously"
              accessibilityHint={parent ? `Replying to ${parent.alias.label}` : undefined}
            />
            {draft.text.length > BUZZ_LIMITS.replyText - 60 ? (
              <Text style={[T.caption, styles.counter, { color: draft.text.length >= BUZZ_LIMITS.replyText ? P.warning : P.ink3 }]}>
                {draft.text.length}/{BUZZ_LIMITS.replyText}
              </Text>
            ) : null}
          </View>
          <PIconButton icon="paper-plane-outline" label="Send reply" variant="accent" size={44} iconSize={20} onPress={() => void send()} disabled={!canSend} />
        </View>
      </ComposerGuard>
      {moderation.element}
    </View>
  );
}

const EMPTY_REPLY: ReplyDraft = { text: "", parentId: null };

function ThreadSkeleton() {
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: 12, gap: 16 }} accessibilityLabel="Loading the thread">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Skeleton w={36} h={36} circle />
        <Skeleton w={120} h={14} />
      </View>
      <View style={{ gap: 8 }}>
        <Skeleton w="100%" h={16} />
        <Skeleton w="94%" h={16} />
        <Skeleton w="70%" h={16} />
      </View>
      <Skeleton w={104} h={36} radius={R.pill} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  screen: { flex: 1, backgroundColor: P.canvas },
  root: { gap: 12, paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 16 },
  rootFooter: { flexDirection: "row", alignItems: "center", gap: 4 },
  replyCount: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: P.line },
  reply: { paddingHorizontal: GUTTER },
  child: { paddingLeft: GUTTER + 16 },
  rail: { borderLeftWidth: 2, borderLeftColor: P.line, paddingLeft: 12 },
  deleted: { opacity: 0.7 },
  replyBody: { gap: 8, paddingVertical: 10 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: -8 },
  replyingTo: { flexDirection: "row", alignItems: "center", gap: 4 },
  replyActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: R.pill },
  lockedBar: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingHorizontal: GUTTER, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.canvas },
  replyBar: { gap: 8, paddingHorizontal: GUTTER, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.glassStrong },
  barTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  replyingChip: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, backgroundColor: P.surface2 },
  barInput: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 8 },
  inputBox: { flex: 1, minHeight: 44, borderRadius: R.lg, borderCurve: "continuous", backgroundColor: P.surface2, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  input: { color: P.ink, maxHeight: 120, padding: 0, margin: 0, textAlignVertical: "top" },
  counter: { alignSelf: "flex-end", marginTop: 4, fontVariant: ["tabular-nums"] },
});
