import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { getPostEngagementMany, likePost, unlikePost } from "@apartment-book/shared";
import { hapticSelect } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Liked = Readonly<Record<string, boolean>>;
const NONE: Liked = {};

/**
 * Which items of the Marketplace grid the signed-in person has liked, and the heart's toggle. Each new page of items is
 * read in one batched call (post_engagement_many, as the other feeds do), never card by card; `refresh` reads every item
 * on screen again (pull to refresh, coming back from an item whose like may have changed there). Signed out nothing is
 * read and every heart is empty.
 *
 * `toggle` flips the heart at once with a selection tick, then likes or unlikes; a failure puts the heart back and says
 * so. Signed out it opens the login instead. It returns the new state, or null when nothing changed (signed out, or that
 * heart's last tap is still on its way).
 */
export function useItemLikes(items: readonly { id: string }[], userId: string | null) {
  const router = useRouter();
  const [liked, setLiked] = useState<Liked>(NONE);
  // The ref is the truth (read by taps without waiting for a render); the state only mirrors it for drawing.
  const likedRef = useRef<Liked>(NONE);
  const [round, setRound] = useState(0);
  /** The ids already asked about, for this person and this round of reads. */
  const asked = useRef({ userId, round, ids: new Set<string>() });
  /** Taps per item: an answer that left before a tap must not undo it. */
  const taps = useRef(new Map<string, number>());
  /** Items whose like or unlike is on its way. */
  const busy = useRef(new Set<string>());
  const key = useMemo(() => items.map((i) => i.id).join(","), [items]);

  const patch = useCallback((changes: Liked | null) => {
    likedRef.current = changes === null ? NONE : { ...likedRef.current, ...changes };
    setLiked(likedRef.current);
  }, []);

  useEffect(() => {
    if (asked.current.userId !== userId) {
      // Someone else signed in (or out): their hearts start empty.
      patch(null);
      taps.current.clear();
      busy.current.clear();
      asked.current = { userId, round, ids: new Set() };
    } else if (asked.current.round !== round) {
      asked.current = { userId, round, ids: new Set() };
    }
    if (!userId) return;
    const sent = asked.current;
    const missing = (key ? key.split(",") : []).filter((id) => !sent.ids.has(id));
    if (missing.length === 0) return;
    for (const id of missing) sent.ids.add(id);
    const tapsBefore = new Map(missing.map((id) => [id, taps.current.get(id) ?? 0]));
    getPostEngagementMany(supabase, "item", missing).then(
      (rows) => {
        // A newer round (or another person) has asked again since: its answer wins.
        if (asked.current !== sent) return;
        const fresh: Record<string, boolean> = {};
        for (const id of missing) if ((taps.current.get(id) ?? 0) === tapsBefore.get(id)) fresh[id] = rows[id]?.likedByMe ?? false;
        patch(fresh);
      },
      () => {
        // Asked again with the next page, the next refresh or the next visit.
        for (const id of missing) sent.ids.delete(id);
      },
    );
  }, [key, userId, round, patch]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);

  const toggle = useCallback(
    (id: string): boolean | null => {
      if (!userId) {
        router.push("/(auth)/login");
        return null;
      }
      if (busy.current.has(id)) return null;
      const next = !likedRef.current[id];
      const tap = () => taps.current.set(id, (taps.current.get(id) ?? 0) + 1);
      hapticSelect();
      busy.current.add(id);
      tap();
      patch({ [id]: next });
      (next ? likePost(supabase, userId, "item", id) : unlikePost(supabase, userId, "item", id))
        .catch((e: unknown) => {
          if (asked.current.userId !== userId) return;
          tap();
          patch({ [id]: !next });
          Alert.alert(next ? "Couldn't like this item" : "Couldn't unlike this item", errorText(e, "Check your connection and try again."));
        })
        .finally(() => busy.current.delete(id));
      return next;
    },
    [userId, router, patch],
  );

  return { liked, toggle, refresh };
}
