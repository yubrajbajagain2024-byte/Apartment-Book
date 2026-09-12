import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getPostEngagement, likePost, toggleSaved, unlikePost, type PostEngagement, type SavedTargetType } from "@apartment-book/shared";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

export function useLike(targetType: SavedTargetType, targetId: string, initial: PostEngagement | undefined, userId: string | null, onNeedLogin: () => void) {
  const [state, setState] = useState({ liked: initial?.likedByMe ?? false, likes: initial?.likes ?? 0 });
  const [pending, setPending] = useState(false);
  const toggle = useCallback(async () => {
    if (!userId) return onNeedLogin();
    if (pending) return;
    const next = !state.liked;
    setPending(true);
    setState((s) => ({ liked: next, likes: Math.max(0, s.likes + (next ? 1 : -1)) }));
    try {
      if (next) await likePost(supabase, userId, targetType, targetId);
      else await unlikePost(supabase, userId, targetType, targetId);
      const fresh = await getPostEngagement(supabase, targetType, targetId);
      setState({ liked: fresh.likedByMe, likes: fresh.likes });
    } catch {
      setState((s) => ({ liked: !next, likes: Math.max(0, s.likes + (next ? -1 : 1)) }));
    } finally {
      setPending(false);
    }
  }, [userId, pending, state.liked, targetType, targetId, onNeedLogin]);
  return { ...state, pending, toggle };
}

export function useSave(targetType: SavedTargetType, targetId: string, initial: boolean, userId: string | null, onNeedLogin: () => void) {
  const [saved, setSaved] = useState(initial);
  const toggle = useCallback(async () => {
    if (!userId) return onNeedLogin();
    setSaved((s) => !s);
    try {
      setSaved(await toggleSaved(supabase, userId, targetType, targetId));
    } catch {
      setSaved((s) => !s);
    }
  }, [userId, targetType, targetId, onNeedLogin]);
  return { saved, toggle };
}

/** "12 likes · 3 comments" line. */
export function EngagementSummary({ likes, comments, onComments }: { likes: number; comments: number; onComments?: () => void }) {
  if (likes === 0 && comments === 0) return null;
  return (
    <View style={styles.summary}>
      {likes > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={styles.likePill}>
            <Ionicons name="thumbs-up" size={9} color="#fff" />
          </View>
          <Text style={styles.summaryText}>{likes}</Text>
        </View>
      ) : (
        <View />
      )}
      {comments > 0 ? (
        <Pressable onPress={onComments}>
          <Text style={styles.summaryText}>
            {comments} {comments === 1 ? "comment" : "comments"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Like · Comment · Message row (Save and Share live in the ••• menu). */
export function EngagementBar({ liked, likes, onLike, onComment, onMessage, messageLabel = "Message" }: { liked: boolean; likes: number; onLike: () => void; onComment: () => void; onMessage: () => void; messageLabel?: string }) {
  return (
    <View style={styles.bar}>
      <Pressable style={styles.action} onPress={onLike} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }}>
        <Ionicons name={liked ? "thumbs-up" : "thumbs-up-outline"} size={20} color={liked ? colors.brand : colors.text} />
        <Text style={[styles.actionText, liked && { color: colors.brand }]}>{liked ? "Liked" : "Like"}</Text>
        {likes > 0 ? <Text style={styles.count}>{likes}</Text> : null}
      </Pressable>
      <Pressable style={styles.action} onPress={onComment} accessibilityRole="button" accessibilityLabel="Comment">
        <Ionicons name="chatbox-outline" size={20} color={colors.text} />
        <Text style={styles.actionText}>Comment</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={onMessage} accessibilityRole="button" accessibilityLabel={messageLabel}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.text} />
        <Text style={styles.actionText}>{messageLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6 },
  summaryText: { fontSize: 12, color: colors.muted },
  likePill: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 6, paddingVertical: 4 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 8 },
  actionText: { fontSize: 13, fontWeight: "700", color: colors.text },
  count: { fontSize: 12, color: colors.muted },
});
