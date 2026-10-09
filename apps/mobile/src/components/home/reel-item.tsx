import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { deleteFeedPost, getOrCreateDirectConversation, likePost, muxPlaybackUrl, muxPosterUrl, reelPath, reportContent, REPORT_REASONS, toggleSaved, unlikePost, type Reel, type ReportReason } from "@apartment-book/shared";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";
import { useActionSheet } from "../action-sheet";
import { Avatar } from "../avatar";

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

  const key = reelKey(reel);
  const own = user?.id === reel.author.id;
  const isTour = reel.sourceType !== "post";
  const poster = reel.video.poster_url ?? muxPosterUrl(reel.video.playback_id);
  const login = () => router.push("/(auth)/login");

  // Scrolling away clears a manual pause and a stretched-out caption, so coming back starts fresh.
  useEffect(() => {
    if (!playing) {
      setUserPaused(false);
      setExpanded(false);
    }
  }, [playing]);

  async function toggleLike() {
    if (!user) return login();
    if (likeBusy) return;
    const next = !reel.likedByMe;
    const before = { likedByMe: reel.likedByMe, likes: reel.likes };
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

  function more() {
    show([
      ...(isTour ? [{ label: "View listing", icon: "open-outline" as const, onPress: openListing }] : []),
      ...(own && !isTour ? [{ label: "Delete reel", icon: "trash-outline" as const, destructive: true, onPress: confirmDelete }] : []),
      ...(own ? [] : [{ label: "Report", icon: "flag-outline" as const, destructive: true, onPress: report }]),
    ]);
  }

  return (
    <View style={{ width, height, backgroundColor: "#000" }}>
      {near ? <ReelVideo playbackId={reel.video.playback_id} poster={poster} playing={playing && !userPaused} muted={muted} /> : <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}

      <Pressable style={StyleSheet.absoluteFill} onPress={() => setUserPaused((p) => !p)} accessibilityRole="button" accessibilityLabel={userPaused ? "Play" : "Pause"}>
        {userPaused ? (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.playBadge}>
              <Ionicons name="play" size={44} color="rgba(255,255,255,0.9)" style={{ marginLeft: 5 }} />
            </View>
          </View>
        ) : null}
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
          {reel.title ? (
            <Text style={styles.title} numberOfLines={2}>
              {reel.title}
            </Text>
          ) : null}
          {reel.caption ? (
            <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" accessibilityLabel={expanded ? "Show less" : "Show more"}>
              <Text style={styles.caption} numberOfLines={expanded ? 12 : 2}>
                {reel.caption}
              </Text>
            </Pressable>
          ) : null}
          {isTour ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              <Pressable onPress={openListing} style={styles.pill} accessibilityRole="button" accessibilityLabel="View listing">
                <Ionicons name="videocam" size={14} color="#fff" />
                <Text style={styles.pillText}>Video tour · View listing</Text>
              </Pressable>
              {own ? null : (
                <Pressable onPress={() => void message()} style={[styles.pill, styles.pillSolid, messageBusy && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Message">
                  <Ionicons name="chatbubble-ellipses" size={14} color="#fff" />
                  <Text style={styles.pillText}>Message</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.rail}>
          <Pressable onPress={() => router.push({ pathname: "/profile/[id]", params: { id: reel.author.id } })} style={styles.avatarRing} accessibilityRole="link" accessibilityLabel={`${reel.author.name}'s profile`}>
            <Avatar name={reel.author.name} url={reel.author.avatarUrl} size="md" online={false} />
          </Pressable>
          <RailButton icon={reel.likedByMe ? "heart" : "heart-outline"} color={reel.likedByMe ? "#ff3b5c" : "#fff"} label={compact(reel.likes)} onPress={() => void toggleLike()} a11y={reel.likedByMe ? "Unlike" : "Like"} selected={reel.likedByMe} />
          <RailButton icon="chatbubble-ellipses" label={compact(reel.comments)} onPress={() => onOpenComments(reel)} a11y="Comments" />
          <RailButton icon={reel.savedByMe ? "bookmark" : "bookmark-outline"} color={reel.savedByMe ? colors.amber : "#fff"} label={reel.savedByMe ? "Saved" : "Save"} onPress={() => void toggleSave()} a11y={reel.savedByMe ? "Unsave" : "Save"} selected={reel.savedByMe} />
          <RailButton icon="arrow-redo" label="Share" onPress={share} a11y="Share" />
          <RailButton icon="ellipsis-horizontal" onPress={more} a11y="More options" small />
        </View>
      </View>
    </View>
  );
});

function RailButton({ icon, label, color = "#fff", onPress, a11y, selected, small }: { icon: keyof typeof Ionicons.glyphMap; label?: string; color?: string; onPress: () => void; a11y: string; selected?: boolean; small?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={selected === undefined ? undefined : { selected }}>
      <Ionicons name={icon} size={small ? 24 : 32} color={color} style={styles.iconShadow} />
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
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 260 },
  mute: { position: "absolute", right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", paddingLeft: 14, paddingRight: 8, paddingBottom: 18, gap: 10 },
  info: { flex: 1, gap: 6, paddingBottom: 2 },
  author: { color: "#fff", fontSize: 16, fontWeight: "800", flexShrink: 1, ...shadow },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", ...shadow },
  caption: { color: "#fff", fontSize: 14, lineHeight: 19, ...shadow },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  pillSolid: { backgroundColor: colors.brand },
  pillText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  rail: { width: 56, alignItems: "center", gap: 16 },
  avatarRing: { borderWidth: 2, borderColor: "#fff", borderRadius: 24, marginBottom: 2 },
  railButton: { alignItems: "center", gap: 2, minWidth: 48 },
  railLabel: { color: "#fff", fontSize: 12, fontWeight: "700", ...shadow },
  iconShadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
