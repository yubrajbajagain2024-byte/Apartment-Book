import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { getFollowStatsMany, NO_FOLLOW_STATS, setFollowing, type FollowStats } from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/**
 * Follow state of one profile, modelled on useLike: the button and the follower count flip at once, the numbers the
 * server sends back replace the guess, and an error puts things back. `initial` tends to arrive after the first render
 * (a profile loads its stats separately, a list loads them for its rows): adopt it when it comes, but never over a tap
 * in progress. `onChange` hears every state adopted after a tap, so counts shown elsewhere on the screen move with the button.
 */
export function useFollow(targetId: string, initial: FollowStats | undefined, userId: string | null, onNeedLogin: () => void, onChange?: (stats: FollowStats) => void) {
  const [state, setState] = useState<FollowStats>(initial ?? NO_FOLLOW_STATS);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  // Compared field by field: a parent re-rendering with the same numbers in a new object must not undo a finished tap.
  const has = initial !== undefined;
  const initialFollowers = initial?.followers ?? 0;
  const initialFollowing = initial?.following ?? 0;
  const initialFollowedByMe = initial?.followedByMe ?? false;
  const initialFollowsMe = initial?.followsMe ?? false;
  useEffect(() => {
    if (has && !busy.current) setState({ followers: initialFollowers, following: initialFollowing, followedByMe: initialFollowedByMe, followsMe: initialFollowsMe });
  }, [has, initialFollowers, initialFollowing, initialFollowedByMe, initialFollowsMe]);
  const toggle = useCallback(async () => {
    if (!userId) return onNeedLogin();
    if (pending || userId === targetId) return;
    const next = !state.followedByMe;
    const guess: FollowStats = { ...state, followedByMe: next, followers: Math.max(0, state.followers + (next ? 1 : -1)) };
    busy.current = true;
    setPending(true);
    setState(guess);
    onChange?.(guess);
    try {
      const fresh = await setFollowing(supabase, userId, targetId, next);
      setState(fresh);
      onChange?.(fresh);
    } catch {
      setState(state);
      onChange?.(state);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [userId, targetId, pending, state, onNeedLogin, onChange]);
  return { ...state, pending, toggle };
}

/**
 * Stats for the people in a list (a followers or following screen), fetched for the rows that have none yet.
 * "Followed by me" belongs to one viewer, so signing in or out fetches everything again.
 */
export function useFollowStatsMany(items: { id: string }[], userId: string | null): Record<string, FollowStats> {
  const [stats, setStats] = useState<Record<string, FollowStats>>({});
  const ids = useMemo(() => items.map((i) => i.id).join(","), [items]);
  const loadedFor = useRef(userId);
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    const userChanged = loadedFor.current !== userId;
    loadedFor.current = userId;
    const missing = userChanged ? list : list.filter((id) => !(id in stats));
    if (missing.length > 0) getFollowStatsMany(supabase, missing).then((rows) => setStats((prev) => ({ ...prev, ...rows }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, userId]);
  return stats;
}

/** Follow / Follow back / Following: loud while you do not follow them, quiet once you do. `compact` fits a list row. Nothing for your own profile. */
export function FollowButton({ targetId, stats, userId, onNeedLogin, compact, onChange, style }: { targetId: string; stats: FollowStats | undefined; userId: string | null; onNeedLogin: () => void; compact?: boolean; onChange?: (stats: FollowStats) => void; style?: StyleProp<ViewStyle> }) {
  const follow = useFollow(targetId, stats, userId, onNeedLogin, onChange);
  if (userId === targetId) return null;
  const label = follow.followedByMe ? "Following" : follow.followsMe ? "Follow back" : "Follow";
  return (
    <Button
      title={label}
      variant={follow.followedByMe ? "secondary" : "primary"}
      icon={compact ? undefined : follow.followedByMe ? "checkmark" : "person-add-outline"}
      accessibilityLabel={label}
      accessibilityState={{ selected: follow.followedByMe }}
      disabled={follow.pending}
      onPress={() => void follow.toggle()}
      style={[compact && styles.compact, style]}
    />
  );
}

const styles = StyleSheet.create({
  compact: { minHeight: 32, paddingHorizontal: 14, minWidth: 104 },
});
