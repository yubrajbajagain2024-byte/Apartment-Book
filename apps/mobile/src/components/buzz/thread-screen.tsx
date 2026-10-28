import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AppState, FlatList, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BUZZ_FEED_COPY,
  BUZZ_LIMITS,
  BUZZ_PROMPT_COPY,
  BUZZ_REPLY_COPY,
  BUZZ_THREAD_SHAPE,
  buildBuzzReplyForest,
  buzzErrorMessage,
  buzzReplyCountLabel,
  buzzReplyForestOrder,
  buzzReplyPath,
  buzzThreadRows,
  compactCount,
  createBuzzReply,
  findBuzzReplyNode,
  getBuzzReplies,
  getBuzzThread,
  isBuzzError,
  type Buzz,
  type BuzzReply,
  type BuzzReplySort,
  type BuzzThreadRow,
} from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { buzzTime, buzzWriteTarget, noteBuzzReadError } from "@/lib/buzz-actions";
import { markThreadSeen, threadLastSeen } from "@/lib/buzz-seen";
import { buzzState, getBuzzItem, getBuzzState, onBuzzEvent, patchBuzzItem, putBuzzItems, useBuzzItem, useBuzzState, type ReplyDraft } from "@/lib/buzz-store";
import { hapticSelect, hapticSuccess } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { motion } from "@/lib/theme";
import { openThread } from "./card";
import { BuzzGatePanel, BuzzSignedOutPanel, useBuzzGate } from "./gate";
import { ComposerGuard, ComposerModeBanner, useBuzzPostingStatus } from "./guard";
import { BuzzActionsHost, useBuzzItemMenu } from "./item-menu";
import { BuzzMediaActive, BuzzMediaView } from "./media";
import { useBuzzModeration } from "./moderation";
import { AliasLine, BuzzContent, BuzzTags, BuzzText, CollapsedFold, MoreButton, PollView, PromptLine, ShareButton, StatusChip, SupportLink, VoteCluster } from "./parts";
import { BuzzToastHost } from "./toast";
import { Badge, EmptyState, ErrorState, GUTTER, P, PageHeader, PIconButton, R, Segmented, Skeleton, T } from "./ui";

/*
 * A Buzz thread (UniVerse's ThreadPage, design §7.2, threaded like Reddit): a compact "Thread" header with the root's
 * menu; the root large, without card chrome; then the conversation as a tree. Every reply sits under the one it
 * answers, at any depth, joined to it by a thread line in the colour of that anon, so a back-and-forth reads top to
 * bottom like a story. Best (the default), New or Old orders each level. A tap on a reply's header folds it with
 * everything under it; long lists of replies wait behind "N more replies", and past six levels "Continue this thread"
 * shows that branch on its own. Replies that arrived since you last opened the thread carry a lime dot, and "N new"
 * goes to the first. Reply on each; folds for community-collapsed replies and anons you hid here; placeholders for
 * removed and deleted ones. At the bottom, the reply bar: "You're anonymous", the "replying to" chip, the words (500,
 * the count near the end) and send; or the locked / closed line. Publication is delayed by a random jitter, so
 * nothing is pushed live: the thread loads again when it comes back on screen, on pull to refresh, after your own
 * reply, and every 30 seconds while it is open (in the same order, so nothing moves while you read; a pull to refresh
 * orders it afresh). Opened at a reply (a feed card's "Top reply": /buzz/<id>?reply=<reply id>), it unfolds the way to
 * it, scrolls to it and lights it up a moment. On a database without 20261108000000_buzz_reply_tree.sql, replies come
 * on two levels, deeper ones with "↳ replying to Anon X".
 */

const POLL_MS = 30_000;
/** Replies asked for per call (the most the server sends at once), and the most one thread loads. */
const PAGE = 100;
const MAX_REPLIES = 500;

/* The tree's geometry: every level steps INDENT to the right; a row's avatar (AV) sits ROW_TOP from its top, and every
 * thread line runs through the centre of the avatar of the reply it belongs to. */
const AV = 24;
const INDENT = 22;
const ROW_TOP = 10;
const LINE = 1.5;
const lineX = (level: number) => GUTTER + level * INDENT + AV / 2;

const SORTS = [
  { value: "best" as const, label: "Best" },
  { value: "new" as const, label: "New" },
  { value: "old" as const, label: "Old" },
];

type ThreadState = { status: "loading" | "ready" | "error" | "missing"; error: string | null; replyIds: string[]; truncated: boolean };
const NO_IDS: ReadonlySet<string> = new Set();

export function BuzzThreadScreen({ threadId, replyId = null }: { threadId: string; replyId?: string | null }) {
  const router = useRouter();
  const { user, loading } = useSession();
  const gate = useBuzzGate();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)")), [router]);
  let body;
  if (!loading && !user) body = <Padded><BuzzSignedOutPanel /></Padded>;
  else if (gate.status === "accepted") return <Thread threadId={threadId} openAt={replyId} userId={user?.id ?? null} onBack={back} />;
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

function Thread({ threadId, openAt, userId, onBack }: { threadId: string; openAt: string | null; userId: string | null; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const [state, setState] = useState<ThreadState>({ status: "loading", error: null, replyIds: [], truncated: false });
  const [refreshing, setRefreshing] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seq = useRef(0);
  const inputRef = useRef<TextInputInstance>(null);
  const listRef = useRef<FlatList<BuzzThreadRow>>(null);
  const root = useBuzzItem<Buzz>(threadId);
  const sort = useBuzzState(useCallback((s) => s.replySort, []));
  /** Bumped when the replies may take a fresh order (the first load, a pull to refresh); quiet reloads keep the one on screen. */
  const [epoch, setEpoch] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_IDS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_IDS);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** When you last opened this thread before this visit: replies that arrived after it are new. */
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  /** The reply lit up for a moment (the one the thread was opened at). */
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void threadLastSeen(userId, threadId).then((at) => {
      if (live) setSeenBefore(at);
      void markThreadSeen(userId, threadId);
    });
    return () => {
      live = false;
    };
  }, [userId, threadId]);

  const load = useCallback(
    async (mode: "initial" | "refresh" | "quiet") => {
      const id = ++seq.current;
      try {
        const t = await getBuzzThread(supabase, threadId, PAGE);
        let items = t.replies.items;
        let next = t.replies.nextOffset;
        // The whole conversation at once: a tree paged by time would grow replies in the middle of the screen.
        while (next !== null && items.length < MAX_REPLIES) {
          const page = await getBuzzReplies(supabase, threadId, next, PAGE);
          if (id !== seq.current) return;
          items = [...items, ...page.items];
          next = page.nextOffset;
        }
        if (id !== seq.current) return;
        putBuzzItems([t.root, ...items]);
        if (mode !== "quiet") setEpoch((e) => e + 1);
        setState({ status: "ready", error: null, replyIds: items.map((r) => r.id), truncated: next !== null });
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

  // Back on screen: load again (not on the first focus, which the effect above covers). Leaving: you have seen it now.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else void load("quiet");
      return () => {
        if (userId) void markThreadSeen(userId, threadId);
      };
    }, [load, userId, threadId]),
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

  // The conversation as a tree, in the chosen order; a quiet reload keeps the order the reader sees.
  const order = useRef<{ key: string; positions: Map<string, number> } | null>(null);
  const forest = useMemo(() => {
    const replies = state.replyIds.map((id) => getBuzzItem<BuzzReply>(id)).filter((r): r is BuzzReply => r?.kind === "reply");
    const key = `${sort}:${epoch}`;
    const built = buildBuzzReplyForest(threadId, replies, sort, order.current?.key === key ? order.current.positions : undefined);
    order.current = { key, positions: buzzReplyForestOrder(built) };
    return built;
  }, [state.replyIds, sort, epoch, threadId]);
  const rows = useMemo(() => buzzThreadRows(forest, { collapsed, expanded, focusId }), [forest, collapsed, expanded, focusId]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // A branch shown on its own whose reply has gone (deleted, reported): back to the whole thread.
  useEffect(() => {
    if (focusId && !findBuzzReplyNode(forest, focusId)) setFocusId(null);
  }, [focusId, forest]);
  /** The database sends treeParentId (20261108000000_buzz_reply_tree.sql): every reply nests under the one it answers. */
  const nested = useMemo(() => state.replyIds.some((id) => getBuzzItem<BuzzReply>(id)?.treeParentId !== undefined), [state.replyIds]);
  const nestedRef = useRef(nested);
  nestedRef.current = nested;
  const freshCount = useMemo(() => state.replyIds.filter((id) => isFresh(getBuzzItem<BuzzReply>(id), seenBefore)).length, [state.replyIds, seenBefore]);

  const animate = useCallback(() => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(motion.base, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }, [reduceMotion]);
  const toggle = useCallback(
    (id: string) => {
      animate();
      hapticSelect();
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    [animate],
  );
  const showMore = useCallback(
    (parentId: string) => {
      animate();
      hapticSelect();
      setExpanded((prev) => new Set(prev).add(parentId));
    },
    [animate],
  );
  /** "Continue this thread" (a reply) or back to every reply (null), from the top of what shows. */
  const focusOn = useCallback((id: string | null) => {
    hapticSelect();
    setFocusId(id);
    setTimeout(() => {
      if (id && rowsRef.current.length > 0) listRef.current?.scrollToIndex({ index: 0, animated: true, viewPosition: 0 });
      else listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 60);
  }, []);
  const jumpToNew = useCallback(() => {
    const index = rowsRef.current.findIndex((r) => r.kind === "reply" && isFresh(getBuzzItem<BuzzReply>(r.id), seenBefore));
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  }, [seenBefore]);

  const locked = root ? root.locked || root.status !== "active" : false;
  const replyTo = useCallback(
    (parentId: string | null) => {
      const draft = currentReplyDraft(threadId);
      buzzState.setReplyDraft(threadId, { text: draft.text, parentId });
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [threadId],
  );

  /** A reply to bring on screen once it is on the list (your new one, under the reply it answers; or the one opened at), and where. */
  const scrollTo = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const target = scrollTo.current;
    if (!target) return;
    const index = rows.findIndex((r) => r.kind === "reply" && r.id === target.id);
    if (index < 0) return;
    scrollTo.current = null;
    // Once the row is laid out (no cleanup: a later change of rows must not cancel it).
    setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: target.at }), 120);
  }, [rows]);

  // Opened at a reply: once the thread is in, open the way to it (and its branch alone when it is too deep), then go there.
  const opening = useRef(openAt);
  useEffect(() => {
    const id = opening.current;
    if (!id || state.status !== "ready") return;
    opening.current = null;
    const path = buzzReplyPath(forest, id);
    if (path.length === 0) return;
    const above = path.slice(0, -1).map((n) => n.reply.id);
    setExpanded((prev) => new Set([...prev, ...above]));
    if (above.length > BUZZ_THREAD_SHAPE.maxDepth) setFocusId(above[above.length - 1] ?? null);
    setHighlight(id);
    scrollTo.current = { id, at: 0.3 };
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2400);
  }, [state.status, forest]);

  const onSent = useCallback(
    (reply: BuzzReply, parentId: string | null) => {
      // Its place in the tree at once; the server's copy says the same a moment later.
      if (nestedRef.current) putBuzzItems([{ ...reply, treeParentId: parentId ?? threadId }]);
      if (parentId) {
        setCollapsed((prev) => {
          if (!prev.has(parentId)) return prev;
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        setExpanded((prev) => (prev.has(parentId) ? prev : new Set(prev).add(parentId)));
        // Too deep for the screen: show that branch, where the new reply can be seen.
        const at = rowsRef.current.find((r) => r.kind === "reply" && r.id === parentId);
        if (at && at.depth >= BUZZ_THREAD_SHAPE.maxDepth) setFocusId(parentId);
      }
      scrollTo.current = { id: reply.id, at: 0.6 };
      setState((s) => (s.replyIds.includes(reply.id) ? s : { ...s, replyIds: [...s.replyIds, reply.id] }));
      patchBuzzItem(threadId, (it) => (it.kind === "buzz" ? { ...it, replyCount: it.replyCount + 1 } : it));
      // The server's own order (and anything that arrived meanwhile) a moment later.
      setTimeout(() => void load("quiet"), 1500);
    },
    [threadId, load],
  );

  const renderRow = useCallback(
    ({ item, index }: { item: BuzzThreadRow; index: number }) => {
      if (item.kind === "more") return <MoreRow row={item} onPress={showMore} />;
      if (item.kind === "continue") return <ContinueRow row={item} onPress={focusOn} />;
      return <ReplyRow row={item} first={index === 0} locked={locked} nested={nested} seenBefore={seenBefore} highlighted={item.id === highlight} onReply={replyTo} onToggle={toggle} />;
    },
    [showMore, focusOn, locked, nested, seenBefore, highlight, replyTo, toggle],
  );

  const header =
    state.status === "ready" && root ? (
      <View>
        <RootArticle root={root} />
        <View style={styles.divider} />
        {state.replyIds.length === 0 ? (
          <EmptyState
            icon="chatbubble-outline"
            title={BUZZ_REPLY_COPY.emptyTitle}
            body={BUZZ_REPLY_COPY.emptyBody}
            action={!locked ? { label: BUZZ_REPLY_COPY.emptyAction, onPress: () => replyTo(null) } : undefined}
          />
        ) : (
          <>
            <RepliesBar count={Math.max(root.replyCount, state.replyIds.length)} answers={root.isPromptThread === true} sort={sort} fresh={freshCount} onJump={jumpToNew} />
            {focusId ? <FocusBar onBack={() => focusOn(null)} /> : null}
          </>
        )}
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
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        ListHeaderComponent={header ?? undefined}
        ListFooterComponent={
          state.truncated ? (
            <Text style={[T.footnote, styles.truncated]}>Showing the first {MAX_REPLIES} replies.</Text>
          ) : (
            <View style={{ height: 20 }} />
          )
        }
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
                <ReplyBar threadId={threadId} prompt={root.isPromptThread === true} inputRef={inputRef} bottom={insets.bottom} onSent={onSent} onLocked={() => void load("quiet")} />
              )
            ) : null}
          </KeyboardAvoidingView>
          <BuzzToastHost bottom={Math.max(insets.bottom, 12) + 112} enabled={focused} />
        </View>
      </BuzzActionsHost>
    </BuzzMediaActive.Provider>
  );
}

/** A reply someone else wrote that arrived after your last visit. */
function isFresh(reply: BuzzReply | undefined, seenBefore: number | null): boolean {
  return seenBefore !== null && reply?.kind === "reply" && !reply.isMine && reply.createdAt > seenBefore;
}

/** The header's "…" opens the root's menu: hiding, reporting or deleting it leaves the screen. */
function ThreadHeader({ root, onBack }: { root: Buzz | null; onBack: () => void }) {
  const openMenu = useBuzzItemMenu();
  return <PageHeader title="Thread" onBack={onBack} actions={root ? <MoreButton onPress={() => openMenu(root, { onHidden: onBack, onDeleted: onBack })} /> : undefined} />;
}

/**
 * The root, large and without card chrome: alias line ("✦ Daily prompt" on a prompt's thread; "Daily prompt · See all
 * answers" on an answer posted on its own), words, media, poll, support link, votes, replies, share.
 */
function RootArticle({ root }: { root: Buzz }) {
  const router = useRouter();
  const revealed = useBuzzState(useCallback((s) => s.revealed[root.id] === true, [root.id]));
  const folded = root.collapsed && !root.isMine && !revealed;
  const badge = root.isMine ? <StatusChip status={root.status} /> : root.campusShortName ? <Badge label={root.campusShortName} /> : null;
  return (
    <View style={styles.root} accessibilityLabel={root.isPromptThread ? BUZZ_PROMPT_COPY.label : "Buzz"}>
      {root.isPromptThread ? <PromptLine createdAt={root.createdAt} size="md" trailing={badge} /> : <AliasLine alias={root.alias} isMine={root.isMine} createdAt={root.createdAt} size="md" trailing={badge} />}
      <BuzzTags buzz={root} onOpenPrompt={(id) => openThread(router, id)} />
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

/** "12 replies" ("12 answers" under a prompt), "3 new" (to the first of them) and the order: Best, New, Old. */
function RepliesBar({ count, answers, sort, fresh, onJump }: { count: number; answers: boolean; sort: BuzzReplySort; fresh: number; onJump: () => void }) {
  return (
    <View style={styles.repliesBar}>
      <View style={styles.repliesTitle}>
        <Text style={[T.label, { color: P.ink }]} numberOfLines={1}>
          {answers ? BUZZ_PROMPT_COPY.answers(count) : `${compactCount(count)} ${buzzReplyCountLabel(count)}`}
        </Text>
        {fresh > 0 ? (
          <Pressable onPress={onJump} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${fresh} new since you last looked`} accessibilityHint="Goes to the first of them" style={({ pressed }) => [styles.newPill, pressed && { opacity: 0.75 }]}>
            <View style={styles.newDot} />
            <Text style={[T.micro, { color: P.accentInk }]}>{fresh} new</Text>
          </Pressable>
        ) : null}
      </View>
      <Segmented<BuzzReplySort> label="Order replies" value={sort} options={SORTS} onChange={buzzState.setReplySort} />
    </View>
  );
}

/** Over a branch shown on its own ("Continue this thread"): back to every reply. */
function FocusBar({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Show every reply" style={({ pressed }) => [styles.focusBar, pressed && { opacity: 0.75 }]}>
      <Icon name="arrow-back" size={16} color={P.accentInk} />
      <Text style={[T.labelSm, styles.flex, { color: P.accentInk }]}>All replies</Text>
      <Text style={[T.caption, { color: P.ink3 }]} numberOfLines={1}>
        One branch
      </Text>
    </Pressable>
  );
}

/** "#7c9bff" as [r, g, b], or null. */
function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CANVAS = rgbOf(P.canvas);
/** How much of the anon's colour a thread line carries over the canvas. */
const LINE_TINT = 0.42;

/** A thread line's colour: the anon's own colour, mixed into the canvas (opaque, so lines that meet do not double up). */
function lineColor(hex: string | undefined): string {
  const c = hex ? rgbOf(hex) : null;
  if (!c || !CANVAS) return P.lineStrong;
  const [r, g, b] = c.map((v, i) => Math.round(CANVAS[i]! + (v - CANVAS[i]!) * LINE_TINT));
  return `rgb(${r},${g},${b})`;
}

/** The line of the reply at `id`, in its anon's colour. */
function railColor(id: string | undefined): string {
  return lineColor(id ? getBuzzItem<BuzzReply>(id)?.alias.color : undefined);
}

/**
 * A row's thread lines: those of the replies above it that run on past it, its own link to the reply it answers (a
 * curve into its avatar, the line carrying on when more replies follow), and the stem down to its own replies.
 */
function Rails({ row, stemColor }: { row: BuzzThreadRow; stemColor?: string }) {
  const last = row.rails.length - 1;
  return (
    <>
      {row.rails.map((rail, k) => {
        if (rail === "none") return null;
        const color = railColor(row.railIds[k]);
        const left = lineX(k) - LINE / 2;
        return (
          <Fragment key={k}>
            {rail !== "end" ? <View pointerEvents="none" style={[styles.line, { left, backgroundColor: color }]} /> : null}
            {k === last ? <View pointerEvents="none" style={[styles.elbow, { left, borderColor: color }]} /> : null}
          </Fragment>
        );
      })}
      {row.kind === "reply" && row.stem ? <View pointerEvents="none" style={[styles.stem, { left: lineX(row.depth) - LINE / 2, backgroundColor: lineColor(stemColor) }]} /> : null}
    </>
  );
}

const sameRow = (a: BuzzThreadRow, b: BuzzThreadRow) => a === b || JSON.stringify(a) === JSON.stringify(b);

type ReplyRowProps = {
  row: Extract<BuzzThreadRow, { kind: "reply" }>;
  first: boolean;
  locked: boolean;
  nested: boolean;
  seenBefore: number | null;
  highlighted: boolean;
  onReply: (parentId: string) => void;
  onToggle: (id: string) => void;
};

/**
 * One reply in the tree: its header (a tap folds it and everything under it into this one line, "+N"), then, unfolded,
 * "↳ replying to …" on a two-level database, the words, votes and Reply.
 */
const ReplyRow = memo(
  function ReplyRow({ row, first, locked, nested, seenBefore, highlighted, onReply, onToggle }: ReplyRowProps) {
    const reply = useBuzzItem<BuzzReply>(row.id);
    const openMenu = useBuzzItemMenu();
    const reduceMotion = useReduceMotion();
    const revealed = useBuzzState(useCallback((s) => s.revealed[row.id] === true, [row.id]));
    if (!reply || reply.kind !== "reply") return null;
    const folded = reply.collapsed && !reply.isMine && !revealed;
    const fresh = isFresh(reply, seenBefore);
    const who = `${reply.isMine ? "You, " : ""}${reply.alias.label}${reply.isOp ? ", original poster" : ""}, ${buzzTime(reply.createdAt)}${fresh ? ", new" : ""}`;
    return (
      <View style={[styles.row, { paddingLeft: GUTTER + row.depth * INDENT }, row.depth === 0 && !first && styles.branch]}>
        {highlighted ? <Reanimated.View pointerEvents="none" entering={reduceMotion ? undefined : FadeIn.duration(180)} exiting={reduceMotion ? undefined : FadeOut.duration(900)} style={styles.glow} /> : null}
        <Rails row={row} stemColor={reply.alias.color} />
        <View style={reply.status === "deleted" && styles.deleted}>
          <View style={styles.head}>
            <Pressable
              onPress={() => onToggle(row.id)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={row.collapsed ? `${who}, folded${row.hidden > 0 ? ` with ${row.hidden} ${buzzReplyCountLabel(row.hidden)}` : ""}` : who}
              accessibilityHint={row.collapsed ? "Shows this reply and the replies under it" : "Folds this reply and the replies under it"}
              accessibilityState={{ expanded: !row.collapsed }}
              style={styles.headTap}
            >
              <AliasLine alias={reply.alias} isMine={reply.isMine} isOp={reply.isOp} createdAt={reply.createdAt} size="xs" fresh={fresh} trailing={row.collapsed && row.hidden > 0 ? <FoldedCount count={row.hidden} /> : null} />
            </Pressable>
            {row.collapsed ? null : (
              <View style={styles.trailing}>
                {reply.isMine ? <StatusChip status={reply.status} /> : null}
                <MoreButton onPress={() => openMenu(reply)} />
              </View>
            )}
          </View>
          {row.collapsed ? null : (
            <View style={styles.body}>
              {folded ? (
                <CollapsedFold id={reply.id} reason={reply.score <= -5 ? "community" : "anon"}>
                  {null}
                </CollapsedFold>
              ) : (
                <>
                  {!nested && reply.replyingTo ? (
                    <View style={styles.replyingTo} accessible accessibilityLabel={`Replying to ${reply.replyingTo.label}`}>
                      <Icon name="return-down-forward" size={13} color={P.ink3} />
                      <Text style={[T.caption, { color: P.ink3 }]} numberOfLines={1}>
                        replying to {reply.replyingTo.emoji} {reply.replyingTo.label}
                      </Text>
                    </View>
                  ) : null}
                  <BuzzText text={reply.text} status={reply.status} />
                  {reply.supportLink ? <SupportLink /> : null}
                  <View style={styles.actions}>
                    <VoteCluster item={reply} />
                    {!locked && reply.status === "active" ? (
                      <Pressable onPress={() => onReply(reply.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Reply to ${reply.alias.label}`} style={({ pressed }) => [styles.replyButton, pressed && { backgroundColor: P.surface2 }]}>
                        <Icon name="arrow-undo-outline" size={15} color={P.ink2} />
                        <Text style={[T.labelSm, { color: P.ink2 }]}>Reply</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    );
  },
  (a, b) =>
    sameRow(a.row, b.row) && a.first === b.first && a.locked === b.locked && a.nested === b.nested && a.seenBefore === b.seenBefore && a.highlighted === b.highlighted && a.onReply === b.onReply && a.onToggle === b.onToggle,
);

/** "+3" on a folded reply: how many replies it folds away. */
function FoldedCount({ count }: { count: number }) {
  return (
    <View style={styles.foldedCount}>
      <Text style={[T.micro, { color: P.ink2 }]}>+{compactCount(count)}</Text>
    </View>
  );
}

/** "4 more replies" under a reply whose further replies wait: a tap shows them all. */
const MoreRow = memo(
  function MoreRow({ row, onPress }: { row: Extract<BuzzThreadRow, { kind: "more" }>; onPress: (parentId: string) => void }) {
    const label = `${compactCount(row.count)} more ${buzzReplyCountLabel(row.count)}`;
    return (
      <View style={[styles.row, styles.linkRow, { paddingLeft: GUTTER + row.depth * INDENT }]}>
        <Rails row={row} />
        <Pressable onPress={() => onPress(row.parentId)} hitSlop={{ top: 6, bottom: 6, right: 16 }} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}>
          <View style={styles.linkDisc}>
            <Icon name="add" size={15} color={P.accentInk} />
          </View>
          <Text style={[T.labelSm, { color: P.accentInk }]}>{label}</Text>
        </Pressable>
      </View>
    );
  },
  (a, b) => sameRow(a.row, b.row) && a.onPress === b.onPress,
);

/** "Continue this thread" where the tree gets too deep for the screen: that branch on its own. */
const ContinueRow = memo(
  function ContinueRow({ row, onPress }: { row: Extract<BuzzThreadRow, { kind: "continue" }>; onPress: (id: string) => void }) {
    return (
      <View style={[styles.row, styles.linkRow, { paddingLeft: GUTTER + row.depth * INDENT }]}>
        <Rails row={row} />
        <Pressable
          onPress={() => onPress(row.id)}
          hitSlop={{ top: 6, bottom: 6, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel={`Continue this thread, ${row.count} ${buzzReplyCountLabel(row.count)}`}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.linkDisc}>
            <Icon name="arrow-forward" size={15} color={P.accentInk} />
          </View>
          <Text style={[T.labelSm, { color: P.accentInk }]}>Continue this thread</Text>
          <Text style={[T.caption, { color: P.ink3 }]}>· {compactCount(row.count)}</Text>
        </Pressable>
      </View>
    );
  },
  (a, b) => sameRow(a.row, b.row) && a.onPress === b.onPress,
);

/** The thread's reply draft as it is now (read when needed, not a subscription). */
function currentReplyDraft(threadId: string) {
  return getBuzzState().replyDrafts[threadId] ?? EMPTY_REPLY;
}

/** The bottom reply bar (UniVerse's footer): the inline banner, the "replying to" chip, the words and send. */
function ReplyBar({ threadId, prompt, inputRef, bottom, onSent, onLocked }: { threadId: string; prompt: boolean; inputRef: RefObject<TextInputInstance | null>; bottom: number; onSent: (reply: BuzzReply, parentId: string | null) => void; onLocked: () => void }) {
  const draft = useBuzzState(useCallback((s) => s.replyDrafts[threadId], [threadId])) ?? EMPTY_REPLY;
  const parent = useBuzzItem<BuzzReply>(draft.parentId);
  const posting = useBuzzPostingStatus();
  const moderation = useBuzzModeration();
  const [sending, setSending] = useState(false);
  const text = draft.text.trim();

  const send = async () => {
    if (!text || sending) return;
    setSending(true);
    const parentId = draft.parentId;
    try {
      const res = await createBuzzReply(await buzzWriteTarget(), threadId, { text, ...(parentId ? { parentId } : {}) });
      const { moderation: notice, ...reply } = res;
      putBuzzItems([reply]);
      buzzState.setReplyDraft(threadId, null);
      hapticSuccess();
      onSent(reply, parentId);
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
              placeholder={prompt && !parent ? BUZZ_PROMPT_COPY.threadPlaceholder : BUZZ_REPLY_COPY.placeholder}
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
  repliesBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 6 },
  repliesTitle: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  newPill: { flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingHorizontal: 8, borderRadius: R.pill, backgroundColor: P.accentSoft },
  newDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: P.accent },
  focusBar: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: GUTTER, marginTop: 6, marginBottom: 2, paddingHorizontal: 12, minHeight: 40, borderRadius: R.md, borderCurve: "continuous", backgroundColor: P.surface2 },
  // A row: no space between rows of a branch, so the thread lines run on from one to the next.
  row: { paddingRight: GUTTER, paddingTop: ROW_TOP, paddingBottom: 4 },
  // Each reply to the thread starts its own branch, a little apart from the one before.
  branch: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.lineSubtle },
  line: { position: "absolute", top: 0, bottom: 0, width: LINE },
  // The curve from the line above into the row's avatar (its centre, ROW_TOP + AV / 2 down).
  elbow: { position: "absolute", top: 0, height: ROW_TOP + AV / 2 + LINE / 2, width: INDENT - AV / 2 - 2 + LINE / 2, borderLeftWidth: LINE, borderBottomWidth: LINE, borderBottomLeftRadius: 8 },
  stem: { position: "absolute", top: ROW_TOP + AV + 3, bottom: 0, width: LINE },
  deleted: { opacity: 0.7 },
  // The reply the thread was opened at, lit up a moment.
  glow: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: P.accentSoft },
  head: { height: AV, flexDirection: "row", alignItems: "center", gap: 4 },
  headTap: { flex: 1, minWidth: 0, height: AV, justifyContent: "center" },
  trailing: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: -8, marginVertical: -6 },
  foldedCount: { height: 18, minWidth: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, borderRadius: R.pill, backgroundColor: P.surface3 },
  // The words start under the alias, to the right of the line that runs down from the avatar.
  body: { gap: 6, paddingLeft: AV + 8, paddingTop: 4 },
  replyingTo: { flexDirection: "row", alignItems: "center", gap: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: -4 },
  replyButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: R.pill },
  linkRow: { paddingBottom: 6 },
  link: { height: AV, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  linkDisc: { width: AV, height: AV, borderRadius: AV / 2, alignItems: "center", justifyContent: "center", backgroundColor: P.accentSoft },
  truncated: { color: P.ink3, textAlign: "center", paddingHorizontal: GUTTER, paddingVertical: 20 },
  lockedBar: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingHorizontal: GUTTER, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.canvas },
  replyBar: { gap: 8, paddingHorizontal: GUTTER, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.glassStrong },
  barTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  replyingChip: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, backgroundColor: P.surface2 },
  barInput: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 8 },
  inputBox: { flex: 1, minHeight: 44, borderRadius: R.lg, borderCurve: "continuous", backgroundColor: P.surface2, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  input: { color: P.ink, maxHeight: 120, padding: 0, margin: 0, textAlignVertical: "top" },
  counter: { alignSelf: "flex-end", marginTop: 4, fontVariant: ["tabular-nums"] },
});
