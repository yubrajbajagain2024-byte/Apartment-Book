import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useNavigation, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendSnap, type SnapRecipient } from "@apartment-book/shared";
import { GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { SnapSendSheet, type SnapSendStatus } from "@/components/snap/send-to-sheet";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { SnapPermissionError, captureSnap, startSnapUpload, type SnapShot, type SnapUpload } from "@/lib/snap-capture";
import { supabase } from "@/lib/supabase";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The round buttons over the Snap (close, take another, sound), and the gap around them. */
const BUTTON = 40;
const EDGE = 12;
/** The Send To button's height. */
const SEND_TO = 52;

/**
 * A Snap, from the + menu: the phone's own camera opens over whatever was on screen (this screen is see-through until
 * there is something to show). Close it without taking anything and you are back where you were. Take a photo or a
 * video and it fills the screen on black (a photo over a blurred copy of itself), with close and "take another" at the
 * top and the Aurora "Send To" at the bottom. Send To rises as a sheet with everyone it can go to; the file starts
 * uploading at that moment, and Send hands it over. Once it lands the sheet goes and so does the Snap.
 */
export default function SnapScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user, loading } = useSession();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const [shot, setShot] = useState<SnapShot | null>(null);
  const [muted, setMuted] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState<SnapSendStatus>("idle");
  const [progress, setProgress] = useState(0);
  /** Set once it is on its way out: from then on the screen takes no touches, even while it fades. */
  const [gone, setGone] = useState(false);

  const shotRef = useRef<SnapShot | null>(null);
  shotRef.current = shot;
  const statusRef = useRef(status);
  statusRef.current = status;
  const alive = useRef(true);
  const capturing = useRef(false);
  const leaving = useRef(false);
  const sent = useRef(false);
  const upload = useRef<{ shot: SnapShot; job: SnapUpload } | null>(null);
  const progressAt = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True from the moment Send To opens until it is fully gone; and who is waiting for that. */
  const sheetUp = useRef(false);
  const sheetGoneWaiters = useRef<(() => void)[]>([]);
  const userId = user?.id ?? null;

  /** 0 while nothing is shown (the camera is up), 1 once the Snap fills the screen. */
  const shown = useSharedValue(0);

  const go = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  /**
   * Away, fading the Snap out first if one is showing. An upload of something never sent is stopped. The screen goes on a
   * timer, not when the fade reports it ended: a fade cut short must never leave an invisible screen taking the touches.
   */
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setGone(true);
    if (!sent.current) upload.current?.job.cancel();
    if (!shotRef.current || reduceMotion) {
      go();
      return;
    }
    shown.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
    closeTimer.current = setTimeout(go, 190);
  }, [go, reduceMotion, shown]);

  const dropUpload = useCallback(() => {
    upload.current?.job.cancel();
    upload.current = null;
    setProgress(0);
  }, []);

  /**
   * The camera, now. Cancelled with nothing on screen: back. A new take replaces the one showing. It waits for Send To to
   * be fully gone: iOS presents nothing over a sheet that is still leaving, and the camera shown then would take this
   * screen down with it.
   */
  const take = useCallback(async () => {
    if (capturing.current) return;
    capturing.current = true;
    try {
      if (sheetUp.current) await new Promise<void>((resolve) => sheetGoneWaiters.current.push(resolve));
      if (!alive.current || leaving.current) return;
      const next = await captureSnap();
      if (!alive.current) return;
      if (!next) {
        if (!shotRef.current) leave();
        return;
      }
      dropUpload();
      setStatus("idle");
      setShot(next);
    } catch (e) {
      if (!alive.current) return;
      const nothingShown = !shotRef.current;
      if (e instanceof SnapPermissionError) {
        Alert.alert("Camera access is off", e.message, [
          { text: "Not now", style: "cancel", onPress: () => nothingShown && leave() },
          {
            text: "Open Settings",
            onPress: () => {
              void Linking.openSettings();
              if (nothingShown) leave();
            },
          },
        ]);
      } else {
        alertWithHaptic("error", "Couldn't take a Snap", errorText(e, "Please try again."));
        if (nothingShown) leave();
      }
    } finally {
      capturing.current = false;
    }
  }, [dropUpload, leave]);

  // Signed out there is nothing to send with: the login screen instead (or, signed out while a Snap shows, just away).
  useEffect(() => {
    if (loading || userId) return;
    if (shotRef.current) leave();
    else router.replace("/(auth)/login");
  }, [loading, userId, router, leave]);

  // The camera opens once this screen is up (presenting it during the screen's own presentation would be dropped).
  useEffect(() => {
    if (!userId) return;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void take();
    };
    const unsubscribe = (navigation as unknown as { addListener: (event: string, fn: () => void) => () => void }).addListener("transitionEnd", start);
    const fallback = setTimeout(start, 350);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
    // Once per visit: take() is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (sheetTimer.current) clearTimeout(sheetTimer.current);
      if (!sent.current) upload.current?.job.cancel();
    };
  }, []);

  // A new take fades in (and grows a touch) over the screen behind.
  useEffect(() => {
    if (!shot) return;
    shown.value = reduceMotion ? 1 : withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [shot, reduceMotion, shown]);

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.value }));
  const stage = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.94 + shown.value * 0.06 }] }));

  /** The upload for the Snap on screen: started the first time it is needed, again after one failed. */
  const ensureUpload = useCallback(
    (target: SnapShot): SnapUpload => {
      const current = upload.current;
      if (current && current.shot === target) return current.job;
      current?.job.cancel();
      setProgress(0);
      const job = startSnapUpload(userId as string, target, (fraction) => {
        const now = Date.now();
        if (fraction < 1 && now - progressAt.current < 120) return;
        progressAt.current = now;
        if (alive.current) setProgress(fraction);
      });
      // A failed upload is started over on the next try.
      job.done.catch(() => {
        if (upload.current?.job === job) upload.current = null;
      });
      upload.current = { shot: target, job };
      return job;
    },
    [userId],
  );

  function openSendTo() {
    const target = shotRef.current;
    if (!target || !userId) return;
    // Uploading starts now, so it has usually finished by the time someone is picked.
    ensureUpload(target);
    sheetUp.current = true;
    setSheetOpen(true);
  }

  async function send(people: SnapRecipient[]) {
    const target = shotRef.current;
    if (!target || !userId || statusRef.current !== "idle" || people.length === 0) return;
    setStatus("sending");
    try {
      const path = await ensureUpload(target).done;
      try {
        await sendSnap(supabase, {
          path,
          kind: target.kind,
          mime: target.mime,
          width: target.width,
          height: target.height,
          duration: target.duration,
          recipientIds: people.map((p) => p.id),
        });
      } catch (e) {
        // A retry after a reply that got lost: the first try went through.
        if (!/already sent/i.test(errorText(e, ""))) throw e;
      }
      if (!alive.current) return;
      sent.current = true;
      hapticSuccess();
      setStatus("sent");
      sheetTimer.current = setTimeout(() => setSheetOpen(false), 900);
    } catch (e) {
      if (!alive.current) return;
      setStatus("idle");
      alertWithHaptic("error", "Couldn't send your Snap", errorText(e, "Please try again."));
    }
  }

  // The Snap as large as it fits between the top inset and the bottom bar, at its own shape; the buttons float over it.
  const bottomBar = insets.bottom + EDGE + SEND_TO + EDGE;
  const room = { width: screenWidth - 16, height: screenHeight - insets.top - bottomBar - 8 };
  const aspect = shot?.width && shot?.height ? shot.width / shot.height : 9 / 16;
  let boxWidth = room.width;
  let boxHeight = boxWidth / aspect;
  if (boxHeight > room.height) {
    boxHeight = room.height;
    boxWidth = boxHeight * aspect;
  }
  const box = {
    width: Math.round(boxWidth),
    height: Math.round(boxHeight),
    left: Math.round((screenWidth - boxWidth) / 2),
    top: Math.round(insets.top + (room.height - boxHeight) / 2),
  };

  return (
    <View style={styles.fill} pointerEvents={shot && !gone ? "auto" : "none"}>
      {shot ? <StatusBar style="light" /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, styles.black, backdrop]}>
        {shot?.kind === "image" ? (
          <>
            <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={0} />
            <View style={[StyleSheet.absoluteFill, styles.dim]} />
          </>
        ) : null}
      </Animated.View>
      {shot ? (
        <Animated.View style={[styles.box, box, stage]}>
          {shot.kind === "image" ? (
            <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} accessibilityLabel="Your Snap" />
          ) : (
            <PreviewVideo key={shot.uri} uri={shot.uri} muted={muted} />
          )}
        </Animated.View>
      ) : null}
      {shot ? (
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]} pointerEvents="box-none">
          <View style={[styles.topRow, { top: insets.top + 8 }]} pointerEvents="box-none">
            <GlassIconButton icon="close" label="Discard Snap" onPress={leave} variant="media" size={BUTTON} iconSize={19} haptic={false} hitSlop={8} />
            <GlassIconButton icon="camera-outline" sf="arrow.triangle.2.circlepath.camera" label="Take another" onPress={() => void take()} variant="media" size={BUTTON} iconSize={19} haptic="tap" hitSlop={8} />
          </View>
          <View style={[styles.bottomRow, { bottom: insets.bottom + EDGE }]} pointerEvents="box-none">
            {shot.kind === "video" ? (
              <GlassIconButton icon={muted ? "volume-mute" : "volume-high"} label={muted ? "Sound off" : "Sound on"} onPress={() => setMuted((m) => !m)} variant="media" size={BUTTON} iconSize={18} haptic="select" />
            ) : (
              <View />
            )}
            <SendToButton onPress={openSendTo} gradient={auroraGradient(colors.aurora, 120)} />
          </View>
        </Animated.View>
      ) : null}
      <SnapSendSheet
        visible={sheetOpen}
        onClose={() => {
          if (statusRef.current !== "sending") setSheetOpen(false);
        }}
        onDismiss={() => {
          sheetUp.current = false;
          const waiting = sheetGoneWaiters.current;
          sheetGoneWaiters.current = [];
          waiting.forEach((resolve) => resolve());
          if (sent.current) leave();
        }}
        onSend={(people) => void send(people)}
        status={status}
        progress={progress}
      />
    </View>
  );
}

/** A video Snap before it is sent: playing on a loop, sound on unless switched off. */
function PreviewVideo({ uri, muted }: { uri: string; muted: boolean }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = muted;
    p.play();
  });
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />;
}

/** "Send To", on the Aurora, sinking under the finger. */
function SendToButton({ onPress, gradient }: { onPress: () => void; gradient: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const press = usePressScale(0.96, 0.92);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel="Send To"
      accessibilityHint="Choose who gets this Snap"
      style={[styles.sendTo, { backgroundColor: colors.brand, experimental_backgroundImage: gradient, opacity: press.opacity, transform: [{ scale: press.scale }] }]}
    >
      <Text style={styles.sendToText}>Send To</Text>
      <Icon name="send" size={17} color={colors.onBrand} />
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, backgroundColor: "transparent" },
  black: { backgroundColor: colors.mediaBg },
  dim: { backgroundColor: "rgba(0,0,0,0.5)" },
  box: { position: "absolute", borderRadius: 28, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.mediaBg },
  topRow: { position: "absolute", left: EDGE, right: EDGE, flexDirection: "row", justifyContent: "space-between" },
  bottomRow: { position: "absolute", left: EDGE + 4, right: EDGE, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sendTo: {
    height: SEND_TO,
    borderRadius: SEND_TO / 2,
    paddingLeft: 24,
    paddingRight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  sendToText: { color: colors.onBrand, fontSize: 17, fontWeight: "700" },
}));
