import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getPostEngagement, likePost, toggleSaved, unlikePost, type PostEngagement, type PostTargetType } from "@apartment-book/shared";
import { hapticLike, hapticSelect, hapticTap } from "@/lib/haptics";
import { onPostEngagement } from "@/lib/posts-events";
import { supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

/**
 * A post's or a listing's heart, TikTok's way: the tap is felt and seen at once, never after the network. The haptic is
 * the first thing a tap does (a firm tick to like, a light one to unlike), then the heart and the count change; the
 * server hears the taps one at a time, only the newest wish is sent next (so quick taps can never land out of order or be
 * dropped), and its count wins once it has caught up. A failure puts back what the server last confirmed.
 * `likeNow` is a double tap's: it always ticks and shows the like, and never unlikes.
 */
export function useLike(targetType: PostTargetType, targetId: string, initial: PostEngagement | undefined, userId: string | null, onNeedLogin: () => void) {
  const [state, setState] = useState({ liked: initial?.likedByMe ?? false, likes: initial?.likes ?? 0 });
  const [pending, setPending] = useState(false);
  /** The heart as last shown, read by taps that come faster than renders. */
  const shown = useRef(state);
  shown.current = state;
  /** True while taps are being sent: counts from elsewhere wait until the server has caught up. */
  const busy = useRef(false);
  /** What the newest tap asked for, and what the server last confirmed (null: not known yet, the heart as loaded). */
  const wanted = useRef<boolean | null>(null);
  const confirmed = useRef<{ liked: boolean; likes: number } | null>(null);
  // Feeds load the counts after the cards are already on screen: adopt them when they arrive (but never over a tap in progress).
  const has = initial !== undefined;
  const initialLiked = initial?.likedByMe ?? false;
  const initialLikes = initial?.likes ?? 0;
  useEffect(() => {
    if (has && !busy.current) setState({ liked: initialLiked, likes: initialLikes });
  }, [has, initialLiked, initialLikes]);
  // Liked or unliked somewhere else while this card is mounted (the Reels viewer opened from it): the heart follows.
  useEffect(
    () =>
      onPostEngagement((type, id, patch) => {
        if (type !== targetType || id !== targetId || busy.current) return;
        if (patch.likedByMe !== undefined || patch.likes !== undefined) setState((s) => ({ liked: patch.likedByMe ?? s.liked, likes: patch.likes ?? s.likes }));
      }),
    [targetType, targetId],
  );

  /** Sends the newest wish until the server has caught up with it, then reads the real count. */
  const flush = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      let sent: boolean | null = null;
      while (wanted.current !== null && wanted.current !== sent) {
        const next: boolean = wanted.current;
        if (next) await likePost(supabase, userId, targetType, targetId);
        else await unlikePost(supabase, userId, targetType, targetId);
        sent = next;
      }
      const fresh = await getPostEngagement(supabase, targetType, targetId);
      confirmed.current = { liked: fresh.likedByMe, likes: fresh.likes };
      // A tap that came in during the read is sent by the next round; until then the heart keeps showing it.
      if (wanted.current === fresh.likedByMe) setState(confirmed.current);
    } catch {
      if (confirmed.current) setState(confirmed.current);
      wanted.current = null;
    } finally {
      busy.current = false;
      setPending(false);
    }
    if (wanted.current !== null && confirmed.current && wanted.current !== confirmed.current.liked) void flush();
  }, [userId, targetType, targetId]);

  const set = useCallback(
    (next: boolean) => {
      confirmed.current ??= shown.current;
      wanted.current = next;
      const s = { liked: next, likes: Math.max(0, shown.current.likes + (next === shown.current.liked ? 0 : next ? 1 : -1)) };
      shown.current = s;
      setState(s);
      void flush();
    },
    [flush],
  );

  const toggle = useCallback(() => {
    if (!userId) return onNeedLogin();
    const next = !shown.current.liked;
    // Felt before anything else happens: no render, animation or request stands in front of it.
    if (next) hapticLike();
    else hapticTap();
    set(next);
  }, [userId, onNeedLogin, set]);

  const likeNow = useCallback(() => {
    if (!userId) return onNeedLogin();
    hapticLike();
    if (!shown.current.liked) set(true);
  }, [userId, onNeedLogin, set]);

  return { ...state, pending, toggle, likeNow };
}

export function useSave(targetType: PostTargetType, targetId: string, initial: boolean, userId: string | null, onNeedLogin: () => void) {
  const [saved, setSaved] = useState(initial);
  const busy = useRef(false);
  // The saved list arrives after the first render of a feed card.
  useEffect(() => {
    if (!busy.current) setSaved(initial);
  }, [initial]);
  // Saved or unsaved somewhere else while this card is mounted (the Reels viewer opened from it): the bookmark follows.
  useEffect(
    () =>
      onPostEngagement((type, id, patch) => {
        if (type === targetType && id === targetId && patch.saved !== undefined && !busy.current) setSaved(patch.saved);
      }),
    [targetType, targetId],
  );
  const toggle = useCallback(async () => {
    if (!userId) return onNeedLogin();
    if (busy.current) return;
    busy.current = true;
    // A selection tick as the bookmark fills (or empties), the same for posts, reels and listings.
    hapticSelect();
    setSaved((s) => !s);
    try {
      setSaved(await toggleSaved(supabase, userId, targetType, targetId));
    } catch {
      setSaved((s) => !s);
    } finally {
      busy.current = false;
    }
  }, [userId, targetType, targetId, onNeedLogin]);
  return { saved, toggle };
}

/** "12 likes · 3 comments" line. */
export function EngagementSummary({ likes, comments, onComments }: { likes: number; comments: number; onComments?: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  if (likes === 0 && comments === 0) return null;
  return (
    <View style={styles.summary}>
      {likes > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={styles.likePill}>
            <Icon name="thumbs-up" size={9} color={colors.onBrand} />
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
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.bar}>
      <Pressable style={styles.action} onPress={onLike} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }}>
        <Icon name={liked ? "thumbs-up" : "thumbs-up-outline"} size={20} color={liked ? colors.brand : colors.text} />
        <Text style={[styles.actionText, liked && { color: colors.brand }]}>{liked ? "Liked" : "Like"}</Text>
        {likes > 0 ? <Text style={styles.count}>{likes}</Text> : null}
      </Pressable>
      <Pressable style={styles.action} onPress={onComment} accessibilityRole="button" accessibilityLabel="Comment">
        <Icon name="chatbox-outline" size={20} color={colors.text} />
        <Text style={styles.actionText}>Comment</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={onMessage} accessibilityRole="button" accessibilityLabel={messageLabel}>
        <Icon name="chatbubble-ellipses-outline" size={20} color={colors.text} />
        <Text style={styles.actionText}>{messageLabel}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6 },
  summaryText: { fontSize: 12, color: colors.muted },
  likePill: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 6, paddingVertical: 4 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 8 },
  actionText: { fontSize: 13, fontWeight: "700", color: colors.text },
  count: { fontSize: 12, color: colors.muted },
}));
