import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from "react-native";
import { Image } from "expo-image";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getFeedPost, getPostEngagement, isSaved, listReels, REELS_PAGE_SIZE, type PostEngagement, type PostTargetType, type Reel } from "@apartment-book/shared";
import { campusSegments, ScopeToggle, type ScopeSegment } from "@/components/home/home-top-tabs";
import { ReelCommentsSheet } from "@/components/home/reel-comments-sheet";
import { ReelItem } from "@/components/home/reel-item";
import { markReelsStale } from "@/components/home/reels-section";
import { hapticTap } from "@/lib/haptics";
import { useHomeScope } from "@/lib/home-scope";
import { errorText } from "@/lib/hooks";
import { emitPostEngagement, emitPostRemoved } from "@/lib/posts-events";
import { dropHanded, entryOf, loadViewerItems, peekHanded, viewerItemFromPost, viewerItemFromReel, viewerKey, type ViewerEntry, type ViewerItem, type ViewerSource } from "@/lib/reel-viewer";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { auroraGradient, textStyle } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";
import { GlassIconButton } from "@/components/glass";

/** Breathing room between the status bar and the top row, as on Home's bar. */
const TOP_GAP = 8;
/** The one row over the top of the video: Back at the left, the Campus | Global toggle in the middle, the reel's sound button at the right. */
const ROW = 44;
/** The sound button ReelItem draws: a 36pt disc, 10pt under the inset it is given. */
const MUTE_SIZE = 36;
const MUTE_OFFSET = 10;
/** The "Add comment…" bar at the bottom of every page: the pill's height, the gap above it, and the least it keeps from the screen's bottom edge. */
const COMMENT_BAR = 48;
const COMMENT_BAR_GAP = 10;
const COMMENT_BAR_BOTTOM = 12;
/** How many pages ahead (and one behind) a post known only by its id is loaded. */
const LOAD_AHEAD = 3;
const NO_ENGAGEMENT: PostEngagement = { likes: 0, comments: 0, likedByMe: false };

function mergeUnique(current: ViewerEntry[], incoming: ViewerEntry[]): ViewerEntry[] {
  const seen = new Set(current.map((e) => e.key));
  return [...current, ...incoming.filter((e) => !seen.has(e.key))];
}

/** "post:id" → ["post", "id"]. */
function splitKey(key: string): [PostTargetType, string] {
  const sep = key.indexOf(":");
  return [key.slice(0, sep) as PostTargetType, key.slice(sep + 1)];
}

/**
 * The full-screen viewer, Instagram style, for every reel and every post with photos or videos: what was tapped fills
 * the screen edge to edge, and a swipe up moves on. A reel goes on into the Reels feed (listReels: posted reels and
 * listing tours, page by page, behind the one that was opened); a post from a list (For you, a profile grid, Saved) goes
 * on through that list, as the source hands it over (see openViewer). A post's photos and videos swipe sideways on
 * their page. Over every page, one row at the top: Back at the left, the Campus | Global toggle in the middle while the
 * Reels feed is running (the same choice as Home's, see useHomeScope: picking the other one keeps the page on screen and
 * the ones already seen, and the reels after it come from the new choice) and a video's sound button at the right. At
 * the bottom, the creator's name, the words and the rail (like, comments, share, save, "…") that ReelItem draws for every
 * page, and under them an "Add comment…" bar that opens the comments straight into typing. Likes, saves and comments
 * made here reach the row the viewer was opened from (emitPostEngagement), and a post deleted here leaves the feeds too.
 * Handed-over pages show at once; a post known only by its id (a profile square, a chat card) loads as it comes near,
 * its picture standing in meanwhile; opened from a link, the post is fetched first.
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

  /** What the opener handed over (read once): the pages, the one tapped and what comes after them. A link hands over nothing. */
  const [handed] = useState<ViewerSource | null>(() => peekHanded(id));
  useEffect(() => () => dropHanded(id), [id]);
  /** After the last page: the Reels feed, the opener's next pages, or nothing. */
  const then = handed?.then ?? "reels";
  const reelsMode = then === "reels";
  /** A list that follows the Campus | Global choice (For you): the toggle shows, and a change swaps what comes next. */
  const rescope = typeof then === "object" ? then.rescope : undefined;
  const scoped = reelsMode || Boolean(rescope);
  /** The list's next pages, swapped for the other campus's after a change of choice. */
  const listMore = useRef(typeof then === "object" ? then.more : null);
  const startIndex = handed ? Math.max(0, Math.min(handed.index, handed.entries.length - 1)) : 0;

  const [height, setHeight] = useState(0);
  /** The pages: what was handed over, then whatever follows. Null until the first one is known. */
  const [entries, setEntries] = useState<ViewerEntry[] | null>(() => (handed ? handed.entries : null));
  /** The post opened from a link is not there any more (deleted, or nothing to show full screen). */
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [visible, setVisible] = useState(startIndex);
  const visibleRef = useRef(startIndex);
  const [commentsKey, setCommentsKey] = useState<string | null>(null);
  /** The comments were opened from the "Add comment…" bar: the sheet comes up with the keyboard. */
  const [commentsTyping, setCommentsTyping] = useState(false);
  const listRef = useRef<FlatList<ViewerEntry>>(null);
  /** Bumped when the feed starts over (another campus choice): answers to older requests are dropped. */
  const seq = useRef(0);
  const offset = useRef(0);
  const done = useRef(then === "end");
  const busy = useRef(false);
  const feedStarted = useRef(false);

  // Opened from a link, with nothing handed over: fetch the post, its counts and whether it is saved.
  useEffect(() => {
    if (entries !== null) return;
    let alive = true;
    setError(null);
    setGone(false);
    (async () => {
      try {
        const post = await getFeedPost(supabase, id);
        if (!alive) return;
        if (!post) return setGone(true);
        const [engagement, saved] = await Promise.all([getPostEngagement(supabase, "post", id).catch(() => NO_ENGAGEMENT), userId ? isSaved(supabase, userId, "post", id).catch(() => false) : Promise.resolve(false)]);
        if (!alive) return;
        const item = viewerItemFromPost(post, engagement, saved);
        if (item) setEntries([entryOf(item)]);
        else setGone(true);
      } catch (e) {
        if (alive) setError(errorText(e, "Could not load this post. Check your connection and try again."));
      }
    })();
    return () => {
      alive = false;
    };
    // `retry` runs it again after a failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, entries === null, retry, userId]);

  /**
   * The pages after the last one: the next page of the Reels feed (the page opened first is skipped when the feed reaches
   * it), or the opener's next pages. Nothing once that runs dry, or for a list that simply ends.
   */
  const loadMore = useCallback(async () => {
    if (busy.current || done.current || then === "end") return;
    const run = seq.current;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(false);
    try {
      let next: ViewerEntry[];
      if (then === "reels") {
        const page = await listReels(supabase, { universityId: universityRef.current, limit: REELS_PAGE_SIZE, offset: offset.current });
        if (run !== seq.current) return;
        offset.current += REELS_PAGE_SIZE;
        if (page.length < REELS_PAGE_SIZE) done.current = true;
        next = page.map((reel: Reel) => entryOf(viewerItemFromReel(reel)));
      } else {
        const more = listMore.current;
        next = more ? await more() : [];
        if (run !== seq.current) return;
        if (next.length === 0) done.current = true;
      }
      setEntries((prev) => mergeUnique(prev ?? [], next));
    } catch {
      // The row at the bottom offers a retry; reaching the end again does not hammer a dead connection.
      if (run === seq.current) setMoreError(true);
    } finally {
      if (run === seq.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, [then]);

  // The Reels feed loads as soon as the first page is on screen, so the first swipe up has somewhere to go. A list's
  // next pages wait until its end comes near (onEndReached).
  useEffect(() => {
    if (!reelsMode || entries === null || feedStarted.current) return;
    feedStarted.current = true;
    void loadMore();
  }, [reelsMode, entries, loadMore]);

  // The other campus choice: the page on screen and the ones already seen stay put (nothing moves under the finger);
  // what comes after them is the new choice's feed, from its start (the Reels feed, or For you's).
  const scopedFor = useRef(universityId);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    if (scopedFor.current === universityId) return;
    scopedFor.current = universityId;
    if (reelsMode && !feedStarted.current) return;
    if (!reelsMode && !rescope) return;
    seq.current += 1;
    busy.current = false;
    done.current = false;
    offset.current = 0;
    setLoadingMore(false);
    setMoreError(false);
    const kept = (entriesRef.current ?? []).slice(0, visibleRef.current + 1);
    if (rescope) listMore.current = rescope(universityId, new Set(kept.map((e) => e.id)));
    setEntries((prev) => (prev ? prev.slice(0, visibleRef.current + 1) : prev));
    void loadMore();
  }, [universityId, reelsMode, rescope, loadMore]);

  // Posts known only by their id (a profile square, a chat card) load a few pages ahead of the finger, and one behind.
  const loadingIds = useRef(new Set<string>());
  useEffect(() => {
    if (!entries) return;
    const want = entries.slice(Math.max(0, visible - 1), visible + LOAD_AHEAD + 1).filter((e) => !e.item && !e.gone && !loadingIds.current.has(e.id));
    if (want.length === 0) return;
    const ids = want.map((e) => e.id);
    ids.forEach((i) => loadingIds.current.add(i));
    loadViewerItems(ids, userId).then(
      (found) => {
        setEntries((prev) => prev?.map((e) => (e.item || !ids.includes(e.id) ? e : found[e.id] ? { ...e, item: found[e.id] } : { ...e, gone: true })) ?? prev);
      },
      () => {
        // Asked again the next time the finger comes this way.
        ids.forEach((i) => loadingIds.current.delete(i));
      },
    );
  }, [entries, visible, userId]);

  // Leaving for another screen (a profile, a chat, login) closes the comments sheet so it never floats over that screen.
  useEffect(() => {
    if (!focused) setCommentsKey(null);
  }, [focused]);

  const onPatch = useCallback((key: string, patch: Partial<Reel>) => {
    setEntries((prev) => (prev ? prev.map((e) => (e.key === key && e.item ? { ...e, item: { ...e.item, ...patch } } : e)) : prev));
    // The row this page was opened from, and its own screen, follow along.
    const [type, targetId] = splitKey(key);
    emitPostEngagement(type, targetId, { likes: patch.likes, comments: patch.comments, likedByMe: patch.likedByMe, saved: patch.savedByMe });
  }, []);
  const onRemoved = useCallback((key: string) => {
    setEntries((prev) => (prev ? prev.filter((e) => e.key !== key) : prev));
    // A post or posted reel is a feed post that For you lists as well; listing tours live only in the Reels feed.
    const [type, targetId] = splitKey(key);
    if (type === "post") {
      emitPostRemoved(targetId);
      markReelsStale();
    }
  }, []);
  const onOpenComments = useCallback((item: ViewerItem, typing = false) => {
    setCommentsTyping(typing);
    setCommentsKey(viewerKey(item));
  }, []);
  const commentsItem = commentsKey ? (entries?.find((e) => e.key === commentsKey)?.item ?? null) : null;
  const onCommentCount = useCallback(
    (delta: number) => {
      if (!commentsKey || !commentsItem) return;
      onPatch(commentsKey, { comments: Math.max(0, commentsItem.comments + delta) });
    },
    [commentsKey, commentsItem, onPatch],
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
  // Following belongs to Posts and is left as it is. Only for the Reels feed and For you: a list (a profile's posts) is what it is.
  const segments = campusSegments(profile);
  const chosen: ScopeSegment["key"] = profile?.university_id && scope.campus === "mine" ? "mine" : "all";
  function choose(key: ScopeSegment["key"]) {
    if (key === chosen || key === "following") return;
    setScope({ campus: key });
    hapticTap();
  }

  // The sound button sits centred in the top row, at the other end from Back.
  const rowTop = insets.top + TOP_GAP;
  const muteInset = rowTop + (ROW - MUTE_SIZE) / 2 - MUTE_OFFSET;
  // The comment bar's pill sits this far up from the screen's bottom edge; the name and the rail stay above the bar.
  const barBottom = Math.max(insets.bottom, COMMENT_BAR_BOTTOM);
  const barHeight = barBottom + COMMENT_BAR + COMMENT_BAR_GAP;

  let body = null;
  if (height > 0 && entries && entries.length > 0) {
    body = (
      <FlatList
        ref={listRef}
        data={entries}
        style={{ width, height }}
        keyExtractor={(e) => e.key}
        initialScrollIndex={Math.min(startIndex, entries.length - 1)}
        renderItem={({ item: entry, index }) => (
          <View style={{ width, height }}>
            {entry.item ? (
              <>
                <ReelItem reel={entry.item} width={width} height={height} topInset={muteInset} bottomInset={barHeight} near={Math.abs(index - visible) <= 1} playing={focused && index === visible} onPatch={onPatch} onOpenComments={onOpenComments} onRemoved={onRemoved} initialSlide={entry.slide} />
                {/* "Add comment…" under the name and the rail, like Instagram's: a tap opens the comments with the keyboard up. */}
                <View pointerEvents="box-none" style={[styles.commentBar, { bottom: barBottom }]}>
                  <Pressable onPress={() => onOpenComments(entry.item!, true)} style={({ pressed }) => [styles.commentInput, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Add comment" accessibilityHint="Opens the comments, ready to type">
                    <Text style={styles.commentPlaceholder}>Add comment…</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <PendingPage entry={entry} width={width} height={height} />
            )}
          </View>
        )}
        extraData={`${visible}:${focused}:${height}:${width}:${muteInset}:${barBottom}`}
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
  } else if (entries && entries.length === 0) {
    // The only page here was deleted.
    body = (
      <View style={styles.centered}>
        <Icon name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>Nothing more to see</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (gone) {
    body = (
      <View style={styles.centered}>
        <Icon name="film-outline" size={48} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>This post is no longer available</Text>
        <Pressable onPress={leave} style={styles.stateButton} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Icon name="cloud-offline-outline" size={44} color={colors.onMediaMuted} />
        <Text style={styles.stateTitle}>The post did not load</Text>
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

  const onLast = entries !== null && visible >= entries.length - 1;
  return (
    <View style={styles.root} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {focused ? <StatusBar style="light" /> : null}
      {body}

      {/* One row floating over the picture: Back at the left, the toggle in the middle (a video's own sound button takes the right end); touches between them go through to the page. */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: rowTop }]}>
        <View pointerEvents="box-none" style={styles.row}>
          {/* Back on clear glass over the picture, as the system draws its bar buttons over media. */}
          <GlassIconButton icon="chevron-back" label="Back" onPress={leave} variant="media" size={40} iconSize={19} haptic={false} hitSlop={8} style={styles.back} />
          {scoped && segments.length > 1 ? <ScopeToggle segments={segments} value={chosen} onChange={choose} overVideo shadow={styles.shadow} /> : null}
        </View>
      </View>

      {loadingMore && onLast ? (
        <View style={[styles.foot, { bottom: barHeight + 6 }]} pointerEvents="none">
          <ActivityIndicator color={colors.onMedia} />
        </View>
      ) : moreError && onLast ? (
        <View style={[styles.foot, { bottom: barHeight + 6 }]} pointerEvents="box-none">
          <Pressable onPress={() => void loadMore()} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>Could not load more. Tap to try again.</Text>
          </Pressable>
        </View>
      ) : null}

      <ReelCommentsSheet reel={commentsItem} focusComposer={commentsTyping} onClose={() => setCommentsKey(null)} onCountChange={onCommentCount} />
    </View>
  );
}

/** A page whose post is still loading (its picture stands in, under a spinner), or one that has been deleted since. */
function PendingPage({ entry, width, height }: { entry: ViewerEntry; width: number; height: number }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      {entry.thumb ? <Image source={{ uri: entry.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={entry.gone ? 30 : 0} transition={0} /> : null}
      <View style={[StyleSheet.absoluteFill, styles.pendingDim]} />
      <View style={styles.centered}>
        {entry.gone ? (
          <>
            <Icon name="eye-off-outline" size={40} color={colors.onMediaMuted} />
            <Text style={styles.stateTitle}>This post is no longer available</Text>
          </>
        ) : (
          <ActivityIndicator color={colors.onMedia} size="large" />
        )}
      </View>
    </View>
  );
}

/** Everything here sits over video, so it uses the media colours (light text, dark scrims) in both themes. */
const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.mediaBg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  stateTitle: { color: colors.onMedia, ...textStyle.title3, marginTop: 6, textAlign: "center" },
  stateBody: { color: colors.onMediaMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  stateButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora), borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 12 },
  stateButtonText: { color: colors.onBrand, fontSize: 15, fontWeight: "700" },
  top: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  // The toggle is centred on the screen; Back keeps to the left edge, level with it.
  row: { height: ROW, alignItems: "center", justifyContent: "center" },
  back: { position: "absolute", left: 12, top: (ROW - 40) / 2 },
  // A dark, see-through pill in the screen's gutters, the same in both themes since it sits on video.
  commentBar: { position: "absolute", left: 0, right: 0, paddingHorizontal: 16 },
  commentInput: { height: COMMENT_BAR, borderRadius: 999, justifyContent: "center", paddingHorizontal: 20, backgroundColor: colors.mediaPill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onMediaMuted },
  commentPlaceholder: { color: colors.onMediaMuted, fontSize: 16 },
  shadow: { textShadowColor: colors.mediaScrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  foot: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  retry: { backgroundColor: colors.mediaPill, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: colors.onMedia, fontSize: 13, fontWeight: "700" },
  pendingDim: { backgroundColor: "rgba(0,0,0,0.35)" },
}));
