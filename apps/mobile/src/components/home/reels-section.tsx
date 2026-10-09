import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { listReels, REELS_PAGE_SIZE, type Reel } from "@apartment-book/shared";
import { errorText } from "@/lib/hooks";
import { emitPostRemoved } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { ReelCommentsSheet } from "./reel-comments-sheet";
import { ReelItem, reelKey } from "./reel-item";

/** Set after someone posts a reel, so the feed reloads the next time it is on screen. */
let reelsStale = false;
export function markReelsStale() {
  reelsStale = true;
}

/** reels_feed returns at most 30 rows per call; past three calls a plain reload is cheaper. */
const RESYNC_CHUNK = 30;
const RESYNC_MAX = 90;

function mergeUnique(current: Reel[], incoming: Reel[]): Reel[] {
  const seen = new Set(current.map(reelKey));
  return [...current, ...incoming.filter((r) => !seen.has(reelKey(r)))];
}

/** Home → Reels: one full-screen video per page, swipe up for the next one. */
export function ReelsSection({ active, topInset, height }: { active: boolean; topInset: number; height: number }) {
  const { user } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [visible, setVisible] = useState(0);
  const [commentsKey, setCommentsKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<Reel>>(null);
  const seq = useRef(0);
  const offset = useRef(0);
  const done = useRef(false);
  const busyMore = useRef(false);
  const started = useRef(false);
  /** Who the rows on screen were fetched for: hearts and "Saved" belong to one person. */
  const loadedFor = useRef<string | null>(null);
  const userId = user?.id ?? null;
  const count = useRef(0);
  useEffect(() => {
    count.current = reels?.length ?? 0;
  }, [reels]);

  const loadFirst = useCallback(async (mode: "initial" | "refresh") => {
    const id = ++seq.current;
    reelsStale = false;
    if (mode === "refresh") setRefreshing(true);
    setError(null);
    try {
      const page = await listReels(supabase, { limit: REELS_PAGE_SIZE, offset: 0 });
      if (id !== seq.current) return;
      offset.current = REELS_PAGE_SIZE;
      done.current = page.length < REELS_PAGE_SIZE;
      setReels(mergeUnique([], page));
      setVisible(0);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch (e) {
      if (id !== seq.current) return;
      // A failed pull-to-refresh keeps what is already on screen.
      if (count.current === 0) setError(errorText(e, "Could not load reels. Check your connection and try again."));
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (busyMore.current || done.current || !started.current || offset.current === 0) return;
    const id = seq.current;
    busyMore.current = true;
    setLoadingMore(true);
    try {
      const page = await listReels(supabase, { limit: REELS_PAGE_SIZE, offset: offset.current });
      if (id !== seq.current) return;
      offset.current += REELS_PAGE_SIZE;
      if (page.length < REELS_PAGE_SIZE) done.current = true;
      setReels((prev) => mergeUnique(prev ?? [], page));
    } catch {
      // Quietly give up: reaching the end again retries.
    } finally {
      busyMore.current = false;
      setLoadingMore(false);
    }
  }, []);

  /** After signing in or out: fetch the same rows again for the new person and keep the place in the feed. */
  const resyncUser = useCallback(async () => {
    const total = count.current;
    if (total === 0 || total > RESYNC_MAX) return loadFirst("refresh");
    const id = seq.current;
    try {
      const fresh = new Map<string, Reel>();
      for (let from = 0; from < total; from += RESYNC_CHUNK) {
        const page = await listReels(supabase, { limit: RESYNC_CHUNK, offset: from });
        if (id !== seq.current) return;
        page.forEach((r) => fresh.set(reelKey(r), r));
        if (page.length < RESYNC_CHUNK) break;
      }
      setReels((prev) =>
        prev
          ? prev.map((r) => {
              const f = fresh.get(reelKey(r));
              // A row that was not returned again can at least not keep someone else's heart.
              return f ? { ...r, likes: f.likes, comments: f.comments, likedByMe: f.likedByMe, savedByMe: f.savedByMe } : { ...r, likedByMe: false, savedByMe: false };
            })
          : prev,
      );
    } catch {
      if (id === seq.current) void loadFirst("refresh");
    }
  }, [loadFirst]);

  // Nothing is fetched until Reels is actually opened; after that, a new reel by this user or a change of account triggers a reload.
  useEffect(() => {
    if (!active) return;
    if (!started.current) {
      started.current = true;
      loadedFor.current = userId;
      void loadFirst("initial");
    } else if (reelsStale) {
      loadedFor.current = userId;
      void loadFirst("refresh");
    } else if (loadedFor.current !== userId) {
      loadedFor.current = userId;
      void resyncUser();
    }
  }, [active, userId, loadFirst, resyncUser]);

  // Leaving Home (for a profile, a listing, login…) closes the comments sheet so it never floats over another screen.
  useEffect(() => {
    if (!active) setCommentsKey(null);
  }, [active]);

  const onPatch = useCallback((key: string, patch: Partial<Reel>) => {
    setReels((prev) => (prev ? prev.map((r) => (reelKey(r) === key ? { ...r, ...patch } : r)) : prev));
  }, []);
  const onRemoved = useCallback((key: string) => {
    setReels((prev) => (prev ? prev.filter((r) => reelKey(r) !== key) : prev));
    // A posted reel is a feed post that For you lists as well; listing tours live only here.
    const sep = key.indexOf(":");
    if (key.slice(0, sep) === "post") emitPostRemoved(key.slice(sep + 1));
  }, []);
  const onOpenComments = useCallback((reel: Reel) => setCommentsKey(reelKey(reel)), []);
  const onCommentCount = useCallback(
    (delta: number) => {
      if (!commentsKey) return;
      setReels((prev) => (prev ? prev.map((r) => (reelKey(r) === commentsKey ? { ...r, comments: Math.max(0, r.comments + delta) } : r)) : prev));
    },
    [commentsKey],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index !== null) setVisible(first.index);
  }).current;

  const create = () => router.push(user ? "/create/reel" : "/(auth)/login");

  if (height <= 0) return <View style={styles.fill} />;

  let body;
  if (error && (!reels || reels.length === 0)) {
    body = (
      <View style={[styles.fill, styles.centered, { paddingTop: topInset }]}>
        <Ionicons name="cloud-offline-outline" size={44} color="rgba(255,255,255,0.7)" />
        <Text style={styles.stateTitle}>Reels did not load</Text>
        <Text style={styles.stateBody}>{error}</Text>
        <Pressable onPress={() => void loadFirst("initial")} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (reels === null) {
    body = (
      <View style={[styles.fill, styles.centered]}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={[styles.stateBody, { marginTop: 10 }]}>Loading reels…</Text>
      </View>
    );
  } else if (reels.length === 0) {
    body = (
      <View style={[styles.fill, styles.centered, { paddingTop: topInset }]}>
        <Ionicons name="film-outline" size={48} color="rgba(255,255,255,0.7)" />
        <Text style={styles.stateTitle}>No reels yet</Text>
        <Text style={styles.stateBody}>Share a quick video of campus life, your place or a room tour.</Text>
        <Pressable onPress={create} style={styles.stateButton} accessibilityRole="button">
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.stateButtonText}>Post the first reel</Text>
        </Pressable>
        <Pressable onPress={() => void loadFirst("refresh")} hitSlop={8} style={{ marginTop: 14 }} accessibilityRole="button">
          <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "600" }}>{refreshing ? "Checking…" : "Check again"}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={reels}
        style={{ width, height }}
        keyExtractor={reelKey}
        renderItem={({ item, index }) => (
          <ReelItem reel={item} width={width} height={height} topInset={topInset} near={index === visible || (active && Math.abs(index - visible) <= 1)} playing={active && index === visible} onPatch={onPatch} onOpenComments={onOpenComments} onRemoved={onRemoved} />
        )}
        extraData={`${visible}:${active}:${height}:${width}`}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={2}
        scrollsToTop={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFirst("refresh")} tintColor="#fff" colors={[colors.brand]} progressViewOffset={topInset} />}
      />
    );
  }

  const commentsReel = commentsKey ? (reels?.find((r) => reelKey(r) === commentsKey) ?? null) : null;
  return (
    <View style={{ height, backgroundColor: "#000" }}>
      {body}
      {/* Posting a reel starts from the "+" in the Home top bar, so there is no second "+" here. */}
      {loadingMore && reels && visible >= reels.length - 1 ? (
        <View style={styles.more} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      <ReelCommentsSheet reel={commentsReel} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 6 },
  stateBody: { color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  more: { position: "absolute", bottom: 6, left: 0, right: 0, alignItems: "center" },
});
