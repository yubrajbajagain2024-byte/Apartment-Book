import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type TextInputInstance } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  blockUser,
  deleteStory,
  formatMessageTime,
  getOrCreateDirectConversation,
  likeStory,
  listStoryViewers,
  markStorySeen,
  muxPlaybackUrl,
  REPORT_REASONS,
  reportContent,
  sendMessage,
  sharedPostFromStory,
  storyAge,
  storyDurationMs,
  unlikeStory,
  type StoryGroup,
  type StoryViewer,
} from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { Avatar } from "@/components/avatar";
import { GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { ShareSheetProvider, useShareSheet } from "@/components/share-sheet";
import { Sheet, SheetHeader } from "@/components/sheet";
import { alertWithHaptic, hapticLike, hapticSelect, hapticSuccess, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { findStoryGroup, getStoryGroups, markStoriesStale, noteStoryAuthorBlocked, noteStoryDeleted, noteStoryLiked, noteStorySeen, refreshStories, setStoryMuted, takeStories, useStoryGroups, useStoryMuted } from "@/lib/stories-store";
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
 * in the tray. Your own stories carry the eye with how many people have seen each (and a heart with how many liked
 * them), a tap on which lists them (the database tells only the author), a paper plane to send one to friends, and a bin
 * to take one down. Someone else's carry Instagram's row along the bottom: "Send message" (a reply in a chat with them,
 * carrying the story), a heart, and the paper plane; and a "⋯" at the top for Report, Mute and Block (migration 62).
 * Typing, a sheet or a menu holds the story where it is. Opened from the tray with the groups it showed (handStories),
 * so nothing loads first; opened cold it reads the store. Opened by a story's id (a story card in a chat) or for a
 * person the tray leaves out (muted), it shows that person's stories alone, from the story named.
 */
export default function StoriesScreen() {
  return (
    // Its own share sheet: this screen is a modal above the root layout's, which could not appear over it.
    <ShareSheetProvider>
      <StoriesViewer />
    </ShareSheetProvider>
  );
}

/** The one person's group to show when the viewer is opened by a story's id or a person outside the tray, from that story. */
function singleGroup(id: string): StoryGroup | null {
  const g = findStoryGroup(id);
  if (!g) return null;
  const at = g.stories.findIndex((s) => s.id === id);
  return at < 0 ? g : { ...g, startAt: at };
}

function StoriesViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { user } = useSession();
  const [handed] = useState(() => takeStories());
  const live = useStoryGroups();
  // Not the tray's: looked up in the store (loading it first when it has nothing yet), or gone.
  const [lookup, setLookup] = useState<StoryGroup | "loading" | "gone" | null>(() => (handed || getStoryGroups().some((g) => g.author.id === id) ? null : (singleGroup(id) ?? "loading")));
  const meId = user?.id ?? null;
  useEffect(() => {
    if (lookup !== "loading") return;
    if (!meId) return setLookup("gone");
    let stale = false;
    void refreshStories(meId).then(() => {
      if (!stale) setLookup(singleGroup(id) ?? "gone");
    });
    return () => {
      stale = true;
    };
  }, [lookup, meId, id]);
  const groups = useMemo(() => handed?.groups ?? (lookup === null ? live : typeof lookup === "object" ? [lookup] : []), [handed, lookup, live]);
  // One keyboard watcher for every page (Reanimated wants as few as possible): the reply row rides on top of it.
  const keyboard = useAnimatedKeyboard();
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
    if (groups.length > 0 || lookup === "loading") return;
    // A story card in a chat outlives its story by days: say why nothing opens.
    if (lookup === "gone") Alert.alert("Story unavailable", "This story is no longer available.");
    close();
  }, [groups.length, lookup, close]);
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

  if (lookup === "loading") {
    return (
      <View style={[styles.root, styles.backdrop, styles.loading]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
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
            renderItem={({ item, index: i }) => <StoryPage group={item} active={i === index} width={width} height={height} me={meId} keyboard={keyboard.height} onDone={() => go(i + 1)} onBack={() => go(i - 1)} onClose={close} />}
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

/** One person's stories, playing while `active` (the page on screen). `keyboard` is the keyboard's height, for the reply row. */
function StoryPage({ group, active, width, height, me, keyboard, onDone, onBack, onClose }: { group: StoryGroup; active: boolean; width: number; height: number; me: string | null; keyboard: SharedValue<number>; onDone: () => void; onBack: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const [at, setAt] = useState(group.startAt);
  const story = group.stories[Math.min(at, group.stories.length - 1)]!;
  const [held, setHeld] = useState(false);
  /** The viewers sheet: null closed, [] loading, else the list. */
  const [viewers, setViewers] = useState<StoryViewer[] | null>(null);
  /** The reply box has the keyboard, the share sheet is up, or the "⋯" menu (or what it opened) is: the story waits. */
  const [typing, setTyping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** "Sent" over the reply row for a moment after a reply goes. */
  const [sentAt, setSentAt] = useState(0);
  /** Hearts changed here, by story id: the groups the viewer was handed are a snapshot. */
  const [likedNow, setLikedNow] = useState<Record<string, boolean>>({});
  const input = useRef<TextInputInstance>(null);
  const progress = useSharedValue(0);
  const duration = storyDurationMs(story);
  const elapsedBefore = useRef(0);
  const mine = group.mine && group.author.id === me;
  const author = group.author;
  const firstName = author.full_name.trim().split(/\s+/)[0] || author.full_name;
  const muted = useStoryMuted(mine ? null : author.id);
  const liked = likedNow[story.id] ?? story.liked;
  // The story whose picture can be seen: its photo loaded (or failed, so the viewer moves on), its video ready and not
  // buffering. The clock runs only for it; the video is asked to play as soon as the page is on screen.
  const [shown, setShown] = useState<string | null>(null);
  const ready = shown === story.id;
  const wanted = active && !held && viewers === null && !typing && !sharing && !menuOpen;
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

  // A page swiped away gives up the keyboard: the next person's story plays.
  useEffect(() => {
    if (!active) input.current?.blur();
  }, [active]);
  useEffect(() => {
    if (!sentAt) return;
    const t = setTimeout(() => setSentAt(0), 1600);
    return () => clearTimeout(t);
  }, [sentAt]);

  // The reply row sits on the keyboard while it is up, and just above the home indicator otherwise.
  const replyRowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.value - insets.bottom) }] }));
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  /** The heart: shows at once, goes back if the server says no (the story expired, a block). */
  async function toggleLike() {
    if (!me || mine) return;
    const next = !liked;
    const id = story.id;
    // Felt before anything else happens, TikTok's way: then the heart, then the server.
    if (next) hapticLike();
    else hapticTap();
    if (next) heartScale.value = withSequence(withTiming(1.3, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 }));
    setLikedNow((m) => ({ ...m, [id]: next }));
    noteStoryLiked(id, next);
    try {
      await (next ? likeStory(supabase, me, id) : unlikeStory(supabase, me, id));
    } catch (e) {
      setLikedNow((m) => ({ ...m, [id]: !next }));
      noteStoryLiked(id, !next);
      alertWithHaptic("error", next ? "Couldn't like this story" : "Couldn't unlike this story", errorText(e));
    }
  }

  /** "Send message": a reply in a chat with the author, carrying the story (the database checks it and sends the picture). */
  async function sendReply() {
    const text = draft.trim();
    if (!me || mine || !text || sending) return;
    setSending(true);
    try {
      const conversationId = await getOrCreateDirectConversation(supabase, author.id);
      await sendMessage(supabase, { conversationId, senderId: me, content: text, sharedPost: sharedPostFromStory(story, true) });
      hapticSuccess();
      setDraft("");
      setSentAt(Date.now());
      input.current?.blur();
    } catch (e) {
      alertWithHaptic("error", "Couldn't send your reply", errorText(e));
    } finally {
      setSending(false);
    }
  }

  /** The paper plane: the story as a card to friends; the database refuses anyone who may not see it. */
  function share() {
    if (!me) return;
    hapticTap();
    setSharing(true);
    shareSheet.open(sharedPostFromStory(story), { restricted: story.audience !== "global", noun: "story", onClosed: () => setSharing(false) });
  }

  function report() {
    if (!me) return setMenuOpen(false);
    const storyId = story.id;
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: () => {
          reportContent(supabase, me, { targetType: "story", targetId: storyId, reason: r.value })
            .then(() => Alert.alert("Thanks for letting us know", "Our team will review this story.", [{ text: "OK", onPress: () => setMenuOpen(false) }], { onDismiss: () => setMenuOpen(false) }))
            .catch((e) => {
              setMenuOpen(false);
              alertWithHaptic("error", "Couldn't send the report", errorText(e));
            });
        },
      })),
      "Why are you reporting this story?",
      () => setMenuOpen(false),
    );
  }

  async function toggleMute() {
    setMenuOpen(false);
    if (!me) return;
    try {
      await setStoryMuted(me, author.id, !muted);
      hapticSuccess();
      // Muted: their stories leave the tray, and the viewer moves on to the next person.
      if (!muted) onDone();
    } catch (e) {
      alertWithHaptic("error", muted ? "Couldn't unmute" : "Couldn't mute", errorText(e));
    }
  }

  function block() {
    if (!me) return setMenuOpen(false);
    const blocker = me;
    alertWithHaptic("warning", `Block ${author.full_name}?`, "They won't be able to message you, and you won't see each other's posts or stories.", [
      { text: "Cancel", style: "cancel", onPress: () => setMenuOpen(false) },
      {
        text: "Block",
        style: "destructive",
        onPress: () =>
          void blockUser(supabase, blocker, author.id).then(
            () => {
              noteStoryAuthorBlocked(author.id);
              setMenuOpen(false);
              onDone();
            },
            (e) => {
              setMenuOpen(false);
              Alert.alert("Couldn't block", errorText(e));
            },
          ),
      },
    ]);
  }

  /** "⋯" on someone else's story: Report, Mute or unmute their stories, Block. The story waits while it is open. */
  function more() {
    if (!me) return;
    hapticTap();
    input.current?.blur();
    setMenuOpen(true);
    show(
      [
        { label: "Report…", icon: "flag-outline", destructive: true, onPress: report },
        { label: muted ? `Unmute ${firstName}'s stories` : `Mute ${firstName}'s stories`, icon: muted ? "volume-high-outline" : "volume-mute-outline", onPress: () => void toggleMute() },
        { label: `Block ${author.full_name}`, icon: "ban-outline", destructive: true, onPress: block },
      ],
      undefined,
      () => setMenuOpen(false),
    );
  }

  /** While the reply box has the keyboard, a tap on the story puts the keyboard away instead of moving on. */
  const onTapBack = () => (typing ? Keyboard.dismiss() : retreat());
  const onTapNext = () => (typing ? Keyboard.dismiss() : advance());

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
        <Pressable style={styles.leftZone} onPress={onTapBack} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Previous story" />
        <Pressable style={styles.rightZone} onPress={onTapNext} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} accessibilityRole="button" accessibilityLabel="Next story" />
      </View>
      {/* Typing a reply dims the story, as Instagram does. */}
      {typing ? <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} pointerEvents="none" style={styles.typingShade} /> : null}

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
          {!mine && me ? <GlassIconButton icon="ellipsis-horizontal" label="More" onPress={more} variant="media" size={36} iconSize={18} haptic={false} /> : null}
          <GlassIconButton icon="close" label="Close" onPress={onClose} variant="media" size={36} iconSize={18} haptic={false} />
        </View>
      </View>

      {mine ? (
        <>
          <Pressable
            onPress={() => void openViewers()}
            style={({ pressed }) => [styles.views, { bottom: insets.bottom + 18 }, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`${story.views} ${story.views === 1 ? "view" : "views"}${story.likes > 0 ? `, ${story.likes} ${story.likes === 1 ? "like" : "likes"}` : ""}`}
            accessibilityHint="Shows who has seen it"
          >
            <Icon name="eye-outline" size={18} color="#fff" />
            <Text style={styles.viewsText}>{story.views}</Text>
            {story.likes > 0 ? (
              <>
                <Icon name="heart" size={16} color={LIKE_RED} />
                <Text style={styles.viewsText}>{story.likes}</Text>
              </>
            ) : null}
          </Pressable>
          <Pressable onPress={share} hitSlop={8} style={({ pressed }) => [styles.ownShare, { bottom: insets.bottom + 18 }, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Send your story to friends">
            <Icon name="paper-plane-outline" size={24} color="#fff" style={styles.iconShadow} />
          </Pressable>
        </>
      ) : me ? (
        <Animated.View pointerEvents="box-none" style={[styles.replyRow, { bottom: insets.bottom + 10 }, replyRowStyle]}>
          {sentAt ? (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(200)} pointerEvents="none" style={styles.sent}>
              <Icon name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.sentText}>Sent</Text>
            </Animated.View>
          ) : null}
          <View style={styles.replyField}>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={setDraft}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder="Send message"
              placeholderTextColor="rgba(255,255,255,0.85)"
              keyboardAppearance="dark"
              returnKeyType="send"
              onSubmitEditing={() => void sendReply()}
              submitBehavior="submit"
              maxLength={1000}
              editable={!sending}
              accessibilityLabel={`Reply to ${firstName}`}
              style={styles.replyInput}
            />
          </View>
          {typing || draft.trim() ? (
            <Pressable onPress={() => void sendReply()} disabled={!draft.trim() || sending} hitSlop={8} accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !draft.trim() || sending }} style={({ pressed }) => [styles.sendButton, (!draft.trim() || pressed) && { opacity: 0.5 }]}>
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
            </Pressable>
          ) : (
            <>
              <Pressable onPress={() => void toggleLike()} hitSlop={8} accessibilityRole="button" accessibilityLabel={liked ? "Unlike" : "Like"} accessibilityState={{ selected: liked }} style={styles.rowButton}>
                <Animated.View style={heartStyle}>
                  <Icon name={liked ? "heart" : "heart-outline"} size={28} color={liked ? LIKE_RED : "#fff"} style={styles.iconShadow} />
                </Animated.View>
              </Pressable>
              <Pressable onPress={share} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share story" style={({ pressed }) => [styles.rowButton, pressed && { opacity: 0.6 }]}>
                <Icon name="paper-plane-outline" size={26} color="#fff" style={styles.iconShadow} />
              </Pressable>
            </>
          )}
        </Animated.View>
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
              <View style={styles.viewerRow} accessible accessibilityLabel={`${item.viewer.full_name}${item.liked ? ", liked it" : ""}, ${formatMessageTime(item.at)}`}>
                <Avatar name={item.viewer.full_name} url={item.viewer.avatar_url} size={40} online={false} />
                <Text style={styles.viewerName} numberOfLines={1}>
                  {item.viewer.full_name}
                </Text>
                {item.liked ? <Icon name="heart" size={16} color={LIKE_RED} /> : null}
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
/** Instagram's like red: the heart reads the same over any picture. */
const LIKE_RED = "#ff3040";

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
  ownShare: { position: "absolute", right: 18, height: 36, justifyContent: "center" },
  iconShadow: shadow,
  typingShade: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  // Instagram's row: a clear pill with a white hairline, then the heart and the paper plane.
  replyRow: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 14 },
  replyField: { flex: 1, minHeight: 46, justifyContent: "center", paddingHorizontal: 18, borderRadius: 23, borderWidth: 1, borderColor: "rgba(255,255,255,0.7)", backgroundColor: "rgba(0,0,0,0.12)" },
  replyInput: { color: "#fff", fontSize: 15, paddingVertical: 11 },
  rowButton: { width: 34, height: 46, alignItems: "center", justifyContent: "center" },
  sendButton: { height: 46, minWidth: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  sendText: { color: "#fff", fontSize: 16, fontWeight: "700", ...shadow },
  sent: { position: "absolute", left: 0, right: 0, bottom: 58, flexDirection: "row", alignSelf: "center", justifyContent: "center", alignItems: "center", gap: 6 },
  sentText: { color: "#fff", fontSize: 14, fontWeight: "700", ...shadow },
  viewsText: { color: "#fff", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  noViews: { textAlign: "center", paddingVertical: 32, fontSize: 15, color: "#8e8e93" },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerTime: { fontSize: 13, color: "#8e8e93" },
});
