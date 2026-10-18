import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View, type ViewToken } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFeedPost, getPostEngagement, isSaved, listReels, reelFromFeedPost, REELS_PAGE_SIZE, type PostEngagement, type PostTargetType, type Reel } from "@apartment-book/shared";
import { campusSegments, ScopeToggle, type ScopeSegment } from "@/components/home/home-top-tabs";
import { ReelCommentsSheet } from "@/components/home/reel-comments-sheet";
import { ReelItem, reelKey } from "@/components/home/reel-item";
import { markReelsStale } from "@/components/home/reels-section";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { errorText } from "@/lib/hooks";
import { emitPostEngagement, emitPostRemoved } from "@/lib/posts-events";
import { dropHandedReel, peekHandedReel } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Breathing room between the status bar and the first row, as on Home's bar. */
const TOP_GAP = 8;
/** The two rows over the top of the video: Back (with the reel's sound button at the other end), then the Campus | Global toggle. */
const ROW = 44;
/** The sound button ReelItem draws: a 36pt disc, 10pt under the inset it is given. */
const MUTE_SIZE = 36;
const MUTE_OFFSET = 10;
/** The name and the rail keep this much clear above the home indicator, with no bottom bar to clear here. */
const BOTTOM_GAP = 12;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

function mergeUnique(current: Reel[], incoming: Reel[]): Reel[] {
  const seen = new Set(current.map(reelKey));
  return [...current, ...incoming.filter((r) => !seen.has(reelKey(r)))];
}

/** "post:id" → ["post", "id"]. */
function splitKey(key: string): [PostTargetType, string] {
  const sep = key.indexOf(":");
  return [key.slice(0, sep) as PostTargetType, key.slice(sep + 1)];
}

/**
 * The Reels viewer, Instagram style: the reel tapped in a feed (For you) fills the screen and plays, and a swipe up moves
 * on to the next reel, the Reels feed (listReels) running on behind the one that was opened, page by page, posted
 * reels and listing tours alike. Over the video: Back at the top left, the reel's sound button at the top right, the
 * Campus | Global toggle under them (the same choice as Home's, see useHomeScope: picking the other one keeps the reel on
 * screen and the ones already watched, and the reels after it come from the new choice), and at the bottom the creator's
 * name, the caption and the rail (like, comments, share, save, "…") that ReelItem draws for every reel. Likes, saves and
 * comments made here reach the row the viewer was opened from (emitPostEngagement), and a reel deleted here leaves the
 * feeds too. The reel comes from the row that was tapped (see openReel) so it shows at once; opened from a link, it is
 * fetched first.
 */
export default function ReelViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, profile } = useSession();
  const colors = useColors();
  const styles = useStyles();
  const [scope, setScope] = useHomeScope();
  // Your own university or every one, as on Home; someone without a university sees everything.
  const universityId = scope.campus === "all" || !profile?.university_id ? undefined : profile.university_id;
  const universityRef = useRef(universityId);
  universityRef.current = universityId;
  const userId = user?.id ?? null;

  const [height, setHeight] = useState(0);
  /** The reels in the pager: the one opened first, then the feed behind it. Null until the first one is known. */
  const [reels, setReels] = useState<Reel[] | null>(() => {
    const handed = peekHandedReel(id);
    return handed ? [handed] : null;
  });
  useEffect(() => () => dropHandedReel(id), [id]);
  /** The reel opened from a link is not a reel any more (deleted, or never one). */
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [visible, setVisible] = useState(0);
  const visibleRef = useRef(0);
  const [commentsKey, setCommentsKey] = useState<string | null>(null);
  const listRef = useRef<FlatList<Reel>>(null);
  /** Bumped when the feed starts over (another campus choice): answers to older requests are dropped. */
  const seq = useRef(0);
  const offset = useRef(0);
  const done = useRef(false);
  const busy = useRef(false);
  const feedStarted = useRef(false);

  // Opened from a link, with nothing handed over: fetch the reel, its counts and whether it is saved.
  useEffect(() => {
    if (reels !== null) return;
    let alive = true;
    setError(null);
    setGone(false);
    (async () => {
      try {
        const post = await getFeedPost(supabase, id);
        if (!alive) return;
        if (!post || post.kind !== "reel") return setGone(true);
        const [engagement, saved] = await Promise.all([getPostEngagement(supabase, "post", id).catch(() => NO_ENGAGEMENT), userId ? isSaved(supabase, userId, "post", id).catch(() => false) : Promise.resolve(false)]);
        if (!alive) return;
        const reel = reelFromFeedPost(post, engagement, saved);
        if (reel) setReels([reel]);
        else setGone(true);
      } catch (e) {
        if (alive) setError(errorText(e, "Could not load this reel. Check your connection and try again."));
      }
    })();
    return () => {
      alive = false;
    };
    // `retry` runs it again after a failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reels === null, retry, userId]);

  /** The next page of the Reels feed, behind what is on screen; the reel opened first is skipped when the feed reaches it. */
  const loadMore = useCallback(async () => {
    if (busy.current || done.current) return;
    const run = seq.current;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await listReels(supabase, { universityId: universityRef.current, limit: REELS_PAGE_SIZE, offset: offset.current });
      if (run !== seq.current) return;
      offset.current += REELS_PAGE_SIZE;
      if (page.length < REELS_PAGE_SIZE) done.current = true;
      setReels((prev) => mergeUnique(prev ?? [], page));
    } catch {
      // The row at the bottom offers a retry; reaching the end again does not hammer a dead connection.
      if (run === seq.current) setMoreError(true);
    } finally {
      if (run === seq.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  // The feed loads as soon as the first reel is on screen, so the first swipe up has somewhere to go.
  useEffect(() => {
    if (reels === null || feedStarted.current) return;
    feedStarted.current = true;
    void loadMore();
  }, [reels, loadMore]);

  // The other campus choice: the reel on screen and the ones already watched stay put (nothing moves under the finger);
  // the reels after them are the new choice's feed, from its start.
  const scopedFor = useRef(universityId);
  useEffect(() => {
    if (scopedFor.current === universityId) return;
    scopedFor.current = universityId;
    if (!feedStarted.current) return;
    seq.current += 1;
    busy.current = false;
    done.current = false;
    offset.current = 0;
    setLoadingMore(false);
    setMoreError(false);
    setReels((prev) => (prev ? prev.slice(0, visibleRef.current + 1) : prev));
    void loadMore();
  }, [universityId, loadMore]);

  // Leaving for another screen (a profile, a chat, login) closes the comments sheet so it never floats over that screen.
  useEffect(() => {
    if (!focused) setCommentsKey(null);
  }, [focused]);

  const onPatch = useCallback((key: string, patch: Partial<Reel>) => {
    setReels((prev) => (prev ? prev.map((r) => (reelKey(r) === key ? { ...r, ...patch } : r)) : prev));
    // The row this reel was opened from, and its own screen, follow along.
    const [type, targetId] = splitKey(key);
    emitPostEngagement(type, targetId, { likes: patch.likes, comments: patch.comments, likedByMe: patch.likedByMe, saved: patch.savedByMe });
  }, []);
  const onRemoved = useCallback((key: string) => {
    setReels((prev) => (prev ? prev.filter((r) => reelKey(r) !== key) : prev));
    // A posted reel is a feed post that For you lists as well; listing tours live only in the Reels feed.
    const [type, targetId] = splitKey(key);
    if (type === "post") {
      emitPostRemoved(targetId);
      markReelsStale();
    }
  }, []);
  const onOpenComments = useCallback((reel: Reel) => setCommentsKey(reelKey(reel)), []);
  const commentsReel = commentsKey ? (reels?.find((r) => reelKey(r) === commentsKey) ?? null) : null;
  const onCommentCount = useCallback(
    (delta: number) => {
      if (!commentsKey || !commentsReel) return;
      onPatch(commentsKey, { comments: Math.max(0, commentsReel.comments + delta) });
    },
    [commentsKey, commentsReel, onPatch],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index !== null) {
      visibleRef.current = first.index;
      setVisible(first.index);
    }
  }).current;

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  // Campus (when the person has a university) and Global; one choice alone is no toggle. Only the campus is chosen here:
  // Following belongs to Posts and is left as it is.
  const segments = campusSegments(profile);
  const chosen: ScopeSegment["key"] = profile?.university_id && scope.campus === "mine" ? "mine" : "all";
  function choose(key: ScopeSegment["key"]) {
    if (key === chosen || key === "following") return;
    setScope({ campus: key });
    hapticTap();
  }

  // The sound button sits centred in the Back row, at the other end.
  const rowTop = insets.top + TOP_GAP;
  const muteInset = rowTop + (ROW - MUTE_SIZE) / 2 - MUTE_OFFSET;
  const bottomInset = Math.max(insets.bottom, BOTTOM_GAP) + BOTTOM_GAP;

  let body = null;
  if (height > 0 && reels && reels.length > 0) {
    body = (
      <FlatList
        ref={listRef}
        data={reels}
        style={{ width, height }}
        keyExtractor={reelKey}
        renderItem={({ item, index }) => (
          <ReelItem reel={item} width={width} height={height} topInset={muteInset} bottomInset={bottomInset} near={Math.abs(index - visible) <= 1} playing={focused && index === visible} onPatch={onPatch} onOpenComments={onOpenComments} onRemoved={onRemoved} />
        )}
        extraData={`${visible}:${focused}:${height}:${width}:${muteInset}`}
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
        onEndReached={() => {
          if (!moreError) void loadMore();
        }}
        onEndReachedThreshold={2}
        scrollsToTop={false}
      />
    );
  } else if (reels && reels.length === 0) {
    // The only reel here was deleted.
    body = (
      <View style={styles.centered}>
        <Ionicons name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>No more reels</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (gone) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>This reel is no longer available</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>The reel did not load</Text>
        <Text style={styles.stateBody}>{error}</Text>
        <Pressable onPress={() => setRetry((n) => n + 1)} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.onMedia} size="large" />
      </View>
    );
  }

  const onLast = reels !== null && visible >= reels.length - 1;
  return (
    <View style={styles.root} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {focused ? <StatusBar style="light" /> : null}
      {body}

      {/* Back, then the toggle, floating over the video; touches between them go through to the reel. */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: rowTop }]}>
        <View pointerEvents="box-none" style={styles.row}>
          <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
            <Ionicons name="chevron-back" size={30} color={colors.onMedia} style={styles.shadow} />
          </Pressable>
        </View>
        {segments.length > 1 ? (
          <View pointerEvents="box-none" style={styles.toggleRow}>
            <ScopeToggle segments={segments} value={chosen} onChange={choose} overVideo shadow={styles.shadow} />
          </View>
        ) : null}
      </View>

      {loadingMore && onLast ? (
        <View style={[styles.foot, { bottom: 6 + insets.bottom }]} pointerEvents="none">
          <ActivityIndicator color={colors.onMedia} />
        </View>
      ) : moreError && onLast ? (
        <View style={[styles.foot, { bottom: 6 + insets.bottom }]} pointerEvents="box-none">
          <Pressable onPress={() => void loadMore()} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Could not load more reels. Tap to try again.</Text>
          </Pressable>
        </View>
      ) : null}

      <ReelCommentsSheet reel={commentsReel} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
  );
}

/** Everything here sits over video, so it uses the media colours (light text, dark scrims) in both themes. */
const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.mediaBg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { color: colors.onMedia, fontSize: 20, fontWeight: "800", marginTop: 6, textAlign: "center" },
  stateBody: { color: colors.onMediaMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  top: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  row: { height: ROW, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  back: { width: ROW, height: ROW, alignItems: "center", justifyContent: "center" },
  toggleRow: { height: ROW, alignItems: "center", justifyContent: "center" },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  foot: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  retry: { backgroundColor: colors.mediaPill, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: colors.onMedia, fontSize: 13, fontWeight: "700" },
}));
