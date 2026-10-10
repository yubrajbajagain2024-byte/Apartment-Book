import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View, type TextInput as TextInputType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addComment, blockUser, COMMENT_SORTS, compactCount, deleteComment, getMyCommentVotes, listComments, reportContent, REPORT_REASONS, shortAge, threadComments, voteComment, type CommentSort, type PostCommentNode, type PostCommentWithAuthor, type PostTargetType, type ReportReason } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { repliesLabel, useVote, type Vote } from "@/components/home/buzz-card";
import { hapticLike, hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { Avatar } from "./avatar";

/*
 * The thread looks like TikTok's comment sheet: no bubbles, a round avatar, the name in small grey, the comment in
 * dark text, then "5d  Reply" on the left and a heart with its count and a thumbs-down on the right. Replies step in
 * under their comment behind a thin line and stay folded behind "View 2 replies" until asked for. Holding a comment
 * opens its menu (Reply, Report, Block, Delete).
 */

const AVATAR = 36;
const REPLY_AVATAR = 24;
const GAP = 8;
/** Replies start where the parent's text does: the avatar plus the gap. */
const REPLY_INDENT = AVATAR + GAP;
/** Each deeper level steps in a little more (threadComments caps the depth, so phones stay readable). */
const INDENT = 16;
const LIKE_RED = "#ed4956";
/** How much of the comment the hold menu quotes in its title. */
const MENU_SNIPPET = 40;

/** What the list shows: a comment, or the "View 3 replies" / "Hide replies" line that belongs to a top-level comment. */
type Item = { kind: "comment"; node: PostCommentNode } | { kind: "toggle"; node: PostCommentNode; open: boolean };

/** The top-level comment a reply sits under. The walk stops at a parent that is not on the list (hidden by a block): threadComments shows that reply at the top. */
function rootOf(list: PostCommentWithAuthor[], id: string): string {
  const byId = new Map(list.map((c) => [c.id, c] as const));
  let cur = byId.get(id);
  while (cur?.parent_id && byId.has(cur.parent_id)) cur = byId.get(cur.parent_id);
  return cur?.id ?? id;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

export type CommentThreadOptions = {
  targetType: PostTargetType;
  targetId: string;
  /** Whose post this is: their comments carry the "Author" tag and they may delete any comment on it. */
  ownerId: string;
  onCountChange?: (delta: number) => void;
  /** A host that scrolls brings the composer back on screen when Reply is tapped (the sheet pins it, so it passes nothing). */
  revealComposer?: () => void;
};

/**
 * The state of one comment thread and everything you can do to it: load, sort, fold replies, reply, post, heart / dislike,
 * and the hold menu (Report, Block, Delete). Both the inline `Comments` and the bottom sheet build their screens from it.
 */
export function useCommentThread({ targetType, targetId, ownerId, onCountChange, revealComposer }: CommentThreadOptions) {
  const { user, profile } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(null);
  // The viewer's votes as loaded, and votes the server confirmed since. Kept apart from `comments`: a vote must never redraw the whole thread.
  const [myVotes, setMyVotes] = useState<Record<string, -1 | 1>>({});
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [sort, setSort] = useState<CommentSort>("top");
  // Top-level comments whose replies are shown. Folded by default, like TikTok; a reply you just posted opens its thread.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<PostCommentNode | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why the thread did not load, if it did not. `comments` stays null then, so the count stays unknown rather than reading zero.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by Retry: runs the load again.
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<TextInputType>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    let stale = false;
    // A new target, a different person signed in, or a retry: nothing from before applies.
    setComments(null);
    setLoadError(null);
    setMyVotes({});
    setVotes({});
    setExpanded(new Set());
    setReplyTo(null);
    setError(null);
    listComments(supabase, targetType, targetId).then(
      async (rows) => {
        if (stale) return;
        setComments(rows);
        // The thread shows at once; the lit hearts follow. Signed out there is nothing to ask for.
        const mine = await getMyCommentVotes(supabase, userId, rows.map((c) => c.id)).catch((): Record<string, -1 | 1> => ({}));
        if (!stale) setMyVotes(mine);
      },
      (e: unknown) => {
        // Nothing loaded: the list says so and offers Retry; the headings keep falling back rather than saying "No comments yet".
        if (!stale) setLoadError(errorText(e, "Could not load the comments"));
      },
    );
    return () => {
      stale = true;
    };
  }, [targetType, targetId, userId, attempt]);

  // Thread order: each comment followed by its replies. A comment's subtree follows it directly, so folding means skipping that many rows.
  const nodes = useMemo(() => threadComments(comments ?? [], myVotes, { sort }), [comments, myVotes, sort]);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      out.push({ kind: "comment", node });
      if (node.depth > 0 || node.replyCount === 0) continue;
      const open = expanded.has(node.id);
      if (open) for (let j = 1; j <= node.replyCount; j++) out.push({ kind: "comment", node: nodes[i + j] });
      i += node.replyCount;
      out.push({ kind: "toggle", node, open });
    }
    return out;
  }, [nodes, expanded]);

  const needLogin = () => router.push("/(auth)/login");
  /** Runs the thread load again after it failed. */
  const reload = () => setAttempt((n) => n + 1);
  // The input may already be focused with the keyboard swiped away: bring the keyboard back.
  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 50);

  function toggleReplies(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startReply(node: PostCommentNode) {
    if (!user) return needLogin();
    setReplyTo(node);
    // iOS leaves a focused input where it is when the keyboard comes up, so a Reply tapped far down a scrolling host would
    // focus a composer scrolled off the top. The host brings it back first.
    revealComposer?.();
    focusInput();
  }

  function cancelReply() {
    setReplyTo(null);
  }

  /** The server confirmed my vote on a comment: remembered here so a folded row comes back with the right numbers. */
  function confirmVote(id: string, vote: Vote) {
    setVotes((prev) => ({ ...prev, [id]: vote }));
  }

  async function submit() {
    const text = body.trim();
    if (!text || busy || !user) return;
    setBusy(true);
    setError(null);
    // Found now, from the thread the person is looking at: the reply's whole chain is already on the list.
    const root = replyTo ? rootOf(comments ?? [], replyTo.id) : null;
    try {
      const c = await addComment(supabase, user.id, targetType, targetId, text, replyTo?.id ?? null);
      setComments((prev) => [...(prev ?? []), c]);
      // A reply opens the thread it landed in, so you see it right away.
      if (root) setExpanded((prev) => new Set(prev).add(root));
      setBody("");
      setReplyTo(null);
      onCountChange?.(1);
      hapticSuccess();
    } catch (e) {
      setError(errorText(e, "Could not post your comment"));
    } finally {
      setBusy(false);
    }
  }

  /** The given comments and everything under them. Thread order lists parents before their replies, so one pass finds them all. */
  function withDescendants(ids: Iterable<string>): Set<string> {
    const gone = new Set(ids);
    for (const c of nodes) if (c.parent_id && gone.has(c.parent_id)) gone.add(c.id);
    return gone;
  }

  function drop(gone: Set<string>) {
    setComments((prev) => (prev ?? []).filter((c) => !gone.has(c.id)));
    setReplyTo((prev) => (prev && gone.has(prev.id) ? null : prev));
    onCountChange?.(-gone.size);
  }

  async function remove(node: PostCommentNode) {
    setError(null);
    try {
      await deleteComment(supabase, node.id);
    } catch (e) {
      setError(errorText(e, "Could not delete the comment"));
      return;
    }
    // The server deletes its replies with it.
    drop(withDescendants([node.id]));
  }

  async function block(node: PostCommentNode) {
    if (!user) return needLogin();
    setError(null);
    try {
      await blockUser(supabase, user.id, node.author.id);
    } catch (e) {
      setError(errorText(e, `Could not block ${node.author.full_name}`));
      return;
    }
    // Only what they wrote goes: the server hides their comments from now on but keeps other people's replies under them
    // (those thread at the top from here on, as they do after a reload), and the post's count only loses their comments.
    drop(new Set(nodes.filter((c) => c.user_id === node.author.id).map((c) => c.id)));
  }

  /** Sends the report, then says whether it got through: a "Thanks" the server never saw would be a lie. */
  async function sendReport(reporter: string, node: PostCommentNode, reason: ReportReason) {
    try {
      await reportContent(supabase, reporter, { targetType: "comment", targetId: node.id, reason });
      Alert.alert("Thanks", "Our team will review it.");
    } catch (e) {
      Alert.alert("Could not send the report", errorText(e));
    }
  }

  function report(node: PostCommentNode) {
    if (!user) return needLogin();
    const reporter = user.id;
    show(
      REPORT_REASONS.map((r) => ({ label: r.label, onPress: () => void sendReport(reporter, node, r.value) })),
      "Why are you reporting this?",
    );
  }

  function confirmBlock(node: PostCommentNode) {
    Alert.alert(`Block ${node.author.full_name}?`, "You won't see each other's posts, comments or messages.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => void block(node) },
    ]);
  }

  function confirmRemove(node: PostCommentNode) {
    Alert.alert("Delete this comment?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove(node) },
    ]);
  }

  /** The hold menu of one comment. */
  function openMenu(node: PostCommentNode) {
    if (!user) return needLogin();
    hapticTap();
    const text = node.body.replace(/\s+/g, " ").trim();
    const snippet = text.length > MENU_SNIPPET ? `${text.slice(0, MENU_SNIPPET).trimEnd()}…` : text;
    const mine = node.user_id === user.id;
    const options: SheetOption[] = [{ label: "Reply", icon: "arrow-undo-outline", onPress: () => startReply(node) }];
    // Nobody reports or blocks themselves.
    if (!mine) {
      options.push({ label: "Report", icon: "flag-outline", destructive: true, onPress: () => report(node) });
      options.push({ label: `Block ${firstName(node.author.full_name)}`, icon: "ban-outline", destructive: true, onPress: () => confirmBlock(node) });
    }
    if (mine || user.id === ownerId) options.push({ label: "Delete", icon: "trash-outline", destructive: true, onPress: () => confirmRemove(node) });
    show(options, `${node.author.full_name}: ${snippet}`);
  }

  return {
    user,
    profile,
    ownerId,
    comments,
    /** Comments loaded so far, replies included; null until the first load answers. */
    // After a failed load the true total is unknown even once something was posted: keep falling back to the host's count.
    count: comments === null || loadError ? null : comments.length,
    items,
    votes,
    sort,
    setSort,
    replyTo,
    body,
    setBody,
    busy,
    error,
    /** Why the thread did not load, if it did not; `reload` tries again. */
    loadError,
    reload,
    inputRef,
    needLogin,
    toggleReplies,
    startReply,
    cancelReply,
    confirmVote,
    submit,
    openMenu,
  };
}

export type CommentThread = ReturnType<typeof useCommentThread>;

/** "230 comments" with the small sort button right after it. `count` null (still loading) reads "Comments". */
export function CommentsHeading({ count, onSort, align = "center" }: { count: number | null; onSort: (sort: CommentSort) => void; align?: "center" | "left" }) {
  const show = useActionSheet();
  const label = count === null ? "Comments" : count === 0 ? "No comments yet" : `${count} ${count === 1 ? "comment" : "comments"}`;
  return (
    <View style={[styles.headingRow, align === "left" && { justifyContent: "flex-start" }]}>
      <Text style={styles.heading} accessibilityRole="header">
        {label}
      </Text>
      <Pressable
        onPress={() =>
          show(
            COMMENT_SORTS.map((s) => ({ label: s.label, onPress: () => onSort(s.value) })),
            "Sort comments",
          )
        }
        hitSlop={10}
        style={styles.sort}
        accessibilityRole="button"
        accessibilityLabel="Sort comments"
      >
        <Ionicons name="swap-vertical-outline" size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** My avatar and the "Add comment…" pill with its send arrow; a "Replying to Name" chip above it while replying. Signed out it asks you to log in. */
export function CommentComposer({ thread }: { thread: CommentThread }) {
  const { user, profile, replyTo, body, setBody, busy, error, inputRef, needLogin, submit, cancelReply } = thread;
  if (!user) {
    return (
      <Pressable onPress={needLogin} style={styles.login} accessibilityRole="button">
        <Text style={{ color: colors.muted, fontSize: 14 }}>
          <Text style={{ color: colors.brand, fontWeight: "700" }}>Log in</Text> to join the conversation
        </Text>
      </Pressable>
    );
  }
  const hasText = body.trim().length > 0;
  const canSend = hasText && !busy;
  return (
    <View style={{ gap: 8 }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {replyTo ? (
        <View style={styles.replyingTo}>
          <Text style={styles.replyingText} numberOfLines={1}>
            Replying to {replyTo.author.full_name}
          </Text>
          <Pressable onPress={cancelReply} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={15} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <Avatar name={profile?.full_name} url={profile?.avatar_url} size="sm" />
        <View style={styles.pill}>
          <TextInput ref={inputRef} value={body} onChangeText={setBody} placeholder={replyTo ? "Add a reply…" : "Add comment…"} placeholderTextColor={colors.faint} multiline maxLength={1000} style={styles.input} accessibilityLabel="Write a comment" />
          <Pressable onPress={() => void submit()} disabled={!canSend} hitSlop={4} style={[styles.send, busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Post comment" accessibilityState={{ disabled: !canSend }}>
            <Ionicons name={hasText ? "arrow-up-circle" : "arrow-up-circle-outline"} size={28} color={hasText ? colors.brand : colors.faint} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** The thread itself: comments, their folded replies and the "View N replies" lines. */
export function CommentList({ thread, emptyText }: { thread: CommentThread; emptyText?: string }) {
  const { comments, items, votes, ownerId, loadError, reload, toggleReplies, startReply, confirmVote, openMenu } = thread;
  // The load failed: say why, with a way to try again. A comment posted since still shows under it.
  const failed = loadError ? (
    <View style={styles.loadError}>
      <Text style={[styles.error, { flex: 1 }]}>{loadError}</Text>
      <Pressable onPress={reload} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry">
        <Text style={styles.retry}>Retry</Text>
      </Pressable>
    </View>
  ) : null;
  if (comments === null) return failed ?? <Text style={styles.muted}>Loading…</Text>;
  if (items.length === 0) return failed ?? (emptyText ? <Text style={[styles.muted, styles.empty]}>{emptyText}</Text> : null);
  return (
    // Rows carry their own spacing (below, not between), so a reply's thread line runs unbroken into the next reply.
    <View>
      {failed}
      {items.map((item) =>
        item.kind === "toggle" ? (
          <RepliesToggle key={`toggle:${item.node.id}`} count={item.node.replyCount} open={item.open} onPress={() => toggleReplies(item.node.id)} />
        ) : (
          <CommentRow key={item.node.id} node={item.node} vote={votes[item.node.id]} isAuthor={item.node.user_id === ownerId} onVoted={(v) => confirmVote(item.node.id, v)} onReply={() => startReply(item.node)} onHold={() => openMenu(item.node)} />
        ),
      )}
    </View>
  );
}

/**
 * Comment thread for detail screens, in YouTube's order: the heading with the sort button, the composer, then the thread.
 * Pass `autoFocus` to jump straight into typing. The composer sits above the thread: a host that scrolls passes
 * `revealComposer` to bring it back on screen when Reply is tapped.
 */
export function Comments({ targetType, targetId, ownerId, autoFocus, onCountChange, revealComposer }: { targetType: PostTargetType; targetId: string; ownerId: string; autoFocus?: boolean; onCountChange?: (delta: number) => void; revealComposer?: () => void }) {
  const thread = useCommentThread({ targetType, targetId, ownerId, onCountChange, revealComposer });
  const { inputRef } = thread;
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [autoFocus, inputRef]);

  return (
    <View style={{ gap: 14 }}>
      <CommentsHeading count={thread.count} onSort={thread.setSort} align="left" />
      <CommentComposer thread={thread} />
      <CommentList thread={thread} />
    </View>
  );
}

type RowProps = {
  node: PostCommentNode;
  /** My vote confirmed since the thread loaded, if any. */
  vote?: Vote;
  /** Written by whoever owns the post. */
  isAuthor: boolean;
  onVoted: (vote: Vote) => void;
  onReply: () => void;
  /** Held down: open the comment's menu. */
  onHold: () => void;
};

/** One comment: avatar, then name · Author, the text, and "5d  Reply … ♡ 12  👎". Replies step in behind a thin line. */
function CommentRow({ node: c, vote: override, isAuthor, onVoted, onReply, onHold }: RowProps) {
  const router = useRouter();
  const { user } = useSession();
  const { vote, cast } = useVote("comment", c.id, override ?? { score: c.score, likes: c.likes, myVote: c.myVote }, (value) => voteComment(supabase, c.id, value), onVoted);
  const name = c.author.full_name;
  const reply = c.depth > 0;
  const up = vote.myVote === 1;
  const down = vote.myVote === -1;
  const likes = vote.likes ?? c.likes;
  const heart = () => {
    // Signed out, cast() only sends the person to log in: no vote, no tap.
    if (user) hapticLike();
    void cast(1);
  };
  const dislike = () => {
    if (user) hapticTap();
    void cast(-1);
  };

  return (
    // Not one accessibility element: the buttons inside stay reachable one by one (the body text carries the hold hint).
    <Pressable onLongPress={onHold} delayLongPress={350} accessible={false} style={[styles.row, reply && [styles.reply, { marginLeft: REPLY_INDENT + (c.depth - 1) * INDENT }]]}>
      <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: c.author.id } })} accessibilityRole="button" accessibilityLabel={`${reply ? "Reply" : "Comment"} from ${name}`} accessibilityHint="Opens their profile">
        <Avatar name={name} url={c.author.avatar_url} size={reply ? REPLY_AVATAR : AVATAR} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {isAuthor ? (
            <>
              <Text style={styles.name}>·</Text>
              <Text style={styles.authorTag}>Author</Text>
            </>
          ) : null}
        </View>
        <Text style={styles.body} accessibilityHint="Hold for options">
          {c.body}
        </Text>
        <View style={styles.actions}>
          <Text style={styles.time}>{shortAge(c.created_at)}</Text>
          <Pressable onPress={onReply} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reply">
            <Text style={styles.action}>Reply</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={styles.likes}>
            <Pressable onPress={heart} hitSlop={{ top: 4, bottom: 4, left: 6 }} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Like comment" accessibilityState={{ selected: up }}>
              <Ionicons name={up ? "heart" : "heart-outline"} size={18} color={up ? LIKE_RED : colors.muted} />
            </Pressable>
            {likes > 0 ? (
              <Text style={styles.count} accessibilityLabel={likes === 1 ? "1 like" : `${likes} likes`}>
                {compactCount(likes)}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={dislike} hitSlop={{ top: 4, bottom: 4, right: 6 }} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Dislike comment" accessibilityState={{ selected: down }}>
            <Ionicons name={down ? "thumbs-down" : "thumbs-down-outline"} size={16} color={down ? colors.text : colors.muted} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

/** TikTok's "View 3 replies ⌄" / "Hide replies ⌃" line under a top-level comment, with the short dash before it. */
function RepliesToggle({ count, open, onPress }: { count: number; open: boolean; onPress: () => void }) {
  const label = open ? "Hide replies" : `View ${repliesLabel(count)}`;
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.toggle} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}>
      <View style={styles.toggleDash} />
      <Text style={styles.toggleText}>{label}</Text>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={12} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text },
  sort: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },

  login: { paddingVertical: 10, alignItems: "center" },
  error: { color: colors.red, fontSize: 13 },
  replyingTo: { alignSelf: "flex-start", maxWidth: "100%", marginLeft: 32 + GAP, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  replyingText: { flexShrink: 1, fontSize: 12, fontWeight: "600", color: colors.muted },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: GAP },
  pill: { flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.input, borderRadius: 22, paddingLeft: 14, paddingRight: 4, minHeight: 40 },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10, maxHeight: 120 },
  send: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },

  muted: { color: colors.muted, fontSize: 14 },
  empty: { textAlign: "center", paddingVertical: 32 },
  /** The load error with its Retry link, where the first comment would be. */
  loadError: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14 },
  retry: { fontSize: 13, fontWeight: "700", color: colors.brand },

  row: { flexDirection: "row", gap: GAP, alignItems: "flex-start", paddingBottom: 14 },
  /** Replies hang off one thin line. */
  reply: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingLeft: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { fontSize: 13, fontWeight: "600", color: colors.muted, flexShrink: 1 },
  authorTag: { fontSize: 13, fontWeight: "600", color: colors.brand },
  body: { fontSize: 15, color: colors.text, lineHeight: 20, marginTop: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 4 },
  time: { fontSize: 12, color: colors.muted },
  action: { fontSize: 12, fontWeight: "700", color: colors.muted },
  likes: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconButton: { height: 28, minWidth: 24, alignItems: "center", justifyContent: "center" },
  count: { fontSize: 12, color: colors.muted },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: REPLY_INDENT, paddingBottom: 14 },
  toggleDash: { width: 24, height: StyleSheet.hairlineWidth, backgroundColor: colors.muted },
  toggleText: { fontSize: 12, fontWeight: "700", color: colors.muted },
});
