import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { deleteFeedPost, getFeedPost, getOrCreateDirectConversation, likePost, muxPlaybackUrl, muxPosterUrl, reelPath, reportContent, REPORT_REASONS, setPostPinned, sharedPostFromReel, toggleSaved, unlikePost, type Reel, type ReportReason } from "@apartment-book/shared";
import { hapticLike, hapticSelect, hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { emitPostPinned, onPostPinned } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "../action-sheet";
import { useShareSheet } from "../share-sheet";

/** Sound is one switch for the whole Reels feed (starts muted, like every other feed video in the app). */
let reelsMuted = true;
const muteListeners = new Set<() => void>();
function setReelsMuted(next: boolean) {
  reelsMuted = next;
  muteListeners.forEach((l) => l());
}
function subscribeMuted(listener: () => void) {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}
function useReelsMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, () => reelsMuted, () => reelsMuted);
}

/**
 * No gradient library in the app, so the bottom shade is a stack of thin bands that get darker. Each band is
 * colors.mediaScrim at a growing share of its strength (the band's opacity), so the bottom one is nearly the full scrim.
 */
const SHADE_STEPS = [0.07, 0.13, 0.22, 0.31, 0.4, 0.51, 0.62, 0.73, 0.84, 0.93];

/** How long "…" waits for your reel's pin state when the read-ahead has not answered yet. */
const PIN_READ_WAIT_MS = 1200;

export const reelKey = (reel: Pick<Reel, "sourceType" | "sourceId">) => `${reel.sourceType}:${reel.sourceId}`;

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

type Props = {
  reel: Reel;
  width: number;
  height: number;
  topInset: number;
  /** Within one of the visible reel: worth mounting a player so it is ready to go. */
  near: boolean;
  /** This is the visible reel and the Reels section is on screen. */
  playing: boolean;
  onPatch: (key: string, patch: Partial<Reel>) => void;
  onOpenComments: (reel: Reel) => void;
  onRemoved: (key: string) => void;
};

export const ReelItem = memo(function ReelItem({ reel, width, height, topInset, near, playing, onPatch, onOpenComments, onRemoved }: Props) {
  const { user } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const muted = useReelsMuted();
  const colors = useColors();
  const styles = useStyles();
  const [userPaused, setUserPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  /** The rail heart's pop (scale) and the big heart a double tap flashes over the video, like Instagram. */
  const pop = useRef(new Animated.Value(1)).current;
  const bigHeart = useRef(new Animated.Value(0)).current;
  const popAnim = useRef<Animated.CompositeAnimation | null>(null);
  const burstAnim = useRef<Animated.CompositeAnimation | null>(null);
  /** Single tap pauses, double tap likes: the pause waits a beat to see whether a second tap follows. */
  const lastTap = useRef(0);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pendingTap.current && clearTimeout(pendingTap.current)), []);

  const key = reelKey(reel);
  const own = user?.id === reel.author.id;
  const isTour = reel.sourceType !== "post";
  /** Collapsed, the description is one line like Instagram's. Whether it was cut is measured, not guessed (see onTextLayout). */
  const oneLine = [reel.title, reel.caption].filter(Boolean).join(" · ");
  const [clipped, setClipped] = useState(false);
  const canExpand = clipped || oneLine.includes("\n");
  const poster = reel.video.poster_url ?? muxPosterUrl(reel.video.playback_id);
  const login = () => router.push("/(auth)/login");
  /** Your own posted reel: pinned to your profile or not. A Reel does not carry it, so it is read once the reel is on screen (null until then). */
  const [pinned, setPinned] = useState<boolean | null>(null);
  const readingPin = useRef(false);
  // Read ahead, while your reel plays, so "…" opens at once and always acts on the reel you are looking at.
  useEffect(() => {
    if (!playing || !own || isTour || pinned !== null) return;
    let alive = true;
    getFeedPost(supabase, reel.sourceId).then(
      (post) => {
        if (alive && post) setPinned(Boolean(post.pinned_at));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [playing, own, isTour, pinned, reel.sourceId]);
  // Pinned or unpinned elsewhere (the profile grid, the post screen) while this reel is mounted.
  useEffect(() => {
    if (isTour) return;
    return onPostPinned((id, next) => {
      if (id === reel.sourceId) setPinned(next);
    });
  }, [isTour, reel.sourceId]);

  // Scrolling away clears a manual pause and a stretched-out caption, so coming back starts fresh.
  useEffect(() => {
    if (!playing) {
      setUserPaused(false);
      setExpanded(false);
    }
  }, [playing]);

  /** The heart jumps when it fills and dips when it empties, so the tap is felt even before the count moves. */
  function animateHeart(liked: boolean) {
    popAnim.current?.stop();
    pop.setValue(1);
    // RN's default rest thresholds (0.001) keep a lively spring "settling" for a second or more; these end it once it looks still.
    const settle = { useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 } as const;
    popAnim.current = Animated.sequence(
      liked
        ? [Animated.timing(pop, { toValue: 1.35, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 5, tension: 180, ...settle })]
        : [Animated.timing(pop, { toValue: 0.82, duration: 90, useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 6, tension: 160, ...settle })],
    );
    popAnim.current.start();
  }

  /** About a second on screen; a second double tap restarts it instead of being cut short by the first run. */
  function burst() {
    burstAnim.current?.stop();
    bigHeart.setValue(0);
    burstAnim.current = Animated.sequence([
      Animated.spring(bigHeart, { toValue: 1, friction: 6, tension: 200, useNativeDriver: true, restDisplacementThreshold: 0.01, restSpeedThreshold: 2 }),
      Animated.delay(300),
      Animated.timing(bigHeart, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]);
    burstAnim.current.start();
  }

  async function toggleLike() {
    if (!user) return login();
    if (likeBusy) return;
    const next = !reel.likedByMe;
    const before = { likedByMe: reel.likedByMe, likes: reel.likes };
    animateHeart(next);
    if (next) hapticLike();
    setLikeBusy(true);
    onPatch(key, { likedByMe: next, likes: Math.max(0, reel.likes + (next ? 1 : -1)) });
    try {
      if (next) await likePost(supabase, user.id, reel.sourceType, reel.sourceId);
      else await unlikePost(supabase, user.id, reel.sourceType, reel.sourceId);
    } catch {
      onPatch(key, before);
    } finally {
      setLikeBusy(false);
    }
  }

  async function toggleSave() {
    if (!user) return login();
    // A selection tick as the bookmark fills (or empties), as everywhere else you save.
    hapticSelect();
    const before = reel.savedByMe;
    onPatch(key, { savedByMe: !before });
    try {
      onPatch(key, { savedByMe: await toggleSaved(supabase, user.id, reel.sourceType, reel.sourceId) });
    } catch {
      onPatch(key, { savedByMe: before });
    }
  }

  /** Double tap on the video: like (never unlike) with a big heart, like Instagram; a lone tap still pauses. */
  function onVideoTap() {
    const now = Date.now();
    if (pendingTap.current) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
    }
    if (now - lastTap.current < 260) {
      lastTap.current = 0;
      burst();
      if (!reel.likedByMe) void toggleLike();
      return;
    }
    lastTap.current = now;
    pendingTap.current = setTimeout(() => {
      pendingTap.current = null;
      setUserPaused((p) => !p);
    }, 260);
  }

  /** Instagram's share sheet: send the reel to friends as a chat card, or "Share to…" the link with the system sheet. */
  function share() {
    const url = `${SITE_URL}${reelPath(reel)}`;
    const label = reel.title ?? (reel.caption ? reel.caption.slice(0, 80) : `${reel.author.name} on Apartment Book`);
    shareSheet.open({ ...sharedPostFromReel(reel), image_url: poster }, { url, label });
  }

  async function message() {
    if (!user) return login();
    if (messageBusy) return;
    setMessageBusy(true);
    try {
      const conv = await getOrCreateDirectConversation(supabase, reel.author.id);
      router.push({ pathname: "/messages/[id]", params: { id: conv } });
    } catch (e) {
      Alert.alert("Message", e instanceof Error ? e.message : "Could not start the chat. Try again.");
    } finally {
      setMessageBusy(false);
    }
  }

  function openListing() {
    if (reel.sourceType === "apartment") router.push({ pathname: "/apartments/[id]", params: { id: reel.sourceId } });
    else if (reel.sourceType === "roommate") router.push({ pathname: "/roommates/[id]", params: { id: reel.sourceId } });
  }

  function report() {
    if (!user) return login();
    show(
      REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: async () => {
          await reportContent(supabase, user.id, { targetType: reel.sourceType, targetId: reel.sourceId, reason: r.value as ReportReason }).catch(() => {});
          Alert.alert("Thanks", "Our team will review this reel.");
        },
      })),
      "Why are you reporting this?",
    );
  }

  function confirmDelete() {
    Alert.alert("Delete this reel?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteFeedPost(supabase, reel.sourceId);
            onRemoved(key);
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  }

  /** Like a post's menu: pin your own reel to the top of your profile, or unpin it. The profile grids hear about it straight away. */
  async function togglePin(next: boolean) {
    setPinned(next);
    try {
      await setPostPinned(supabase, reel.sourceId, next);
      hapticTap();
      emitPostPinned(reel.sourceId, next);
    } catch (e) {
      setPinned(!next);
      Alert.alert(next ? "Could not pin" : "Could not unpin", errorText(e));
    }
  }

  // The overlay is name and caption only (like TikTok), so the listing and the chat live behind "…".
  async function more() {
    // Usually known already (read while the reel plays). If that read has not answered or failed, ask again, but hold
    // the menu for a moment at most: without an answer it opens without the Pin item, which the next tap will have.
    let pinNow = own && !isTour ? pinned : null;
    if (own && !isTour && pinNow === null) {
      if (readingPin.current) return;
      readingPin.current = true;
      const read = getFeedPost(supabase, reel.sourceId).then(
        (post) => (post ? Boolean(post.pinned_at) : null),
        () => null,
      );
      void read.then((value) => {
        if (value !== null) setPinned(value);
      });
      pinNow = await Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), PIN_READ_WAIT_MS))]);
      readingPin.current = false;
    }
    show([
      ...(isTour ? [{ label: "View listing", icon: "open-outline" as const, onPress: openListing }] : []),
      ...(own ? [] : [{ label: `Message ${reel.author.name.split(" ")[0]}`, icon: "chatbubble-ellipses-outline" as const, onPress: () => void message() }]),
      ...(pinNow !== null ? [{ label: pinNow ? "Unpin from profile" : "Pin to profile", icon: pinNow ? ("pin" as const) : ("pin-outline" as const), onPress: () => void togglePin(!pinNow) }] : []),
      ...(own && !isTour ? [{ label: "Delete reel", icon: "trash-outline" as const, destructive: true, onPress: confirmDelete }] : []),
      ...(own ? [] : [{ label: "Report", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={{ width, height, backgroundColor: colors.mediaBg }}>
      {near ? <ReelVideo playbackId={reel.video.playback_id} poster={poster} playing={playing && !userPaused} muted={muted} /> : <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}

      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoTap} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"}>
        {userPaused ? (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.playBadge}>
              <Ionicons name="play" size={44} color={colors.onMedia} style={{ marginLeft: 5 }} />
            </View>
          </View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.center, styles.bigHeart, { opacity: bigHeart, transform: [{ scale: bigHeart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
          <Ionicons name="heart" size={110} color={colors.onMedia} />
        </Animated.View>
      </Pressable>

      {/* Soft shade so white text stays readable over bright video. */}
      <View pointerEvents="none" style={styles.shade}>
        {SHADE_STEPS.map((opacity) => (
          <View key={opacity} style={{ flex: 1, backgroundColor: colors.mediaScrim, opacity }} />
        ))}
      </View>

      <Pressable onPress={() => setReelsMuted(!muted)} hitSlop={8} style={[styles.mute, { top: topInset + 10 }]} accessibilityRole="button" accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}>
        <Ionicons name={muted ? "volume-mute" : "volume-high"} size={18} color={colors.onMedia} />
      </Pressable>

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.info} pointerEvents="box-none">
          <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: reel.author.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
            <Text style={styles.author} numberOfLines={1}>
              {reel.author.name}
            </Text>
            {reel.author.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.verifiedOnMedia} accessibilityLabel="Verified student" /> : null}
          </Pressable>
          {/* Short by default, like TikTok: one line of title and one of caption, "… more" opens the rest. */}
          {oneLine ? (
            expanded ? (
              <View style={{ gap: 2 }}>
                {reel.title ? (
                  <Text style={styles.title} numberOfLines={3}>
                    {reel.title}
                  </Text>
                ) : null}
                {reel.caption ? (
                  <Text style={styles.caption} numberOfLines={10}>
                    {reel.caption}
                  </Text>
                ) : null}
                <Text onPress={() => setExpanded(false)} style={styles.more} accessibilityRole="button" accessibilityLabel="Show less">
                  less
                </Text>
              </View>
            ) : (
              /* One line with a tail "…", like Instagram; the line itself is the button, so VoiceOver reads the text and the hint. */
              <Text
                style={styles.caption}
                numberOfLines={1}
                onPress={canExpand ? () => setExpanded(true) : undefined}
                accessibilityRole={canExpand ? "button" : "text"}
                accessibilityHint={canExpand ? "Shows the full description" : undefined}
                // The first laid-out line carries less than the whole text when it was truncated.
                onTextLayout={(e) => {
                  const first = e.nativeEvent.lines[0]?.text ?? "";
                  setClipped(e.nativeEvent.lines.length > 1 || first.replace(/…$/, "").trim().length < oneLine.trim().length);
                }}
              >
                {oneLine}
              </Text>
            )
          ) : null}
        </View>

        <View style={styles.rail}>
          <RailButton icon={reel.likedByMe ? "heart" : "heart-outline"} color={reel.likedByMe ? colors.like : colors.onMedia} label={compact(reel.likes)} onPress={() => void toggleLike()} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} scale={pop} />
          <RailButton icon="chatbubble-ellipses-outline" label={compact(reel.comments)} onPress={() => onOpenComments(reel)} a11y="Comments" />
          <RailButton icon="paper-plane-outline" label="Share" onPress={share} a11y="Share" />
          <RailButton icon={reel.savedByMe ? "bookmark" : "bookmark-outline"} color={reel.savedByMe ? colors.amber : colors.onMedia} label={reel.savedByMe ? "Saved" : "Save"} onPress={() => void toggleSave()} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} />
          <RailButton icon="ellipsis-horizontal" onPress={() => void more()} a11y="More options" small />
        </View>
      </View>
    </View>
  );
});

function RailButton({ icon, label, color, onPress, a11y, selected, small, scale }: { icon: keyof typeof Ionicons.glyphMap; label?: string; color?: string; onPress: () => void; a11y: string; selected?: boolean; small?: boolean; scale?: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={selected === undefined ? undefined : { selected }}>
      <Animated.View style={scale ? { transform: [{ scale }] } : undefined}>
        <Ionicons name={icon} size={small ? 30 : 34} color={color ?? colors.onMedia} style={styles.iconShadow} />
      </Animated.View>
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
    </Pressable>
  );
}

/** Only mounted for reels next to the visible one, so at most three players exist at a time. */
function ReelVideo({ playbackId, poster, playing, muted }: { playbackId: string; poster: string; playing: boolean; muted: boolean }) {
  const player = useVideoPlayer({ uri: muxPlaybackUrl(playbackId) }, (p) => {
    p.loop = true;
    p.muted = reelsMuted;
  });
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} onFirstFrameRender={() => setHasFrame(true)} />
      {/* Poster stays on top until the first video frame is painted, so a reel is never a black box. */}
      {!hasFrame ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </View>
  );
}

/** Everything here sits over video, so it uses the media colours (light text, dark scrims) in both themes. */
const useStyles = makeStyles((colors) => {
  // Under the white name, caption and labels: darker than mediaScrim, so the text stays sharp on bright footage.
  const shadow = { textShadowColor: colors.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
  return {
    center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    playBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    bigHeart: { shadowColor: colors.shadow, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 3 } },
    shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 260 },
    mute: { position: "absolute", right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
    // Instagram's geometry on an iPhone: the "…" centre 46pt above the tab bar, then save, share, comment and like every 73pt or so; the caption line level with "…".
    overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, paddingBottom: 31, gap: 10 },
    info: { flex: 1, gap: 6, paddingBottom: 2 },
    author: { color: colors.onMedia, fontSize: 16, fontWeight: "800", flexShrink: 1, ...shadow },
    title: { color: colors.onMedia, fontSize: 15, fontWeight: "700", ...shadow },
    caption: { color: colors.onMedia, fontSize: 14, lineHeight: 19, ...shadow },
    more: { color: colors.onMediaMuted, fontSize: 13, fontWeight: "700", ...shadow },
    rail: { width: 60, alignItems: "center", gap: 21 },
    railButton: { alignItems: "center", gap: 3, minWidth: 48 },
    railLabel: { color: colors.onMedia, fontSize: 12, fontWeight: "700", ...shadow },
    iconShadow: { textShadowColor: colors.mediaScrim, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  };
});
