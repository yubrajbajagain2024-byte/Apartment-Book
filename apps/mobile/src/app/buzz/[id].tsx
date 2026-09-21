import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type TextInput as TextInputType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addBuzzComment, buzzCommentSchema, deleteBuzzComment, getBuzz, listBuzzComments, muteBuzzAuthor, reportContent, REPORT_REASONS, timeAgo, type BuzzComment, type BuzzPost, type ReportReason } from "@apartment-book/shared";
import { useActionSheet, type SheetOption } from "@/components/action-sheet";
import { BuzzCard, BuzzTag, emitBuzzEvent, repliesLabel } from "@/components/home/buzz-card";
import { Button, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";

/** Oldest first, with every answer right under the reply it answers. A reply whose parent is hidden for you shows as a normal reply. */
function threadOrder(list: BuzzComment[]): BuzzComment[] {
  const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(sorted.map((c) => c.id));
  const children = new Map<string, BuzzComment[]>();
  const roots: BuzzComment[] = [];
  for (const c of sorted) {
    if (c.parentId && c.parentId !== c.id && ids.has(c.parentId)) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    else roots.push(c);
  }
  const out: BuzzComment[] = [];
  const seen = new Set<string>();
  const walk = (c: BuzzComment) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
    (children.get(c.id) ?? []).forEach(walk);
  };
  roots.forEach(walk);
  // Anything left (a loop in the data) still shows, at the end.
  for (const c of sorted) if (!seen.has(c.id)) out.push(c);
  return out;
}

/** One anonymous Buzz thread with its anonymous replies. Only aliases are ever shown: the app never receives who wrote what. */
export default function BuzzThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const show = useActionSheet();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const [post, setPost] = useState<BuzzPost | null>(null);
  const [replies, setReplies] = useState<BuzzComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<BuzzComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<TextInputType>(null);
  const listRef = useRef<FlatList<BuzzComment>>(null);
  const seq = useRef(0);
  const needLogin = () => router.push("/(auth)/login");
  /** Opened from a link there may be nothing to go back to. */
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [p, c] = await Promise.all([getBuzz(supabase, id), listBuzzComments(supabase, id)]);
      if (n !== seq.current) return;
      setPost(p);
      setReplies(threadOrder(c));
      setError(null);
      if (p) emitBuzzEvent({ type: "patch", post: p });
    } catch (e) {
      if (n === seq.current) setError(errorText(e, "Could not load this post. Please try again."));
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
      const nested = replyTo !== null;
      await addBuzzComment(supabase, user.id, post.id, parsed.data.body, replyTo?.id ?? null);
      setBody("");
      setReplyTo(null);
      // Count right away, then take the real list (the new reply gets its alias from the server).
      setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
      await load();
      // A plain reply lands at the bottom; an answer to a reply lands under that reply, so stay put.
      if (!nested) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e) {
      setFormError(errorText(e, "Could not post your reply. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function startReply(c: BuzzComment) {
    if (!user) return needLogin();
    // One level of nesting: answering a nested reply answers its parent.
    setReplyTo(c.parentId ? (replies.find((r) => r.id === c.parentId) ?? c) : c);
    setTimeout(() => inputRef.current?.focus(), 50);
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
    const options: SheetOption[] = [{ label: "Reply", icon: "arrow-undo-outline", onPress: () => startReply(c) }];
    if (!c.isMine) {
      options.push({ label: c.isOp ? "Hide this thread" : "Hide this person's replies here", icon: "eye-off-outline", onPress: () => hidePerson(c) });
      options.push({ label: "Report", icon: "flag-outline", destructive: true, onPress: () => reportReply(c) });
    }
    if (c.isMine || post?.isMine) options.push({ label: "Delete", icon: "trash-outline", destructive: true, onPress: () => deleteReply(c) });
    show(options);
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: "Buzz" }} />
        <Loading />
      </>
    );
  }
  if (!post) {
    return (
      <View style={{ flex: 1, padding: 12 }}>
        <Stack.Screen options={{ title: "Buzz" }} />
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : <EmptyState icon="chatbubbles-outline" title="This post is no longer available" body="It may have been deleted, or it is hidden for you." action={<Button title="Go back" variant="secondary" onPress={leave} />} />}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Buzz" }} />
      <FlatList
        ref={listRef}
        data={replies}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
          <View style={{ gap: 12, marginBottom: 2 }}>
            {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
            <BuzzCard
              post={post}
              full
              onChange={(next) => {
                setPost(next);
                emitBuzzEvent({ type: "patch", post: next });
              }}
              onRemoved={(removedId) => {
                emitBuzzEvent({ type: "remove", id: removedId });
                leave();
              }}
              onMuted={() => {
                emitBuzzEvent({ type: "reload" });
                leave();
              }}
            />
            <Text style={styles.heading}>{post.commentCount === 0 ? "Replies" : repliesLabel(post.commentCount)}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No replies yet. Be the first to answer.</Text>}
        renderItem={({ item: c }) => {
          const parent = c.parentId ? replies.find((r) => r.id === c.parentId) : undefined;
          return (
            <Pressable onLongPress={() => replyMenu(c)} delayLongPress={300} style={[styles.reply, c.parentId ? styles.nested : null]} accessibilityLabel={`Reply from ${c.alias}${c.isMine ? ", you" : ""}${c.isOp ? ", who started the thread" : ""}`} accessibilityHint="Long press for options">
              <View style={styles.replyHead}>
                <Text style={styles.alias} numberOfLines={1}>
                  {c.alias}
                </Text>
                {c.isOp ? <BuzzTag label="OP" /> : null}
                {c.isMine ? <BuzzTag label="You" tone="green" /> : null}
                <Text style={styles.time}>· {timeAgo(c.createdAt)}</Text>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => replyMenu(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Reply options">
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
                </Pressable>
              </View>
              {parent ? (
                <Text style={styles.parent} numberOfLines={1}>
                  Replying to {parent.alias}
                </Text>
              ) : null}
              <Text style={styles.replyBody}>{c.body}</Text>
              <Pressable onPress={() => startReply(c)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Reply to ${c.alias}`} style={{ alignSelf: "flex-start" }}>
                <Text style={styles.replyLink}>Reply</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {replyTo ? (
          <View style={styles.replyingTo}>
            <Text style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={1}>
              Replying to {replyTo.alias}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel replying to this person">
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {formError ? <Text style={{ color: colors.red, fontSize: 12, paddingHorizontal: 4 }}>{formError}</Text> : null}
        {user ? (
          <View style={styles.composer}>
            <TextInput
              ref={inputRef}
              value={body}
              onChangeText={(v) => {
                setBody(v);
                if (formError) setFormError(null);
              }}
              placeholder="Reply anonymously…"
              placeholderTextColor={colors.faint}
              multiline
              maxLength={2000}
              style={styles.input}
              accessibilityLabel="Reply anonymously"
            />
            <Pressable onPress={() => void send()} disabled={busy || !body.trim()} style={[styles.send, (busy || !body.trim()) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Send reply">
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={needLogin} style={{ paddingVertical: 8, paddingHorizontal: 4 }} accessibilityRole="button">
            <Text style={{ color: colors.muted }}>
              <Text style={{ color: colors.brand, fontWeight: "700" }}>Log in</Text> to reply. Your name is never shown on Buzz.
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: "700", color: colors.text, paddingHorizontal: 4 },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: 24 },
  reply: { backgroundColor: colors.card, borderRadius: radius.md, padding: 12, gap: 5 },
  nested: { marginLeft: 20, borderLeftWidth: 3, borderLeftColor: colors.border },
  replyHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  alias: { fontSize: 13, fontWeight: "700", color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.muted },
  parent: { fontSize: 12, color: colors.faint },
  replyBody: { fontSize: 15, color: colors.text, lineHeight: 21 },
  replyLink: { fontSize: 12, fontWeight: "700", color: colors.muted, paddingTop: 2 },
  composerWrap: { paddingHorizontal: 10, paddingTop: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  replyingTo: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, backgroundColor: colors.input, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120, color: colors.text },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
