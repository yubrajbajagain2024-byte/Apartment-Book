import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType, type FlashMode, type PermissionResponse } from "expo-camera";
import * as Device from "expo-device";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import { Directions, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, FadeOut, ZoomIn, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "expo-symbols";
import { SNAP_LIMITS } from "@apartment-book/shared";
import { CaptureButton } from "@/components/compose/capture-button";
import { BuzzStage } from "@/components/compose/buzz-stage";
import { DraftsSheet } from "@/components/compose/drafts-sheet";
import { GallerySheet } from "@/components/compose/gallery-sheet";
import { ModeSwitcher } from "@/components/compose/mode-switcher";
import { GlassIconButton } from "@/components/glass";
import { Icon, useBounceOn, type IconName } from "@/components/icon";
import { Button } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { useDrafts, type Draft } from "@/lib/compose-drafts";
import { clock, photoFromCamera, videoFromCamera, videoStill } from "@/lib/compose-media";
import { REEL_MAX_SECONDS, compose, roomFor, useCompose, type ComposeMedia } from "@/lib/compose-store";
import { alertWithHaptic, hapticSoft } from "@/lib/haptics";
import { openHomeSection } from "@/lib/home-section";
import { useSession } from "@/lib/session";
import { prepareSnap } from "@/lib/snap-capture";
import { handOffSnap } from "@/lib/snap-handoff";
import { auroraGradient, motion } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";

/**
 * What the + makes: a post or a reel (the create flow's session), an anonymous Buzz thread (written right on the stage),
 * or a Snap (handed to the Snap screen).
 */
type CameraMode = "post" | "reel" | "buzz" | "snap";

const MODES: { value: CameraMode; label: string }[] = [
  { value: "post", label: "POST" },
  { value: "reel", label: "REEL" },
  { value: "snap", label: "SNAP" },
  { value: "buzz", label: "BUZZ" },
];
const CAPTURE: { value: "photo" | "video"; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
];
const REEL_LENGTHS: { value: "180" | "60" | "15"; label: string }[] = [
  { value: "180", label: "3m" },
  { value: "60", label: "60s" },
  { value: "15", label: "15s" },
];
/** A video in a post can run as long as a reel. */
const POST_VIDEO_MAX = REEL_MAX_SECONDS;
/** Shorter than this and a tap-tap is a slip, not a video. */
const MIN_SECONDS = 1;
const BAR = 64;
/** The Simulator has no camera: the preview stays dark there, and a photo comes out as a generated test picture. */
const SIMULATOR = Platform.OS === "ios" && !Device.isDevice;

/**
 * Create, TikTok's way: the + opens straight onto the live camera, full screen. The picture fills a rounded stage with
 * the camera's switches down its right edge (flip, flash, timer), the capture choices above the shutter, and below the
 * stage the library's newest picture (the in-app gallery), POST | REEL | SNAP | BUZZ, and the drafts. Tap the shutter
 * for a photo, or to start and stop a video; pinch to zoom, double-tap to flip, swipe sideways to change mode. A post's
 * or reel's shot goes to the editor at once; a Snap goes to Send To (app/snap). BUZZ turns the stage into an anonymous
 * text composer (components/compose/buzz-stage.tsx) while the camera pauses underneath; its X comes back to POST.
 * Minimal, as TikTok's: the switches are bare icons, and a change of flash, timer or lens is told in a passing pill
 * at the top, as the iPhone's camera does.
 *
 * The camera and the microphone are asked for as the screen opens, one after the other, as TikTok does. Without the
 * camera the stage explains what each is for, with Allow (or Settings, once iOS won't ask again) and the library.
 * Without the microphone the camera still works and videos record silently, with a note saying so.
 */
export default function CameraScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { user, loading } = useSession();
  const { colors } = useAppTheme();
  const s = useCompose();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const drafts = useDrafts(user?.id);

  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [mountError, setMountError] = useState<string | null>(null);
  /** Changed to start the camera over after it failed to start. */
  const [attempt, setAttempt] = useState(0);
  /** BUZZ or SNAP, which live on this screen only; null for POST and REEL, which are the create session's own mode. */
  const [extraMode, setExtraMode] = useState<"buzz" | "snap" | null>(params.mode === "snap" || params.mode === "buzz" ? params.mode : null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [zoom, setZoom] = useState(0);
  const [capture, setCapture] = useState<"photo" | "video">("photo");
  const [reelLength, setReelLength] = useState<"180" | "60" | "15">("60");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  /** The passing pill at the top ("Flash On", "Timer 3s", "Front Camera"): a fresh id each time, so it fades in again. */
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipTurn = useSharedValue(0);
  /** What to do once a sheet is fully gone (iOS presents nothing new while a modal is still leaving). */
  const afterSheet = useRef<(() => void) | null>(null);
  const asked = useRef(false);
  const startedAt = useRef(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progress = useSharedValue(0);
  const flashOverlay = useSharedValue(0);

  const mode: CameraMode = extraMode ?? s.mode;
  const buzz = mode === "buzz";
  const adding = s.media.length > 0;
  const room = roomFor(s);
  const video = mode === "reel" || capture === "video";
  const maxSeconds = mode === "reel" ? Number(reelLength) : mode === "snap" ? SNAP_LIMITS.maxVideoSeconds : POST_VIDEO_MAX;
  const canCapture = mode === "snap" || (video ? room.videos > 0 : room.photos > 0);
  const micOff = micPermission !== null && !micPermission.granted;

  // A link straight to /compose?mode=reel starts in that mode (the + sets it before opening).
  useEffect(() => {
    if (params.mode === "post" || params.mode === "reel") compose.setMode(params.mode);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adding to a post with no room left for a photo (or a video): the capture switches to what still fits.
  useEffect(() => {
    if (mode === "post" && adding) {
      if (room.photos === 0 && room.videos > 0) setCapture("video");
      if (room.videos === 0 && room.photos > 0) setCapture("photo");
    }
  }, [mode, adding, room.photos, room.videos]);

  // Signed out there is nothing to post with.
  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/login");
  }, [loading, user, router]);

  // The camera, then the microphone, asked for as the screen opens (once each: iOS remembers the answers).
  useEffect(() => {
    if (!cameraPermission || !micPermission || asked.current) return;
    asked.current = true;
    void (async () => {
      const cam = cameraPermission.granted || !cameraPermission.canAskAgain ? cameraPermission : await requestCamera();
      if (cam.granted && !micPermission.granted && micPermission.canAskAgain) await requestMic();
    })();
  }, [cameraPermission, micPermission, requestCamera, requestMic]);

  // The newest picture in the library for the Upload button, only if access was already given (no prompt from here).
  useEffect(() => {
    if (!focused) return;
    let active = true;
    (async () => {
      try {
        const p = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
        if (!p.granted) return;
        const page = await MediaLibrary.getAssetsAsync({ first: 1, sortBy: [[MediaLibrary.SortBy.creationTime, false]], mediaType: mode === "reel" ? [MediaLibrary.MediaType.video] : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] });
        if (active) setLatest(page.assets[0]?.uri ?? null);
      } catch {
        // The plain library icon stays.
      }
    })();
    return () => {
      active = false;
    };
  }, [focused, mode, galleryOpen]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(
    () => () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const tell = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), text });
    noticeTimer.current = setTimeout(() => setNotice(null), 1300);
  }, []);

  const openEditor = useCallback(() => router.push("/compose/edit"), [router]);

  const took = useCallback(
    (items: ComposeMedia[]) => {
      if (compose.add(items) === 0) return;
      openEditor();
    },
    [openEditor],
  );

  /** A Snap goes on to Send To, which shows it at once (see app/snap). */
  const sendAsSnap = useCallback(
    async (asset: Parameters<typeof prepareSnap>[0]) => {
      const shot = await prepareSnap(asset);
      handOffSnap(shot);
      router.push("/snap" as never);
    },
    [router],
  );

  async function takePhoto() {
    if (!camera.current) return;
    setBusy(true);
    hapticSoft();
    if (!reduceMotion) flashOverlay.value = withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 260 }));
    try {
      const shot = await camera.current.takePictureAsync({ quality: mode === "snap" ? 1 : 0.92, exif: false });
      if (mode === "snap") await sendAsSnap({ uri: shot.uri, width: shot.width, height: shot.height, type: "image", mimeType: "image/jpeg" });
      else took([photoFromCamera(shot)]);
    } catch (e) {
      alertWithHaptic("error", "Couldn't take the photo", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (!camera.current) return;
    hapticSoft();
    startedAt.current = Date.now();
    setElapsed(0);
    setRecording(true);
    progress.value = 0;
    progress.value = withTiming(1, { duration: maxSeconds * 1000, easing: Easing.linear });
    try {
      const result = await camera.current.recordAsync({ maxDuration: maxSeconds });
      const seconds = Math.min(maxSeconds, (Date.now() - startedAt.current) / 1000);
      if (!result?.uri) return;
      if (seconds < MIN_SECONDS) {
        Alert.alert("Too short", "Tap once to start recording and again to stop.");
        return;
      }
      setBusy(true);
      if (mode === "snap") {
        const still = await videoStill(result.uri);
        await sendAsSnap({ uri: result.uri, width: still?.width ?? 0, height: still?.height ?? 0, type: "video", mimeType: Platform.OS === "ios" ? "video/quicktime" : "video/mp4", duration: seconds * 1000 });
      } else took([await videoFromCamera(result.uri, seconds)]);
    } catch (e) {
      alertWithHaptic("error", "Couldn't record the video", e instanceof Error ? e.message : "Please try again.");
    } finally {
      cancelAnimation(progress);
      progress.value = 0;
      setRecording(false);
      setBusy(false);
    }
  }

  function stopRecording() {
    hapticSoft();
    camera.current?.stopRecording();
  }

  function shoot() {
    if (countdown !== null) {
      // A second tap during the countdown calls it off.
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      setCountdown(null);
      return;
    }
    if (recording) return stopRecording();
    const go = () => (video ? void startRecording() : void takePhoto());
    if (timer === 0) return go();
    let left = timer;
    setCountdown(left);
    countdownTimer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        setCountdown(null);
        go();
      } else setCountdown(left);
    }, 1000);
  }

  function close() {
    if (recording) return;
    // BUZZ's X comes back to the camera, on POST, without leaving the create flow.
    if (buzz) {
      Keyboard.dismiss();
      return switchMode("post");
    }
    // Adding to a post (the editor's +): back to it with nothing new.
    if (adding) return openEditor();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  function switchMode(next: CameraMode) {
    if (recording || adding || countdown !== null) return;
    setExtraMode(next === "snap" || next === "buzz" ? next : null);
    if (next === "post" || next === "reel") compose.setMode(next);
  }

  /** A buzz went out: away from the camera, to Home's Buzz page, where it is at the top of the feed it went to. */
  function buzzPosted() {
    openHomeSection("buzz");
    if (router.canGoBack()) router.back();
    router.navigate("/(tabs)");
  }

  function stepMode(by: 1 | -1) {
    const i = MODES.findIndex((m) => m.value === mode);
    const next = MODES[i + by];
    if (next) switchMode(next.value);
  }

  /** Asks again, or (iOS won't ask twice) opens this app's page in Settings. */
  async function allow(which: "camera" | "microphone") {
    const current = which === "camera" ? cameraPermission : micPermission;
    if (current && !current.granted && !current.canAskAgain) return void Linking.openSettings();
    const answer = which === "camera" ? await requestCamera() : await requestMic();
    if (which === "camera" && answer.granted && micPermission && !micPermission.granted && micPermission.canAskAgain) await requestMic();
  }

  async function openLibrary() {
    if (recording || countdown !== null) return;
    if (mode !== "snap") return setGalleryOpen(true);
    // A Snap from the library: one photo or video, through the system picker.
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1, exif: false, videoMaxDuration: SNAP_LIMITS.maxVideoSeconds, shouldDownloadFromNetwork: true });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) await sendAsSnap(asset);
    } catch (e) {
      alertWithHaptic("error", "Couldn't use that for a Snap", e instanceof Error ? e.message : "Try another photo or video.");
    }
  }

  const flip = () => {
    const next = facing === "back" ? "front" : "back";
    setFacing(next);
    flipTurn.value = reduceMotion ? 0 : withTiming(flipTurn.value + 180, { duration: 320, easing: Easing.out(Easing.cubic) });
    tell(next === "front" ? "Front Camera" : "Back Camera");
  };
  const cycleFlash = () => {
    const next = flash === "off" ? "on" : flash === "on" ? "auto" : "off";
    setFlash(next);
    tell(next === "on" ? "Flash On" : next === "auto" ? "Flash Auto" : "Flash Off");
  };
  const cycleTimer = () => {
    const next = timer === 0 ? 3 : timer === 3 ? 10 : 0;
    setTimer(next);
    tell(next === 0 ? "Timer Off" : `Timer ${next}s`);
  };
  const flashBounce = useBounceOn(flash !== "off");
  const timerBounce = useBounceOn(timer > 0);
  const flipStyle = useAnimatedStyle(() => ({ transform: [{ perspective: 400 }, { rotateY: `${flipTurn.value}deg` }] }));
  const pinchStart = useSharedValue(0);
  const zoomValue = useSharedValue(0);
  const gestures = Gesture.Simultaneous(
    Gesture.Pinch()
      .onStart(() => {
        pinchStart.value = zoomValue.value;
      })
      .onUpdate((e) => {
        const next = Math.min(1, Math.max(0, pinchStart.value + (e.scale - 1) * 0.35));
        if (Math.abs(next - zoomValue.value) > 0.01) {
          zoomValue.value = next;
          runOnJS(setZoom)(next);
        }
      }),
    Gesture.Exclusive(
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => runOnJS(flip)()),
      // A swipe to the left brings in the mode on the right, as the row under the stage moves.
      Gesture.Fling()
        .direction(Directions.LEFT)
        .onEnd(() => runOnJS(stepMode)(1)),
      Gesture.Fling()
        .direction(Directions.RIGHT)
        .onEnd(() => runOnJS(stepMode)(-1)),
    ),
  );

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOverlay.value }));
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const bottom = Math.max(insets.bottom, 12);
  const stageTop = insets.top + 2;
  const stageHeight = screenHeight - stageTop - BAR - bottom;
  const cameraReady = cameraPermission?.granted === true && !mountError;
  const flashIcon: { icon: IconName; sf: SFSymbol; label: string } =
    flash === "on" ? { icon: "flash", sf: "bolt.fill", label: "Flash on" } : flash === "auto" ? { icon: "flash-outline", sf: "bolt.badge.automatic.fill", label: "Flash auto" } : { icon: "flash-off-outline", sf: "bolt.slash.fill", label: "Flash off" };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.stage, { top: stageTop, height: stageHeight }]}>
        {cameraReady ? (
          <CameraView
            key={attempt}
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode={video ? "video" : "picture"}
            flash={flash as FlashMode}
            enableTorch={video && recording && flash === "on" && facing === "back"}
            zoom={zoom}
            mute={micOff}
            active={focused && !buzz}
            videoQuality="1080p"
            onMountError={(e) => setMountError(e.message || "The camera didn't start.")}
          />
        ) : cameraPermission && !cameraPermission.granted ? (
          <PermissionPanel camera={cameraPermission} microphone={micPermission} onAllow={(which) => void allow(which)} onLibrary={() => void openLibrary()} />
        ) : mountError ? (
          <StartError
            message={mountError}
            onRetry={() => {
              setMountError(null);
              setAttempt((a) => a + 1);
            }}
            onLibrary={() => void openLibrary()}
          />
        ) : (
          <View style={styles.dark} />
        )}
        {cameraReady && !buzz ? (
          <GestureDetector gesture={gestures}>
            <View style={StyleSheet.absoluteFill} collapsable={false} />
          </GestureDetector>
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />
        {buzz ? <BuzzStage stageTop={stageTop} onLeave={() => switchMode("post")} onPosted={buzzPosted} /> : null}

        {recording ? (
          <View style={styles.progressTrack} pointerEvents="none">
            <Animated.View style={[styles.progressFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.auroraGlow, 90) }, progressStyle]} />
          </View>
        ) : null}

        <View style={styles.topRow} pointerEvents="box-none">
          <GlassIconButton icon={adding ? "chevron-back" : "close"} label={adding ? "Back to your post" : buzz ? "Back to the camera" : "Close the camera"} onPress={close} variant="media" size={40} iconSize={adding ? 20 : 19} haptic={false} disabled={recording} />
          {recording ? (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.pill} accessibilityLiveRegion="polite" accessibilityLabel={`Recording, ${clock(elapsed)} of ${clock(maxSeconds)}`}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>
                {clock(elapsed)} <Text style={styles.recMax}>/ {clock(maxSeconds)}</Text>
              </Text>
            </Animated.View>
          ) : adding ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Adding to your {mode}</Text>
            </View>
          ) : notice && !buzz ? (
            <Animated.View key={notice.id} entering={reduceMotion ? undefined : FadeIn.duration(140)} exiting={reduceMotion ? undefined : FadeOut.duration(220)} style={styles.pill} accessibilityLiveRegion="polite">
              <Text style={styles.pillText}>{notice.text}</Text>
            </Animated.View>
          ) : cameraReady && SIMULATOR && !buzz ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Simulator: no live camera</Text>
            </View>
          ) : null}
          <View style={{ width: 40 }} />
        </View>

        {cameraReady && !recording && !buzz ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} exiting={reduceMotion ? undefined : FadeOut.duration(120)} style={styles.rail} pointerEvents="box-none">
            <RailButton icon="camera-reverse-outline" sf="arrow.triangle.2.circlepath.camera" label={facing === "back" ? "Switch to the front camera" : "Switch to the back camera"} onPress={flip} turn={flipStyle} />
            <RailButton icon={flashIcon.icon} sf={flashIcon.sf} label={flashIcon.label} active={flash !== "off"} bounce={flashBounce} onPress={cycleFlash} />
            <RailButton icon="timer-outline" sf="timer" label={timer === 0 ? "Timer off" : `Timer ${timer} seconds`} active={timer > 0} bounce={timerBounce} badge={timer > 0 ? String(timer) : undefined} onPress={cycleTimer} />
          </Animated.View>
        ) : null}

        {countdown !== null ? (
          <View style={styles.countdown} pointerEvents="none">
            <Animated.Text key={countdown} entering={reduceMotion ? undefined : ZoomIn.duration(220)} style={styles.countdownText} accessibilityLiveRegion="assertive">
              {countdown}
            </Animated.Text>
          </View>
        ) : null}

        {cameraReady && !buzz ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} exiting={reduceMotion ? undefined : FadeOut.duration(120)} style={styles.captureArea} pointerEvents="box-none">
            {video && micOff && !recording ? (
              <Pressable onPress={() => void allow("microphone")} style={({ pressed }) => [styles.micNote, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityHint="Turns on sound for your videos">
                <Icon name="mic-off" size={14} color="#fff" />
                <Text style={styles.micNoteText}>No sound: allow the microphone</Text>
              </Pressable>
            ) : null}
            {!recording && countdown === null ? (
              <Animated.View key={mode} entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.lengths}>
                {mode === "reel" ? (
                  <ModeSwitcher options={REEL_LENGTHS} value={reelLength} onChange={setReelLength} size="small" pill />
                ) : (
                  <ModeSwitcher options={CAPTURE.filter((o) => mode === "snap" || !adding || (o.value === "photo" ? room.photos > 0 : room.videos > 0))} value={capture} onChange={setCapture} size="small" pill />
                )}
              </Animated.View>
            ) : (
              <View style={styles.lengths} />
            )}
            <CaptureButton
              kind={video ? "video" : "photo"}
              recording={recording}
              busy={busy && !recording}
              disabled={!canCapture}
              onPress={shoot}
              label={recording ? "Stop recording" : countdown !== null ? "Cancel the timer" : video ? "Record a video" : "Take a photo"}
            />
          </Animated.View>
        ) : null}
      </View>

      <View style={[styles.bar, { height: BAR, bottom }]}>
        {buzz ? (
          <View style={styles.side} />
        ) : (
          <Pressable onPress={() => void openLibrary()} style={({ pressed }) => [styles.side, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Upload from your library" hitSlop={8}>
            <View style={styles.library}>{latest && mode !== "snap" ? <Image source={{ uri: latest }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} /> : <Icon name="images-outline" size={20} color="#fff" />}</View>
          </Pressable>
        )}
        <View style={styles.modes}>
          {adding ? <Text style={styles.modeFixed}>{mode === "reel" ? "REEL" : "POST"}</Text> : <ModeSwitcher options={MODES} value={mode} onChange={switchMode} disabled={recording || countdown !== null} slide={false} />}
        </View>
        {drafts.length > 0 && !adding && !buzz ? (
          <Pressable onPress={() => setDraftsOpen(true)} disabled={recording} style={({ pressed }) => [styles.side, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Drafts, ${drafts.length}`} hitSlop={8}>
            <View style={styles.draftsIcon}>
              <Icon name="archive-outline" sf="archivebox" size={22} color="#fff" />
              <View style={styles.draftsCount}>
                <Text style={styles.draftsCountText}>{drafts.length > 99 ? "99+" : drafts.length}</Text>
              </View>
            </View>
          </Pressable>
        ) : (
          <View style={styles.side} />
        )}
      </View>

      <GallerySheet
        visible={galleryOpen}
        mode={s.mode}
        room={room}
        onClose={() => setGalleryOpen(false)}
        onDismiss={() => {
          const next = afterSheet.current;
          afterSheet.current = null;
          next?.();
        }}
        onPicked={(items) => {
          afterSheet.current = () => took(items);
          setGalleryOpen(false);
        }}
      />
      {user ? (
        <DraftsSheet
          visible={draftsOpen}
          drafts={drafts}
          userId={user.id}
          onClose={() => setDraftsOpen(false)}
          onDismiss={() => {
            const next = afterSheet.current;
            afterSheet.current = null;
            next?.();
          }}
          onOpen={(draft: Draft) => {
            afterSheet.current = () => {
              compose.restore(draft.state);
              router.push("/compose/publish");
            };
            setDraftsOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * One switch down the stage's right edge, TikTok's: a bare white symbol with a soft shadow, readable over any picture,
 * that sinks under the finger. Its state is the symbol itself (yellow when on, a bounce as it turns on, the timer's
 * seconds in a small badge) and the passing pill at the top says what changed; `turn` spins it (the lens flip).
 */
function RailButton({ icon, sf, label, active, bounce, badge, turn, onPress }: { icon: IconName; sf: SFSymbol; label: string; active?: boolean; bounce?: number; badge?: string; turn?: ReturnType<typeof useAnimatedStyle>; onPress: () => void }) {
  const press = useSharedValue(1);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(0.86, { duration: 90 });
      }}
      onPressOut={() => {
        press.value = withSpring(1, motion.spring);
      }}
      hitSlop={10}
      style={styles.railButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
    >
      <Animated.View style={[sink, turn]}>
        <Icon name={icon} sf={sf} size={28} weight="medium" color={active ? "#ffd60a" : "#fff"} bounce={bounce} style={styles.railShadow} />
      </Animated.View>
      {badge ? (
        <View style={styles.railBadge} pointerEvents="none">
          <Text style={styles.railBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The stage before the camera may be used, TikTok's: what UniBuzz wants each permission for, with its own Allow (or Open
 * Settings once iOS won't ask again) and a tick once given, and the library as the way round it.
 */
function PermissionPanel({ camera, microphone, onAllow, onLibrary }: { camera: PermissionResponse; microphone: PermissionResponse | null; onAllow: (which: "camera" | "microphone") => void; onLibrary: () => void }) {
  const { colors } = useAppTheme();
  const rows: { which: "camera" | "microphone"; icon: IconName; sf: SFSymbol; title: string; body: string; permission: PermissionResponse | null }[] = [
    { which: "camera", icon: "camera-outline", sf: "camera", title: "Camera", body: "To take photos and record videos here.", permission: camera },
    { which: "microphone", icon: "mic-outline", sf: "mic", title: "Microphone", body: "To record sound with your videos.", permission: microphone },
  ];
  return (
    <View style={[styles.panel, { experimental_backgroundImage: "linear-gradient(180deg, #15161c 0%, #0b0b0f 100%)" }]}>
      <Text style={styles.panelTitle}>Let UniBuzz use your camera and microphone</Text>
      <Text style={styles.panelBody}>Post what's happening on campus: take photos and record videos and reels without leaving the app.</Text>
      <View style={styles.permRows}>
        {rows.map((r) => {
          const granted = r.permission?.granted === true;
          const blocked = r.permission !== null && !granted && !r.permission.canAskAgain;
          return (
            <View key={r.which} style={styles.permRow}>
              <View style={styles.permIcon}>
                <Icon name={r.icon} sf={r.sf} size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.permTitle}>{r.title}</Text>
                <Text style={styles.permBody}>{r.body}</Text>
              </View>
              {granted ? (
                <Icon name="checkmark-circle" size={24} color={colors.green} accessibilityLabel={`${r.title} allowed`} />
              ) : (
                <Pressable onPress={() => onAllow(r.which)} style={({ pressed }) => [styles.allow, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 120) }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={blocked ? `Open Settings to allow the ${r.which}` : `Allow the ${r.which}`}>
                  <Text style={styles.allowText}>{blocked ? "Settings" : "Allow"}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      {!camera.granted && !camera.canAskAgain ? <Text style={styles.panelHint}>Camera access is off for UniBuzz. Turn it on in Settings, then come back.</Text> : null}
      <Pressable onPress={onLibrary} style={({ pressed }) => [styles.darkSecondary, pressed && { opacity: 0.7 }]} accessibilityRole="button">
        <Icon name="images-outline" size={18} weight="semibold" color="#fff" />
        <Text style={styles.darkSecondaryText}>Upload from library instead</Text>
      </Pressable>
    </View>
  );
}

/** The camera was allowed but wouldn't start (another app holding it, a hardware fault): try again, or use the library. */
function StartError({ message, onRetry, onLibrary }: { message: string; onRetry: () => void; onLibrary: () => void }) {
  return (
    <View style={[styles.panel, { alignItems: "center" }]}>
      <Icon name="camera-outline" sf="exclamationmark.triangle" size={34} color="#fff" />
      <Text style={[styles.panelTitle, { textAlign: "center" }]}>The camera didn't start</Text>
      <Text style={[styles.panelBody, { textAlign: "center" }]}>{message}</Text>
      <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8 }}>
        <Button title="Try again" onPress={onRetry} />
        <Pressable onPress={onLibrary} style={({ pressed }) => [styles.darkSecondary, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Icon name="images-outline" size={18} weight="semibold" color="#fff" />
          <Text style={styles.darkSecondaryText}>Upload from library</Text>
        </Pressable>
      </View>
    </View>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  stage: { position: "absolute", left: 0, right: 0, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#0b0b0f" },
  dark: { flex: 1, backgroundColor: "#0b0b0f" },
  flash: { backgroundColor: "#fff" },
  progressTrack: { position: "absolute", top: 10, left: 12, right: 12, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)", overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  topRow: { position: "absolute", top: 20, left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.45)" },
  pillText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ff453a" },
  recText: { color: "#fff", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  recMax: { color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  rail: { position: "absolute", top: 76, right: 10, alignItems: "center", gap: 22 },
  railButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  railShadow: { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 7, textShadowOffset: { width: 0, height: 1 } },
  railBadge: { position: "absolute", right: 0, bottom: 2, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: "#ffd60a", alignItems: "center", justifyContent: "center" },
  railBadgeText: { color: "#000", fontSize: 10, fontWeight: "800" },
  countdown: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  countdownText: { color: "#fff", fontSize: 120, fontWeight: "800", ...shadow, textShadowRadius: 18 },
  captureArea: { position: "absolute", left: 0, right: 0, bottom: 14, alignItems: "center", gap: 10 },
  micNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.5)" },
  micNoteText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  lengths: { height: 36, alignSelf: "stretch", justifyContent: "center" },
  bar: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  side: { width: 56, height: 44, alignItems: "center", justifyContent: "center" },
  library: { width: 38, height: 38, borderRadius: 10, borderCurve: "continuous", borderWidth: 2, borderColor: "rgba(255,255,255,0.92)", overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#2a2a30" },
  modes: { flex: 1, justifyContent: "center" },
  modeFixed: { color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.6, textAlign: "center" },
  draftsIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  draftsCount: { position: "absolute", top: -2, right: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  draftsCountText: { color: "#000", fontSize: 11, fontWeight: "800" },
  panel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 24, gap: 10, backgroundColor: "#0b0b0f" },
  panelTitle: { color: "#fff", fontSize: 24, lineHeight: 30, fontWeight: "700" },
  panelBody: { color: "rgba(255,255,255,0.7)", fontSize: 15, lineHeight: 21 },
  panelHint: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18 },
  permRows: { gap: 12, marginTop: 14, marginBottom: 10 },
  permRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.07)" },
  permIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  permTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  permBody: { color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 17, marginTop: 1 },
  allow: { paddingHorizontal: 16, height: 34, borderRadius: 17, justifyContent: "center" },
  allowText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  darkSecondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 46, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.14)", marginTop: 6 },
  darkSecondaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
