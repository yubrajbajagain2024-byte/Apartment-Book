import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Animated, Easing, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { deleteFeedPost, getOrCreateDirectConversation, likePost, muxPlaybackUrl, muxPosterUrl, reelPath, reportContent, REPORT_REASONS, toggleSaved, unlikePost, type Reel, type ReportReason } from "@apartment-book/shared";
import { hapticLike } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { useActionSheet } from "../action-sheet";

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

/** No gradient library in the app, so the bottom shade is a stack of thin bands that get darker. */
const SHADE_STEPS = [0.03, 0.06, 0.1, 0.14, 0.18, 0.23, 0.28, 0.33, 0.38, 0.42];

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
  const muted = useReelsMuted();
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

  function share() {
    const url = `${SITE_URL}${reelPath(reel)}`;
    const label = reel.title ?? (reel.caption ? reel.caption.slice(0, 80) : `${reel.author.name} on Apartment Book`);
    void Share.share({ message: `${label} · ${url}`, url }).catch(() => {});
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

  // The overlay is name and caption only (like TikTok), so the listing and the chat live behind "…".
  function more() {
    show([
      ...(isTour ? [{ label: "View listing", icon: "open-outline" as const, onPress: openListing }] : []),
      ...(own ? [] : [{ label: `Message ${reel.author.name.split(" ")[0]}`, icon: "chatbubble-ellipses-outline" as const, onPress: () => void message() }]),
      ...(own && !isTour ? [{ label: "Delete reel", icon: "trash-outline" as const, destructive: true, onPress: confirmDelete }] : []),
      ...(own ? [] : [{ label: "Report", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {near ? <ReelVideo playbackId={reel.video.playback_id} poster={poster} playing={playing && !userPaused} muted={muted} /> : <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}

      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoTap} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"}>
        {userPaused ? (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.playBadge}>
              <Ionicons name="play" size={44} color="rgba(255,255,255,0.9)" style={{ marginLeft: 5 }} />
            </View>
          </View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.center, styles.bigHeart, { opacity: bigHeart, transform: [{ scale: bigHeart.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
          <Ionicons name="heart" size={110} color="#fff" />
        </Animated.View>
      </Pressable>

      {/* Soft shade so white text stays readable over bright video. */}
      <View pointerEvents="none" style={styles.shade}>
        {SHADE_STEPS.map((opacity) => (
          <View key={opacity} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${opacity})` }} />
        ))}
      </View>

      <Pressable onPress={() => setReelsMuted(!muted)} hitSlop={8} style={[styles.mute, { top: topInset + 10 }]} accessibilityRole="button" accessibilityLabel={muted ? "Turn sound on" : "Turn sound off"}>
        <Ionicons name={muted ? "volume-mute" : "volume-high"} size={18} color="#fff" />
      </Pressable>

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.info} pointerEvents="box-none">
          <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: reel.author.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" }} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
            <Text style={styles.author} numberOfLines={1}>
              {reel.author.name}
            </Text>
            {reel.author.verified ? <Ionicons name="checkmark-circle" size={15} color="#4da3ff" accessibilityLabel="Verified student" /> : null}
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
          <RailButton icon={reel.likedByMe ? "heart" : "heart-outline"} color={reel.likedByMe ? "#ff3b5c" : "#fff"} label={compact(reel.likes)} onPress={() => void toggleLike()} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} scale={pop} />
          <RailButton icon="chatbubble-ellipses-outline" label={compact(reel.comments)} onPress={() => onOpenComments(reel)} a11y="Comments" />
          <RailButton icon="paper-plane-outline" label="Share" onPress={share} a11y="Share" />
          <RailButton icon={reel.savedByMe ? "bookmark" : "bookmark-outline"} color={reel.savedByMe ? colors.amber : "#fff"} label={reel.savedByMe ? "Saved" : "Save"} onPress={() => void toggleSave()} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} />
          <RailButton icon="ellipsis-horizontal" onPress={more} a11y="More options" small />
        </View>
      </View>
    </View>
  );
});

function RailButton({ icon, label, color = "#fff", onPress, a11y, selected, small, scale }: { icon: keyof typeof Ionicons.glyphMap; label?: string; color?: string; onPress: () => void; a11y: string; selected?: boolean; small?: boolean; scale?: Animated.Value }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={selected === undefined ? undefined : { selected }}>
      <Animated.View style={scale ? { transform: [{ scale }] } : undefined}>
        <Ionicons name={icon} size={small ? 30 : 34} color={color} style={styles.iconShadow} />
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

const shadow = { textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;

const styles = StyleSheet.create({
  center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  playBadge: { width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  bigHeart: { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 3 } },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 260 },
  mute: { position: "absolute", right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  // Instagram's geometry on an iPhone: the "…" centre 46pt above the tab bar, then save, share, comment and like every 73pt or so; the caption line level with "…".
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, paddingBottom: 31, gap: 10 },
  info: { flex: 1, gap: 6, paddingBottom: 2 },
  author: { color: "#fff", fontSize: 16, fontWeight: "800", flexShrink: 1, ...shadow },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", ...shadow },
  caption: { color: "#fff", fontSize: 14, lineHeight: 19, ...shadow },
  more: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "700", ...shadow },
  rail: { width: 60, alignItems: "center", gap: 21 },
  railButton: { alignItems: "center", gap: 3, minWidth: 48 },
  railLabel: { color: "#fff", fontSize: 12, fontWeight: "700", ...shadow },
  iconShadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
