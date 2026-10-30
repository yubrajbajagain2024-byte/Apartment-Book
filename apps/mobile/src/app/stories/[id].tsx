import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deleteStory, formatMessageTime, listStoryViewers, markStorySeen, muxPlaybackUrl, storyAge, storyDurationMs, type StoryGroup, type StoryViewer } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { Sheet, SheetHeader } from "@/components/sheet";
import { alertWithHaptic, hapticSelect } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { markStoriesStale, noteStoryDeleted, noteStorySeen, takeStories, useStoryGroups } from "@/lib/stories-store";
import { supabase } from "@/lib/supabase";
import { VIDEO_AUDIO_MODE } from "@/lib/video-sound";

/** A pull down this far (or this fast) closes the viewer; less and it springs back. */
const PULL_CLOSE = 120;
const PULL_VELOCITY = 900;

/**
 * Stories full screen, Instagram's way: one person's stories play in turn (a photo for five seconds, a video for its
 * length), a thin bar for each along the top filling as it plays. A tap on the right goes on, on the left goes back;
 * holding the picture pauses it; a sideways swipe moves to the next or the last person (the pages sit side by side);
 * a pull down closes. A story's bar starts once its photo has loaded or its video can play, and stops while a video
 * buffers, so a slow connection never runs a story out behind a blank screen; the next photo loads ahead. Each story is
 * marked seen as it shows (mark_story_seen, the database refusing anything the person may not see), so its ring greys
 * in the tray. Your own stories carry the eye with how many people have seen each, a
 * tap on which lists them (the database tells only the author), and a bin to take one down. Opened from the tray with
 * the groups it showed (handStories), so nothing loads first; opened cold it reads the store.
 */
export default function StoriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { user } = useSession();
  const [handed] = useState(() => takeStories());
  const live = useStoryGroups();
  const groups = handed?.groups ?? live;
  // Where it opened: read once, so a change to the groups never moves the page under the finger.
  const [start] = useState(() => {
    const i = groups.findIndex((g) => g.author.id === id);
    return i < 0 ? 0 : i;
  });
  const [index, setIndex] = useState(start);
  const listRef = useRef<FlatList<StoryGroup>>(null);
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);
  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= groups.length) return close();
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [groups.length, close],
  );
  useEffect(() => {
    if (groups.length === 0) close();
  }, [groups.length, close]);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));

  // The pull down: the viewer follows the finger, shrinking a little and rounding its corners as the screen behind shows.
  const pull = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      pull.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (pull.value > PULL_CLOSE || e.velocityY > PULL_VELOCITY) {
        pull.value = withTiming(height, { duration: 200, easing: Easing.out(Easing.quad) });
        runOnJS(close)();
      } else {
        pull.value = withSpring(0, { damping: 26, stiffness: 300, mass: 1 });
      }
    });
  const pullStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.value }, { scale: 1 - Math.min(pull.value / height, 1) * 0.12 }],
    borderRadius: Math.min(pull.value, 28),
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(pull.value / (height * 0.5), 1) }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={[styles.root, styles.pages, pullStyle]}>
          <FlatList
            ref={listRef}
            data={groups}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(g) => g.author.id}
            initialScrollIndex={Math.min(start, Math.max(0, groups.length - 1))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onEnd}
            renderItem={({ item, index: i }) => <StoryPage group={item} active={i === index} width={width} height={height} me={user?.id ?? null} onDone={() => go(i + 1)} onBack={() => go(i - 1)} onClose={close} />}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            scrollsToTop={false}
          />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** One person's stories, playing while `active` (the page on screen). */
function StoryPage({ group, active, width, height, me, onDone, onBack, onClose }: { group: StoryGroup; active: boolean; width: number; height: number; me: string | null; onDone: () => void; onBack: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(group.startAt);
  const story = group.stories[Math.min(at, group.stories.length - 1)]!;
  const [held, setHeld] = useState(false);
  /** The viewers sheet: null closed, [] loading, else the list. */
  const [viewers, setViewers] = useState<StoryViewer[] | null>(null);
  const progress = useSharedValue(0);
  const duration = storyDurationMs(story);
  const elapsedBefore = useRef(0);
  const mine = group.mine && group.author.id === me;
  // The story whose picture can be seen: its photo loaded (or failed, so the viewer moves on), its video ready and not
  // buffering. The clock runs only for it; the video is asked to play as soon as the page is on screen.
  const [shown, setShown] = useState<string | null>(null);
  const ready = shown === story.id;
  const wanted = active && !held && viewers === null;
  const playing = wanted && ready;
  const storyId = story.id;
  const onPhoto = useCallback(() => setShown(storyId), [storyId]);
  const onVideo = useCallback((canPlay: boolean) => setShown(canPlay ? storyId : null), [storyId]);
  // The next photo of this person's loads while this one shows (the next person's page renders beside this one).
  useEffect(() => {
    const next = group.stories[at + 1];
    if (active && next?.kind === "photo" && next.photo) void Image.prefetch(next.photo.url).catch(() => false);
  }, [active, at, group.stories]);

  const advance = useCallback(() => {
    if (at + 1 < group.stories.length) setAt(at + 1);
    else onDone();
  }, [at, group.stories.length, onDone]);
  const retreat = useCallback(() => {
    if (at > 0) setAt(at - 1);
    else onBack();
  }, [at, onBack]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const fire = useCallback(() => advanceRef.current(), []);

  // A new story on screen: the bar starts over, and the story counts as seen (never your own).
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    elapsedBefore.current = 0;
    if (!active || mine) return;
    noteStorySeen(story.id);
    void markStorySeen(supabase, story.id).catch(() => {});
  }, [story.id, active, mine, progress]);
  // The clock: runs while playing; held, it keeps its place and goes on from there.
  useEffect(() => {
    if (!playing) {
      cancelAnimation(progress);
      elapsedBefore.current = progress.value * duration;
      return;
    }
    const remaining = Math.max(60, duration - elapsedBefore.current);
    progress.value = withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
    return () => cancelAnimation(progress);
  }, [playing, story.id, duration, progress, fire]);

  async function openViewers() {
    if (!mine) return;
    hapticSelect();
    setViewers([]);
    try {
      setViewers(await listStoryViewers(supabase, story.id));
    } catch {
      setViewers([]);
    }
  }
  function confirmDelete() {
    setHeld(true);
    Alert.alert("Delete this story?", "It disappears for everyone right away.", [
      { text: "Cancel", style: "cancel", onPress: () => setHeld(false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteStory(supabase, story.id);
            noteStoryDeleted(story.id);
            markStoriesStale();
            hapticSelect();
            onClose();
          } catch (e) {
            setHeld(false);
            alertWithHaptic("error", "Couldn't delete it", e instanceof Error ? e.message : "Try again.");
          }
        },
      },
    ]);
  }

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {story.kind === "photo" && story.photo ? <Image key={story.id} source={{ uri: story.photo.url }} placeholder={story.photo.blur ? { blurhash: story.photo.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} onLoad={onPhoto} onError={onPhoto} accessibilityIgnoresInvertColors /> : null}
      {story.kind === "video" && story.video ? <StoryVideo key={story.id} playbackId={story.video.playback_id} playing={wanted} onReady={onVideo} /> : null}
      {/* Only when loading takes a moment: a cached photo shows before this would. */}
      {active && !ready ? (
        <Animated.View entering={FadeIn.delay(300).duration(200)} pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color="#fff" />
        </Animated.View>
      ) : null}
      <View pointerEvents="none" style={styles.topShade} />
      <View pointerEvents="none" style={styles.bottomShade} />

      {/* The taps: the left third goes back, the rest goes on; a hold anywhere pauses. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable style={styles.leftZone} onPress={retreat} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Previous story" />
        <Pressable style={styles.rightZone} onPress={advance} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Next story" />
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.bars} accessible accessibilityLabel={`Story ${at + 1} of ${group.stories.length}`}>
          {group.stories.map((s, i) => (
            <Bar key={s.id} state={i < at ? 1 : i > at ? 0 : null} progress={progress} />
          ))}
        </View>
        <View style={styles.who} pointerEvents="box-none">
          <Avatar name={group.author.full_name} url={group.author.avatar_url} size={32} online={false} />
          <Text style={styles.name} numberOfLines={1}>
            {mine ? "Your story" : group.author.full_name}
          </Text>
          <Text style={styles.age}>{storyAge(story.createdAt)}</Text>
          <View style={{ flex: 1 }} />
          {mine ? <GlassIconButton icon="trash-outline" label="Delete this story" onPress={confirmDelete} variant="media" size={36} iconSize={17} haptic={false} /> : null}
          <GlassIconButton icon="close" label="Close" onPress={onClose} variant="media" size={36} iconSize={18} haptic={false} />
        </View>
      </View>

      {mine ? (
        <Pressable onPress={() => void openViewers()} style={({ pressed }) => [styles.views, { bottom: insets.bottom + 18 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${story.views} ${story.views === 1 ? "view" : "views"}`} accessibilityHint="Shows who has seen it">
          <Icon name="eye-outline" size={18} color="#fff" />
          <Text style={styles.viewsText}>{story.views}</Text>
        </Pressable>
      ) : null}

      <Sheet visible={viewers !== null} onClose={() => setViewers(null)} closeLabel="Close the list of views">
        <SheetHeader title={viewers && viewers.length > 0 ? `${viewers.length} ${viewers.length === 1 ? "view" : "views"}` : "Views"} onClose={() => setViewers(null)} />
        {viewers && viewers.length === 0 ? (
          <Text style={styles.noViews}>No views yet</Text>
        ) : (
          <FlatList
            data={viewers ?? []}
            keyExtractor={(v) => v.viewer.id}
            renderItem={({ item }) => (
              <View style={styles.viewerRow}>
                <Avatar name={item.viewer.full_name} url={item.viewer.avatar_url} size={40} online={false} />
                <Text style={styles.viewerName} numberOfLines={1}>
                  {item.viewer.full_name}
                </Text>
                <Text style={styles.viewerTime}>{formatMessageTime(item.at)}</Text>
              </View>
            )}
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          />
        )}
      </Sheet>
    </View>
  );
}

/** One story's bar along the top: full for the ones played, empty for the ones to come, filling for the one on screen. */
function Bar({ state, progress }: { state: 0 | 1 | null; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ width: `${(state === null ? progress.value : state) * 100}%` }));
  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, style]} />
    </View>
  );
}

/**
 * A video story: its own player, from the start, with sound; paused with the page. It tells the page whether it can be
 * seen playing (ready, not buffering); a video that fails counts as ready, so the story's time runs out and moves on.
 */
function StoryVideo({ playbackId, playing, onReady }: { playbackId: string; playing: boolean; onReady: (canPlay: boolean) => void }) {
  const player = useVideoPlayer({ uri: muxPlaybackUrl(playbackId) }, (p) => {
    p.loop = false;
    p.muted = false;
    p.audioMixingMode = VIDEO_AUDIO_MODE;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  useEffect(() => {
    onReady(player.status === "readyToPlay" || player.status === "error");
    const sub = player.addListener("statusChange", ({ status }) => onReady(status === "readyToPlay" || status === "error"));
    return () => sub.remove();
  }, [player, onReady]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} allowsVideoFrameAnalysis={false} accessibilityLabel="Video" />;
}

const shadow = { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } } as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: "#000" },
  pages: { overflow: "hidden", backgroundColor: "#000" },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 140, experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)" },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 120, experimental_backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 100%)" },
  loading: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  leftZone: { position: "absolute", top: 0, bottom: 0, left: 0, width: "32%" },
  rightZone: { position: "absolute", top: 0, bottom: 0, right: 0, width: "68%" },
  header: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 10 },
  bars: { flexDirection: "row", gap: 4 },
  bar: { flex: 1, height: 2.5, borderRadius: 1.25, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#fff" },
  who: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 2 },
  name: { color: "#fff", fontSize: 15, fontWeight: "600", flexShrink: 1, ...shadow },
  age: { color: "rgba(255,255,255,0.75)", fontSize: 14, ...shadow },
  views: { position: "absolute", left: 16, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.35)" },
  viewsText: { color: "#fff", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  noViews: { textAlign: "center", paddingVertical: 32, fontSize: 15, color: "#8e8e93" },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerTime: { fontSize: 13, color: "#8e8e93" },
});
