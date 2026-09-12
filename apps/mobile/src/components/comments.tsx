import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInput as TextInputType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addComment, deleteComment, listComments, timeAgo, type PostCommentWithAuthor, type SavedTargetType } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { Avatar } from "./avatar";

/** Comment thread + input for detail screens. Pass `autoFocus` to jump straight into typing. */
export function Comments({ targetType, targetId, ownerId, autoFocus, onCountChange }: { targetType: SavedTargetType; targetId: string; ownerId: string; autoFocus?: boolean; onCountChange?: (delta: number) => void }) {
  const { user, profile } = useSession();
  const router = useRouter();
  const [comments, setComments] = useState<PostCommentWithAuthor[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInputType>(null);

  useEffect(() => {
    listComments(supabase, targetType, targetId).then(setComments, () => setComments([]));
  }, [targetType, targetId]);
  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 300);
  }, [autoFocus]);

  async function submit() {
    const text = body.trim();
    if (!text || busy || !user) return;
    setBusy(true);
    setError(null);
    try {
      const c = await addComment(supabase, user.id, targetType, targetId, text);
      setComments((prev) => [...(prev ?? []), c]);
      setBody("");
      onCountChange?.(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post your comment");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await deleteComment(supabase, id).catch(() => {});
    setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
    onCountChange?.(-1);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.heading}>Comments</Text>
      {user ? (
        <View style={styles.inputRow}>
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size="sm" />
          <View style={styles.inputWrap}>
            <TextInput ref={inputRef} value={body} onChangeText={setBody} placeholder="Write a comment…" placeholderTextColor={colors.faint} multiline maxLength={1000} style={styles.input} accessibilityLabel="Write a comment" />
            <Pressable onPress={submit} disabled={busy || !body.trim()} accessibilityRole="button" accessibilityLabel="Post comment" style={{ opacity: body.trim() ? 1 : 0.4, padding: 6 }}>
              <Ionicons name="send" size={18} color={colors.brand} />
            </Pressable>
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
      {comments?.map((c) => {
        const canDelete = user !== null && (user.id === c.user_id || user.id === ownerId);
        return (
          <View key={c.id} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: c.author.id } })}>
              <Avatar name={c.author.full_name} url={c.author.avatar_url} size="sm" />
            </Pressable>
            <View style={{ flex: 1, alignItems: "flex-start" }}>
              <View style={styles.bubble}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{c.author.full_name}</Text>
                <Text style={{ fontSize: 15, color: colors.text }}>{c.body}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingTop: 2 }}>
                <Text style={styles.time}>{timeAgo(c.created_at)}</Text>
                {canDelete ? (
                  <Pressable onPress={() => void remove(c.id)} accessibilityRole="button" accessibilityLabel="Delete comment">
                    <Text style={[styles.time, { color: colors.red }]}>Delete</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: "700", color: colors.text },
  inputRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.input, borderRadius: 20, paddingLeft: 12, paddingRight: 4 },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 9, maxHeight: 120 },
  bubble: { backgroundColor: colors.input, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 7, gap: 1, maxWidth: "100%" },
  time: { fontSize: 12, color: colors.muted },
});
