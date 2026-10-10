import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addBuzzComment,
  BUZZ_COMMENT_SORTS,
  buzzCommentSchema,
  deleteBuzzComment,
  getBuzz,
  labelFor,
  listBuzzComments,
  muteBuzzAuthor,
  reportContent,
  REPORT_REASONS,
  shortAge,
  threadBuzzComments,
  voteBuzzComment,
  type BuzzComment,
  type BuzzCommentNode,
  type BuzzCommentSort,
  type BuzzPost,
  type ReportReason,
} from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { AnonAvatar, BUZZ_GUTTER, BuzzPostBlock, BuzzTag, emitBuzzEvent, useBuzzMenu, useVote, VotePill, type Vote } from "@/components/home/buzz-card";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

/** How far each level of replies moves to the right. One thin vertical line is drawn per level. */
const INDENT = 14;

/** A reply as the list shows it: its place in the tree, plus which reply each vertical line on its left belongs to. */
type Row = BuzzCommentNode & { lineOwners: string[]; collapsed: boolean };

/** Reddit's round header button. */
function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.round, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

/** One anonymous Buzz thread with its anonymous replies, laid out like a Reddit thread. Only aliases are ever shown: the app never receives who wrote what. */
export default function BuzzThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const show = useActionSheet();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const [post, setPost] = useState<BuzzPost | null>(null);
  const [comments, setComments] = useState<BuzzComment[]>([]);
  const [sort, setSort] = useState<BuzzCommentSort>("best");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Votes cast since the last load. Kept apart from `comments` so a vote never reorders the replies under your finger.
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<BuzzComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** After posting, the list scrolls to this reply once it is on the list. */
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  const topIndex = useRef(-1);
  const seq = useRef(0);
  // The post's photo or video plays only while it is on screen and this screen is on top.
  const focused = useIsFocused();
  const headerHeight = useRef(0);
  const [mediaOnScreen, setMediaOnScreen] = useState(true);
  const needLogin = () => router.push("/(auth)/login");
  /** Opened from a link there may be nothing to go back to. */
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  const load = useCallback(async (): Promise<BuzzComment[] | null> => {
    const n = ++seq.current;
    try {
      const [p, c] = await Promise.all([getBuzz(supabase, id), listBuzzComments(supabase, id)]);
      if (n !== seq.current) return null;
      setPost(p);
      setComments(c);
      setVotes({});
      setError(null);
      if (p) emitBuzzEvent({ type: "patch", post: p });
      return c;
    } catch (e) {
      if (n === seq.current) setError(errorText(e, "Could not load this post. Please try again."));
      return null;
    } finally {
      if (n === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // Reload when the person signs in or out: "You" markers and votes depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reddit thread order, minus everything under a collapsed reply.
  const rows = useMemo<Row[]>(() => {
    const nodes = threadBuzzComments(comments, sort);
    const out: Row[] = [];
    const owners: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isCollapsed = collapsed.has(node.id);
      out.push({ ...node, lineOwners: owners.slice(0, node.depth), collapsed: isCollapsed });
      owners[node.depth] = node.id;
      // A reply's whole subtree follows it directly, so hiding it means skipping that many rows.
      if (isCollapsed) i += node.replyCount;
    }
    return out;
  }, [comments, sort, collapsed]);

  const topLevelCount = useMemo(() => rows.reduce((n, r) => n + (r.depth === 0 ? 1 : 0), 0), [rows]);

  // The newest rows, for scrolls that fire a moment later: by then a reply may have been folded away or removed.
  const rowsRef = useRef<Row[]>(rows);
  rowsRef.current = rows;

  /** Scrolls to a reply if it is (still) on the list. The index is looked up now, never earlier, so it can not be out of range. */
  const scrollToReply = useCallback((replyId: string, viewPosition = 0) => {
    const index = rowsRef.current.findIndex((r) => r.id === replyId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition });
  }, []);

  useEffect(() => {
    if (!scrollToId) return;
    const target = scrollToId;
    // Asked once, tried once: if the reply is not on the list (folded away, or gone), do not jump to it later.
    setScrollToId(null);
    if (!rows.some((r) => r.id === target)) return;
    // No cleanup on purpose: clearing scrollToId re-runs this effect, which would cancel the scroll.
    setTimeout(() => scrollToReply(target, 0.4), 200);
  }, [scrollToId, rows, scrollToReply]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const indexes = viewableItems.map((v) => v.index).filter((i): i is number => typeof i === "number");
    topIndex.current = indexes.length > 0 ? Math.min(...indexes) : -1;
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 30 }).current;

  /** Reddit's floating chevron: jump to the next top-level reply. */
  function jumpToNext() {
    const next = rows.find((r, i) => i > topIndex.current && r.depth === 0);
    if (next) scrollToReply(next.id);
    else listRef.current?.scrollToEnd({ animated: true });
  }

  function toggleCollapsed(replyId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  }

  function openComposer(target: BuzzComment | null) {
    if (!user) return needLogin();
    setReplyTo(target);
    setFormError(null);
    setComposing(true);
    // Already open (the keyboard may have been swiped away): bring the keyboard back.
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeComposer() {
    setComposing(false);
    setReplyTo(null);
    setFormError(null);
  }

  async function send() {
    if (!user) return needLogin();
    if (busy || !post) return;
    const parsed = buzzCommentSchema.safeParse({ body });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Write a reply");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await addBuzzComment(supabase, user.id, post.id, parsed.data.body, replyTo?.id ?? null);
      const known = new Set(comments.map((c) => c.id));
      setBody("");
      setReplyTo(null);
      setComposing(false);
      // Count right away, then take the real list (the new reply gets its alias from the server).
      setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
      const fresh = await load();
      // Show the person their own new reply, wherever the sort order put it.
      const mine = (fresh ?? []).filter((c) => c.isMine && !known.has(c.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (mine) setScrollToId(mine.id);
    } catch (e) {
      setFormError(errorText(e, "Could not post your reply. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function reportReply(c: BuzzComment) {
    if (!user) return needLogin();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: "buzz_comment", targetId: c.id, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", "Our team will review this reply.");
        },
      })),
      "Why are you reporting this reply?",
    );
  }

  function hidePerson(c: BuzzComment) {
    if (!user) return needLogin();
    const title = c.isOp ? "Hide this thread?" : "Hide this person's replies here?";
    const message = c.isOp
      ? "This reply is from the person who started the thread, so the whole thread will be hidden for you. They will not be told, and you will still not know who they are."
      : "You will no longer see their replies in this thread. They will not be told, and you will still not know who they are.";
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Hide",
        style: "destructive",
        onPress: () => {
          muteBuzzAuthor(supabase, { commentId: c.id }).then(
            () => {
              emitBuzzEvent({ type: "reload" });
              // Hiding the person who started the thread hides the whole thread.
              if (c.isOp) leave();
              else void load();
            },
            (e) => Alert.alert("Could not hide", errorText(e)),
          );
        },
      },
    ]);
  }

  function deleteReply(c: BuzzComment) {
    Alert.alert("Delete this reply?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteBuzzComment(supabase, c.id).then(
            () => {
              if (replyTo?.id === c.id) setReplyTo(null);
              void load();
            },
            (e) => Alert.alert("Could not delete", errorText(e)),
          );
        },
      },
    ]);
  }

  function replyMenu(c: BuzzComment) {
    const options: SheetOption[] = [{ label: "Reply", icon: "arrow-undo-outline", onPress: () => openComposer(c) }];
    if (!c.isMine) {
      options.push({ label: c.isOp ? "Hide this thread" : "Hide this person's replies here", icon: "eye-off-outline", onPress: () => hidePerson(c) });
      options.push({ label: "Report", icon: "flag-outline", destructive: true, onPress: () => reportReply(c) });
    }
    if (c.isMine || post?.isMine) options.push({ label: "Delete", icon: "trash-outline", destructive: true, onPress: () => deleteReply(c) });
    show(options);
  }

  const pickSort = () =>
    show(
      BUZZ_COMMENT_SORTS.map((s) => ({ label: s.value === sort ? `${s.label} ✓` : s.label, onPress: () => setSort(s.value) })),
      "Sort replies by",
    );

  const { menu: postMenu, share } = useBuzzMenu(post, {
    onRemoved: (removedId) => {
      emitBuzzEvent({ type: "remove", id: removedId });
      leave();
    },
    onMuted: () => {
      emitBuzzEvent({ type: "reload" });
      leave();
    },
  });

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <RoundButton icon="close" label="Close" onPress={leave} />
      <View style={{ flex: 1 }} />
      {post ? (
        <View style={styles.headerGroup}>
          <RoundButton icon="share-outline" label="Share this thread" onPress={share} />
          <RoundButton icon="ellipsis-horizontal" label="Post options" onPress={postMenu} />
        </View>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <Loading />
      </View>
    );
  }
  if (!post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {header}
        <View style={{ flex: 1, padding: 12 }}>
          {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : <EmptyState icon="chatbubbles-outline" title="This post is no longer available" body="It may have been deleted, or it is hidden for you." action={<Button title="Go back" variant="secondary" onPress={leave} />} />}
        </View>
      </View>
    );
  }

  const canSend = !busy && body.trim().length > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {header}
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: 88 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewability}
          onScrollToIndexFailed={(info) => {
            // The row has not been measured yet: get close, then try once more (by id: the rows may change in between).
            const targetId = rowsRef.current[info.index]?.id;
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            if (targetId) setTimeout(() => scrollToReply(targetId), 120);
          }}
          scrollEventThrottle={100}
          onScroll={(e) => {
            // Most of the post block has scrolled away: pause its video.
            const visible = headerHeight.current === 0 || e.nativeEvent.contentOffset.y < headerHeight.current - 80;
            setMediaOnScreen((prev) => (prev === visible ? prev : visible));
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.brand}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListHeaderComponent={
            <View style={{ backgroundColor: colors.card }} onLayout={(e) => (headerHeight.current = e.nativeEvent.layout.height)}>
              {error ? (
                <View style={{ paddingHorizontal: BUZZ_GUTTER, paddingTop: 8 }}>
                  <ErrorBanner message={error} onRetry={() => void load()} />
                </View>
              ) : null}
              <BuzzPostBlock
                post={post}
                active={focused && mediaOnScreen}
                onVote={(v) => {
                  // Only the vote is merged, into the newest post: a late answer must not bring back an old reply count.
                  setPost((p) => (p ? { ...p, score: v.score, myVote: v.myVote } : p));
                  emitBuzzEvent({ type: "vote", id: post.id, vote: v });
                }}
                onReply={() => openComposer(null)}
              />
              <View style={styles.sortRow}>
                <Pressable onPress={pickSort} hitSlop={8} style={styles.sort} accessibilityRole="button" accessibilityLabel={`Sort replies: ${labelFor(BUZZ_COMMENT_SORTS, sort)}`}>
                  <Text style={styles.sortText}>{labelFor(BUZZ_COMMENT_SORTS, sort)}</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>No replies yet. Be the first to answer.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ReplyRow
              reply={item}
              vote={votes[item.id]}
              onVoted={(v) => setVotes((prev) => ({ ...prev, [item.id]: v }))}
              onToggle={toggleCollapsed}
              onReply={() => openComposer(item)}
              onMenu={() => replyMenu(item)}
            />
          )}
        />
        {topLevelCount > 1 && !composing ? (
          <Pressable onPress={jumpToNext} style={({ pressed }) => [styles.jump, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Jump to the next reply">
            <Ionicons name="chevron-down" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {composing && replyTo ? (
          <View style={styles.replyingTo}>
            <Text style={styles.replyingText} numberOfLines={1}>
              Replying to {replyTo.alias}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel replying to this person">
              <Ionicons name="close" size={15} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        {composing && user ? (
          <View style={styles.composer}>
            <TextInput
              ref={inputRef}
              autoFocus
              value={body}
              onChangeText={(v) => {
                setBody(v);
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                // Nothing written: fold back into the "Join the conversation" bar.
                if (!body.trim() && !busy) closeComposer();
              }}
              placeholder={replyTo ? "Write your reply…" : "Join the conversation"}
              placeholderTextColor={colors.faint}
              keyboardAppearance={isDark ? "dark" : "light"}
              multiline
              maxLength={2000}
              style={styles.input}
              accessibilityLabel="Reply anonymously"
            />
            <Pressable onPress={() => void send()} disabled={!canSend} style={[styles.send, !canSend && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Send reply">
              <Ionicons name="arrow-up" size={20} color={colors.onBrand} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => openComposer(null)} style={styles.join} accessibilityRole="button" accessibilityLabel="Reply anonymously" accessibilityHint={user ? "Your name is never shown" : "Log in first. Your name is never shown"}>
            <Ionicons name="add" size={22} color={colors.text} />
            <Text style={styles.joinText} numberOfLines={1}>
              {body.trim() ? body.trim() : user ? "Join the conversation" : "Log in to join the conversation"}
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

type ReplyRowProps = {
  reply: Row;
  /** My vote cast since the last load, if any. */
  vote?: Vote;
  onVoted: (vote: Vote) => void;
  onToggle: (id: string) => void;
  onReply: () => void;
  onMenu: () => void;
};

/** One reply, Reddit style: lines on the left for each level, avatar and alias, the text, then ⋯ / Reply / votes on the right. */
function ReplyRow({ reply: c, vote: override, onVoted, onToggle, onReply, onMenu }: ReplyRowProps) {
  const colors = useColors();
  const styles = useStyles();
  const { vote, cast } = useVote("reply", c.id, override ?? c, (value) => voteBuzzComment(supabase, c.id, value), onVoted);
  const label = `Reply from ${c.alias}${c.isMine ? ", you" : ""}${c.isOp ? ", who started the thread" : ""}`;

  return (
    <View style={[styles.reply, { paddingLeft: BUZZ_GUTTER + c.depth * INDENT }, c.depth === 0 && styles.replyTop]}>
      {/* One thin line per level. Tapping a line folds the reply it belongs to, like Reddit. */}
      {c.lineOwners.map((owner, i) => (
        // Hidden from screen readers: each reply's own head already offers "collapse", so these would only be up to five identical buttons.
        <Pressable key={owner + i} onPress={() => onToggle(owner)} style={[styles.lineHit, { left: BUZZ_GUTTER + i * INDENT - 6 }]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.line} />
        </Pressable>
      ))}

      <Pressable
        onPress={() => onToggle(c.id)}
        onLongPress={c.collapsed ? undefined : onMenu}
        delayLongPress={300}
        style={styles.replyHead}
        accessibilityRole="button"
        accessibilityLabel={c.collapsed ? `${label}, collapsed` : label}
        accessibilityHint={c.collapsed ? "Tap to show" : "Tap to collapse, long press for options"}
      >
        <AnonAvatar alias={c.alias} size={c.collapsed ? 22 : 28} />
        <Text style={styles.alias} numberOfLines={1}>
          {c.alias}
        </Text>
        <Text style={styles.age}>• {shortAge(c.createdAt)}</Text>
        {c.isOp ? <BuzzTag label="OP" /> : null}
        {c.isMine ? <BuzzTag label="You" tone="green" /> : null}
        {c.collapsed && c.replyCount > 0 ? (
          <View style={styles.more}>
            <Text style={styles.moreText}>+{c.replyCount}</Text>
          </View>
        ) : null}
      </Pressable>

      {c.collapsed ? null : (
        <>
          <Text style={styles.replyBody} selectable>
            {c.body}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={onMenu} hitSlop={8} style={styles.action} accessibilityRole="button" accessibilityLabel="Reply options">
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
            </Pressable>
            <Pressable onPress={onReply} hitSlop={8} style={styles.action} accessibilityRole="button" accessibilityLabel={`Reply to ${c.alias}`}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.muted} />
              <Text style={styles.actionText}>Reply</Text>
            </Pressable>
            <VotePill bare vote={vote} onVote={(d) => void cast(d)} labels={["Upvote reply", "Downvote reply"]} />
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors, scheme) => ({
  // In dark the bar is black over the grey post, so a hairline marks the edge; in light both are white and run together.
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 6, backgroundColor: colors.bar, borderBottomWidth: scheme === "dark" ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border },
  headerGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },

  sortRow: { flexDirection: "row", paddingHorizontal: BUZZ_GUTTER, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sort: { flexDirection: "row", alignItems: "center", gap: 4 },
  sortText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  emptyWrap: { marginTop: 6, backgroundColor: colors.card, paddingVertical: 28, paddingHorizontal: BUZZ_GUTTER, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  empty: { color: colors.muted, textAlign: "center" },

  reply: { backgroundColor: colors.card, paddingRight: BUZZ_GUTTER, paddingTop: 10, paddingBottom: 4 },
  /** The band between two top-level replies is the list's background (colors.bg) showing through, with a hairline so it shows on white too. */
  replyTop: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineHit: { position: "absolute", top: 0, bottom: 0, width: 13, alignItems: "center" },
  line: { position: "absolute", top: 0, bottom: 0, left: 6, width: 1, backgroundColor: colors.border },
  replyHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 6 },
  alias: { fontSize: 13, fontWeight: "700", color: colors.muted, flexShrink: 1, marginLeft: 2 },
  age: { fontSize: 13, color: colors.muted },
  more: { backgroundColor: colors.input, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  moreText: { fontSize: 11, fontWeight: "700", color: colors.muted },
  replyBody: { fontSize: 15, color: colors.text, lineHeight: 21 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16, paddingTop: 4 },
  action: { height: 28, flexDirection: "row", alignItems: "center", gap: 5 },
  actionText: { fontSize: 13, fontWeight: "700", color: colors.muted },

  jump: {
    position: "absolute",
    right: 16,
    bottom: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.elevated,
    // The shadow lifts it off a light screen; on black only this hairline outline does.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  composerWrap: { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bar },
  replyingTo: { alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  replyingText: { flexShrink: 1, fontSize: 12, fontWeight: "600", color: colors.muted },
  formError: { color: colors.red, fontSize: 12, paddingHorizontal: 4 },
  join: { height: 44, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.input, borderRadius: 22, paddingHorizontal: 14 },
  joinText: { flex: 1, fontSize: 15, color: colors.muted },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 140, backgroundColor: colors.input, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
}));
