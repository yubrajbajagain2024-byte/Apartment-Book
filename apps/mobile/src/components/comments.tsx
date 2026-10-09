import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInput as TextInputType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addComment, compactCount, deleteComment, getMyCommentVotes, listComments, threadComments, timeAgo, voteComment, type PostCommentNode, type PostCommentWithAuthor, type PostTargetType } from "@apartment-book/shared";
import { repliesLabel, useVote, type Vote } from "@/components/home/buzz-card";
import { hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { Avatar } from "./avatar";

/** How far each level of replies steps to the right (threadComments caps the depth, so phones stay readable). */
const INDENT = 16;
/** Avatar width plus the gap: the "Replying to" chip and the "View N replies" line start where the bubbles do. */
const BUBBLE_LEFT = 40;

/** What the list shows: a comment, or the "View 3 replies" / "Hide replies" line that belongs to a top-level comment. */
type Item = { kind: "comment"; node: PostCommentNode } | { kind: "toggle"; node: PostCommentNode; open: boolean };

/** The top-level comment a reply sits under. The walk stops at a parent that is not on the list (hidden by a block): threadComments shows that reply at the top. */
function rootOf(list: PostCommentWithAuthor[], id: string): string {
  const byId = new Map(list.map((c) => [c.id, c] as const));
  let cur = byId.get(id);
  while (cur?.parent_id && byId.has(cur.parent_id)) cur = byId.get(cur.parent_id);
  return cur?.id ?? id;
}

/**
 * Comment thread + input for detail screens: thumbs up / down on every comment, replies threaded under the comment they
 * answer, and Delete for your own comments or any comment on your post. Pass `autoFocus` to jump straight into typing.
 * The composer sits above the thread: a host that scrolls passes `revealComposer` to bring it back on screen when Reply is tapped.
 */
export function Comments({ targetType, targetId, ownerId, autoFocus, onCountChange, revealComposer }: { targetType: PostTargetType; targetId: string; ownerId: string; autoFocus?: boolean; onCountChange?: (delta: number) => void; revealComposer?: () => void }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(null);
  // The viewer's thumbs as loaded, and votes the server confirmed since. Kept apart from `comments`: a vote must never redraw the whole thread.
  const [myVotes, setMyVotes] = useState<Record<string, -1 | 1>>({});
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  // Top-level comments whose replies are shown. Folded by default, like Instagram; a reply you just posted opens its thread.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<PostCommentNode | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInputType>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    let stale = false;
    // A new target, or a different person signed in: nothing from before applies.
    setComments(null);
    setMyVotes({});
    setVotes({});
    setExpanded(new Set());
    setReplyTo(null);
    listComments(supabase, targetType, targetId).then(
      async (rows) => {
        if (stale) return;
        setComments(rows);
        // The thread shows at once; the lit thumbs follow. Signed out there is nothing to ask for.
        const mine = await getMyCommentVotes(supabase, userId, rows.map((c) => c.id)).catch((): Record<string, -1 | 1> => ({}));
        if (!stale) setMyVotes(mine);
      },
      () => {
        if (!stale) setComments([]);
      },
    );
    return () => {
      stale = true;
    };
  }, [targetType, targetId, userId]);
  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 300);
  }, [autoFocus]);

  // Thread order: each comment followed by its replies. A comment's subtree follows it directly, so folding means skipping that many rows.
  const nodes = useMemo(() => threadComments(comments ?? [], myVotes), [comments, myVotes]);
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

  function toggleReplies(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startReply(node: PostCommentNode) {
    if (!user) return router.push("/(auth)/login");
    setReplyTo(node);
    // iOS leaves a focused input where it is when the keyboard comes up, so a Reply tapped far down the list would focus a
    // composer scrolled off the top. The host brings it back first.
    revealComposer?.();
    // The input may already be focused with the keyboard swiped away: bring the keyboard back.
    setTimeout(() => inputRef.current?.focus(), 50);
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

  async function remove(node: PostCommentNode) {
    setError(null);
    try {
      await deleteComment(supabase, node.id);
    } catch (e) {
      setError(errorText(e, "Could not delete the comment"));
      return;
    }
    // The server deletes its replies with it. Thread order lists parents before their replies, so one pass finds them all.
    const gone = new Set([node.id]);
    for (const c of nodes) if (c.parent_id && gone.has(c.parent_id)) gone.add(c.id);
    setComments((prev) => (prev ?? []).filter((c) => !gone.has(c.id)));
    if (replyTo && gone.has(replyTo.id)) setReplyTo(null);
    onCountChange?.(-gone.size);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.heading}>Comments</Text>
      {user ? (
        <View style={{ gap: 6 }}>
          {replyTo ? (
            <View style={styles.replyingTo}>
              <Text style={styles.replyingText} numberOfLines={1}>
                Replying to {replyTo.author.full_name}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <Ionicons name="close" size={15} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Avatar name={profile?.full_name} url={profile?.avatar_url} size="sm" />
            <View style={styles.inputWrap}>
              <TextInput ref={inputRef} value={body} onChangeText={setBody} placeholder={replyTo ? "Write a reply…" : "Write a comment…"} placeholderTextColor={colors.faint} multiline maxLength={1000} style={styles.input} accessibilityLabel="Write a comment" />
              <Pressable onPress={() => void submit()} disabled={busy || !body.trim()} accessibilityRole="button" accessibilityLabel="Post comment" style={{ opacity: body.trim() ? 1 : 0.4, padding: 6 }}>
                <Ionicons name="send" size={18} color={colors.brand} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => router.push("/(auth)/login")}>
          <Text style={{ color: colors.muted }}>
            <Text style={{ color: colors.brand, fontWeight: "700" }}>Log in</Text> to join the conversation.
          </Text>
        </Pressable>
      )}
      {error ? <Text style={{ color: colors.red, fontSize: 13 }}>{error}</Text> : null}
      {comments === null ? <Text style={{ color: colors.muted }}>Loading…</Text> : null}
      {items.length > 0 ? (
        // Rows carry their own spacing (below, not between), so a reply's thread line runs unbroken into the next reply.
        <View>
          {items.map((item) =>
            item.kind === "toggle" ? (
              <RepliesToggle key={`toggle:${item.node.id}`} count={item.node.replyCount} open={item.open} onPress={() => toggleReplies(item.node.id)} />
            ) : (
              <CommentRow
                key={item.node.id}
                node={item.node}
                vote={votes[item.node.id]}
                canDelete={user !== null && (user.id === item.node.user_id || user.id === ownerId)}
                onVoted={(v) => setVotes((prev) => ({ ...prev, [item.node.id]: v }))}
                onReply={() => startReply(item.node)}
                onDelete={() => void remove(item.node)}
              />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

type RowProps = {
  node: PostCommentNode;
  /** My vote confirmed since the thread loaded, if any. */
  vote?: Vote;
  canDelete: boolean;
  onVoted: (vote: Vote) => void;
  onReply: () => void;
  onDelete: () => void;
};

/** One comment: avatar, the bubble, then time · thumbs up · score · thumbs down · Reply · Delete. Replies step in behind a thin line. */
function CommentRow({ node: c, vote: override, canDelete, onVoted, onReply, onDelete }: RowProps) {
  const router = useRouter();
  const { user } = useSession();
  const { vote, cast } = useVote("comment", c.id, override ?? { score: c.score, myVote: c.myVote }, (value) => voteComment(supabase, c.id, value), onVoted);
  const name = c.author.full_name;
  const up = vote.myVote === 1;
  const down = vote.myVote === -1;
  const thumb = (direction: 1 | -1) => {
    // Signed out, cast() only sends the person to log in: no vote, no tap.
    if (user) hapticTap();
    void cast(direction);
  };

  return (
    <View style={[styles.row, c.depth > 0 && [styles.reply, { marginLeft: c.depth * INDENT }]]}>
      <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: c.author.id } })} accessibilityRole="button" accessibilityLabel={`${c.depth > 0 ? "Reply" : "Comment"} from ${name}`} accessibilityHint="Opens their profile">
        <Avatar name={name} url={c.author.avatar_url} size="sm" />
      </Pressable>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <View style={styles.bubble}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.body}>{c.body}</Text>
        </View>
        <View style={styles.actions}>
          <Text style={styles.time}>{timeAgo(c.created_at)}</Text>
          <View style={styles.votes}>
            <Pressable onPress={() => thumb(1)} hitSlop={{ top: 4, bottom: 4 }} style={styles.thumb} accessibilityRole="button" accessibilityLabel="Like comment" accessibilityState={{ selected: up }}>
              <Ionicons name={up ? "thumbs-up" : "thumbs-up-outline"} size={16} color={up ? colors.brand : colors.muted} />
            </Pressable>
            <Text style={[styles.score, up && { color: colors.brand }, down && { color: colors.text }]} accessibilityLabel={`Score ${vote.score}`}>
              {compactCount(vote.score)}
            </Text>
            <Pressable onPress={() => thumb(-1)} hitSlop={{ top: 4, bottom: 4 }} style={styles.thumb} accessibilityRole="button" accessibilityLabel="Dislike comment" accessibilityState={{ selected: down }}>
              <Ionicons name={down ? "thumbs-down" : "thumbs-down-outline"} size={16} color={down ? colors.text : colors.muted} />
            </Pressable>
          </View>
          <Pressable onPress={onReply} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reply">
            <Text style={styles.action}>Reply</Text>
          </Pressable>
          {canDelete ? (
            <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete comment">
              <Text style={[styles.action, { color: colors.red }]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Instagram's "View 3 replies" / "Hide replies" line under a top-level comment, with the short dash before it. */
function RepliesToggle({ count, open, onPress }: { count: number; open: boolean; onPress: () => void }) {
  const label = open ? "Hide replies" : `View ${repliesLabel(count)}`;
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.toggle} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.toggleDash} />
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: "700", color: colors.text },
  replyingTo: { alignSelf: "flex-start", maxWidth: "100%", marginLeft: BUBBLE_LEFT, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.input, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  replyingText: { flexShrink: 1, fontSize: 12, fontWeight: "600", color: colors.muted },
  inputRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.input, borderRadius: 20, paddingLeft: 12, paddingRight: 4 },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 9, maxHeight: 120 },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start", paddingBottom: 12 },
  /** Replies hang off one thin line, like the Buzz thread. */
  reply: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingLeft: 10 },
  bubble: { backgroundColor: colors.input, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 7, gap: 1, maxWidth: "100%" },
  name: { fontSize: 13, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingTop: 2 },
  time: { fontSize: 12, color: colors.muted },
  votes: { flexDirection: "row", alignItems: "center", gap: 2 },
  thumb: { height: 28, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  score: { fontSize: 12, fontWeight: "700", color: colors.muted, minWidth: 12, textAlign: "center" },
  action: { fontSize: 12, fontWeight: "700", color: colors.muted },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: BUBBLE_LEFT, paddingBottom: 12 },
  toggleDash: { width: 24, height: StyleSheet.hairlineWidth, backgroundColor: colors.muted },
  toggleText: { fontSize: 12, fontWeight: "700", color: colors.muted },
});
