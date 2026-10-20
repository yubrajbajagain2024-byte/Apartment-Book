import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SNAP_LIFETIME_DAYS, closeSnap, openSnap, shortAge, snapErrorState, snapMediaUrl, type OpenedSnap } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { GlassIconButton } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { errorText } from "@/lib/hooks";
import { emitSnapChange } from "@/lib/snap-events";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "@/lib/supabase";
import { motion } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The file, from Storage's signed-in download: the viewer's own session goes with every request. */
type MediaSource = { uri: string; headers: Record<string, string> };

type Phase =
  | { phase: "opening" }
  | { phase: "ready"; snap: OpenedSnap; source: MediaSource }
  | { phase: "error"; icon: IconName; title: string; body: string; retry: boolean };

/** What the viewer says when a Snap cannot be shown, from the database's refusal (or anything else). */
function errorPhase(e: unknown): Phase & { phase: "error" } {
  switch (snapErrorState(errorText(e, ""))) {
    case "expired":
      return { phase: "error", icon: "hourglass-outline", title: "This Snap expired", body: `Snaps that aren't opened within ${SNAP_LIFETIME_DAYS} days are deleted for good.`, retry: false };
    case "opened":
      return { phase: "error", icon: "eye-off-outline", title: "You already opened this Snap", body: "A Snap can be viewed once. After that it's gone.", retry: false };
    case "unavailable":
      return { phase: "error", icon: "alert-circle-outline", title: "This Snap isn't available", body: "It may have been deleted, or one of you blocked the other.", retry: false };
    default:
      return { phase: "error", icon: "cloud-offline-outline", title: "Couldn't open this Snap", body: errorText(e, "Check your connection and try again."), retry: true };
  }
}

/**
 * Viewing a Snap: once. Opening this screen opens the Snap (both chats mark it opened) and loads its file with your own
 * session, every request checked against the view, so nothing can be loaded once it ends; the picture is kept in
 * memory, never on disk. A photo stays until
 * you tap, swipe it down or press close; a video plays through once with a thin bar along the top and closes itself.
 * Leaving the app closes it too. Closed, it is gone for good: the server refuses it from then on, and deletes the file
 * once everyone it went to has seen it.
 */
export default function SnapViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapId = typeof id === "string" ? id : "";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  const [phase, setPhase] = useState<Phase>({ phase: "opening" });
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** Set once it is closing: from then on the viewer takes no touches, even while it fades. */
  const [gone, setGone] = useState(false);
  const opened = useRef<OpenedSnap | null>(null);
  const closing = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 0 to 1 as the viewer fades in (and back to 0 as it leaves). */
  const shown = useSharedValue(0);
  /** How far the Snap has been pulled down. */
  const drag = useSharedValue(0);
  /** A video's playback, 0 to 1, for the bar along the top. */
  const progress = useSharedValue(0);
  /** The "Tap to close" hint, gone after a moment. */
  const hint = useSharedValue(0);

  const finish = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, [router]);

  /**
   * Ends the view (the file is out of reach from now on) and fades away. The screen goes on a timer, not when the fade
   * reports it ended: a fade cut short must never leave an invisible viewer taking the touches.
   */
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setGone(true);
    const snap = opened.current;
    if (snap) void closeSnap(supabase, snap.id).catch(() => {});
    if (reduceMotion) {
      finish();
      return;
    }
    shown.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
    leaveTimer.current = setTimeout(finish, 210);
  }, [finish, reduceMotion, shown]);

  useEffect(() => {
    shown.value = reduceMotion ? 1 : withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open it (the one view), then load its file with this session.
  useEffect(() => {
    let stale = false;
    setPhase({ phase: "opening" });
    (async () => {
      try {
        if (!snapId) throw new Error("This Snap isn't available");
        const snap = await openSnap(supabase, snapId);
        opened.current = snap;
        emitSnapChange({ snapId, patch: { opened_at: snap.openedAt } });
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Log in again to view Snaps.");
        const source: MediaSource = { uri: snapMediaUrl(SUPABASE_URL, snap.path), headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } };
        if (!stale) setPhase({ phase: "ready", snap, source });
      } catch (e) {
        if (stale) return;
        const next = errorPhase(e);
        // The chat behind says the same at once.
        const state = snapErrorState(errorText(e, ""));
        if (state === "expired") emitSnapChange({ snapId, patch: { expires_at: new Date().toISOString(), gone: true } });
        else if (state === "opened") emitSnapChange({ snapId, patch: { opened_at: new Date().toISOString() } });
        else if (state === "unavailable") emitSnapChange({ snapId, patch: { gone: true } });
        setPhase(next);
      }
    })();
    return () => {
      stale = true;
    };
  }, [snapId, attempt]);

  // Leaving the app ends the view, as closing it does.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && opened.current) close();
    });
    return () => sub.remove();
  }, [close]);

  // Gone some other way (the screen was dismissed from outside): the view still ends.
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      const snap = opened.current;
      if (snap && !closing.current) void closeSnap(supabase, snap.id).catch(() => {});
    },
    [],
  );

  // The hint shows once the Snap is on screen, then fades.
  useEffect(() => {
    if (!loaded) return;
    hint.value = reduceMotion ? 0 : withTiming(1, { duration: 200 }, () => {
      hint.value = withDelay(2200, withTiming(0, { duration: 400 }));
    });
  }, [loaded, reduceMotion, hint]);

  // Pull down to close; a tap closes too. Only once the Snap is on screen (or could not be shown): a tap while it
  // loads must not use up its one view unseen. The close button always works.
  const interactive = loaded || phase.phase === "error";
  const pan = Gesture.Pan()
    .enabled(interactive)
    .activeOffsetY(12)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > 140 || e.velocityY > 900) runOnJS(close)();
      else drag.value = withSpring(0, motion.spring);
    });
  const tap = Gesture.Tap()
    .enabled(interactive)
    .onEnd(() => {
      runOnJS(close)();
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.value * (1 - Math.min(drag.value / 700, 0.55)) }));
  const stage = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: drag.value }, { scale: (0.97 + shown.value * 0.03) * (1 - Math.min(drag.value / 2400, 0.12)) }],
  }));
  const chrome = useAnimatedStyle(() => ({ opacity: shown.value * (1 - Math.min(drag.value / 120, 1)) }));
  const bar = useAnimatedStyle(() => ({ width: `${Math.round(progress.value * 1000) / 10}%` }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));

  const snap = phase.phase === "ready" ? phase.snap : null;

  return (
    <GestureHandlerRootView style={styles.fill} pointerEvents={gone ? "none" : "auto"}>
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]}>
        {phase.phase === "ready" && phase.snap.kind === "image" ? (
          <>
            <Image source={phase.source} cachePolicy="memory" style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={0} />
            <View style={[StyleSheet.absoluteFill, styles.dim]} />
          </>
        ) : null}
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <Animated.View style={[StyleSheet.absoluteFill, stage]} accessibilityLabel={snap ? `Snap from ${snap.sender.full_name}` : "Snap"} accessibilityHint="Tap to close. It disappears after you view it.">
          {phase.phase === "ready" ? (
            phase.snap.kind === "image" ? (
              <Image
                source={phase.source}
                cachePolicy="memory"
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={150}
                onLoad={() => setLoaded(true)}
                onError={() => setPhase({ phase: "error", icon: "cloud-offline-outline", title: "Couldn't load this Snap", body: "Check your connection and try again.", retry: true })}
              />
            ) : (
              <SnapVideo
                source={phase.source}
                duration={phase.snap.duration}
                progress={progress}
                onReady={() => setLoaded(true)}
                onEnd={close}
                onError={() => setPhase({ phase: "error", icon: "cloud-offline-outline", title: "Couldn't play this Snap", body: "Check your connection and try again.", retry: true })}
              />
            )
          ) : null}
        </Animated.View>
      </GestureDetector>

      {phase.phase !== "error" && !loaded ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.onMedia} size="large" />
        </View>
      ) : null}

      {phase.phase === "error" ? (
        <View style={styles.center}>
          <View style={styles.errorCard}>
            <Icon name={phase.icon} size={40} color={colors.onMedia} />
            <Text style={styles.errorTitle}>{phase.title}</Text>
            <Text style={styles.errorBody}>{phase.body}</Text>
            <View style={styles.errorActions}>
              {phase.retry ? (
                <Pressable
                  onPress={() => {
                    setLoaded(false);
                    setAttempt((n) => n + 1);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  style={({ pressed }) => [styles.errorButton, styles.errorPrimary, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.errorPrimaryText}>Try again</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [styles.errorButton, pressed && { opacity: 0.8 }]}>
                <Text style={styles.errorButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <Animated.View style={[styles.top, { paddingTop: insets.top + 6 }, chrome]} pointerEvents="box-none">
        {snap?.kind === "video" ? (
          <View style={styles.track}>
            <Animated.View style={[styles.fillBar, bar]} />
          </View>
        ) : null}
        <View style={styles.header} pointerEvents="box-none">
          {snap ? (
            <>
              <Avatar name={snap.sender.full_name} url={snap.sender.avatar_url} size={34} online={false} />
              <View style={styles.headerWords}>
                <Text style={styles.name} numberOfLines={1}>
                  {snap.sender.full_name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[shortAge(snap.sentAt), snap.kind === "video" ? "Video" : "Photo", "Opens once"].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.headerWords} />
          )}
          <GlassIconButton icon="close" label="Close Snap" onPress={close} variant="media" size={36} iconSize={17} haptic={false} hitSlop={10} />
        </View>
      </Animated.View>

      {snap?.kind === "image" ? (
        <Animated.Text style={[styles.hint, { bottom: insets.bottom + 18 }, hintStyle]} pointerEvents="none">
          Tap anywhere to close
        </Animated.Text>
      ) : null}
    </GestureHandlerRootView>
  );
}

/** A video Snap: plays once with sound, reports how far along it is, and says when it has ended (or could not play). */
function SnapVideo({
  source,
  duration,
  progress,
  onReady,
  onEnd,
  onError,
}: {
  source: MediaSource;
  duration: number | null;
  progress: SharedValue<number>;
  onReady: () => void;
  onEnd: () => void;
  onError: () => void;
}) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.muted = false;
    p.timeUpdateEventInterval = 0.05;
    p.play();
  });
  const handlers = useRef({ onReady, onEnd, onError });
  handlers.current = { onReady, onEnd, onError };
  useEffect(() => {
    const subscriptions = [
      player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") handlers.current.onReady();
        else if (status === "error") handlers.current.onError();
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        const total = player.duration || duration || 0;
        if (total > 0) progress.value = Math.min(1, currentTime / total);
      }),
      player.addListener("playToEnd", () => {
        progress.value = 1;
        handlers.current.onEnd();
      }),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, [player, duration, progress]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />;
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, backgroundColor: "transparent" },
  black: { backgroundColor: colors.mediaBg },
  dim: { backgroundColor: "rgba(0,0,0,0.55)" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 10 },
  track: { height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden", marginHorizontal: 2 },
  fillBar: { height: 3, borderRadius: 1.5, backgroundColor: colors.onMedia },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerWords: { flex: 1, gap: 1 },
  name: { fontSize: 15, fontWeight: "700", color: colors.onMedia, textShadowColor: colors.mediaTextShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  meta: { fontSize: 12, color: colors.onMediaMuted, textShadowColor: colors.mediaTextShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  hint: { position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 13, fontWeight: "600", color: colors.onMediaMuted, textShadowColor: colors.mediaTextShadow, textShadowRadius: 6 },
  errorCard: { alignItems: "center", gap: 10, maxWidth: 320 },
  errorTitle: { fontSize: 20, fontWeight: "700", color: colors.onMedia, textAlign: "center", marginTop: 6 },
  errorBody: { fontSize: 15, lineHeight: 21, color: colors.onMediaMuted, textAlign: "center" },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  errorButton: { minWidth: 110, height: 44, borderRadius: 22, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.mediaControl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.mediaControlEdge },
  errorPrimary: { backgroundColor: colors.onMedia },
  errorButtonText: { fontSize: 16, fontWeight: "600", color: colors.onMedia },
  errorPrimaryText: { fontSize: 16, fontWeight: "700", color: colors.mediaBg },
}));
