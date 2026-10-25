import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requireOptionalNativeModule } from "expo";
import type { LocalVideoTrack, Track } from "livekit-client";
import { CALL_RING_SECONDS, fetchCallToken, formatCallDuration, getCall, getConversation, leaveCall, type CallParticipant, type CallRecord } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { ParticipantsSheet } from "@/components/calls/participants-sheet";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { playCallEnded, startRingback, stopRingback } from "@/lib/call-sounds";
import { CALLS_AVAILABLE, CALLS_UNAVAILABLE_TEXT, loadLiveKit } from "@/lib/calls";
import { hapticSelect, hapticSoft } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** The LiveKit SDK, where this build has its native module (never in Expo Go). */
const lk = loadLiveKit();
/** The screen stays on through a call, as the Phone app's does. */
const keepAwake = requireOptionalNativeModule("ExpoKeepAwake") ? (require("expo-keep-awake") as typeof import("expo-keep-awake")) : null;

/** The call's own dark, the same in both themes, as FaceTime's. */
const STAGE = "#0b0b14";
const WHITE = "#ffffff";
const WHITE_SOFT = "rgba(255,255,255,0.72)";
/** How long "Call ended" stays before the screen goes. */
const ENDED_FOR_MS = 1400;

/** The names a refused, missing or busy microphone or camera fails with (DOMException names, and react-native-webrtc's). */
const DEVICE_ERRORS: Record<string, "PermissionDenied" | "NotFound" | "DeviceInUse"> = {
  NotAllowedError: "PermissionDenied",
  PermissionDeniedError: "PermissionDenied",
  SecurityError: "PermissionDenied",
  NotFoundError: "NotFound",
  DevicesNotFoundError: "NotFound",
  OverconstrainedError: "NotFound",
  NotReadableError: "DeviceInUse",
  TrackStartError: "DeviceInUse",
};

/** What the call screen says when a microphone or camera could not be opened; the call goes on without it. */
function deviceNoteFor(failure: string | undefined): string | null {
  switch (failure) {
    case "PermissionDenied":
      return "Allow the microphone and camera for CampConnect in Settings to be heard and seen.";
    case "DeviceInUse":
      return "Another app is using the microphone or camera.";
    case "NotFound":
      return "No microphone or camera was found.";
    default:
      return null;
  }
}

/** One person on the stage: their picture or their video, and where they stand. */
type Tile = { key: string; name: string; avatarUrl: string | null; me: boolean; video: ReactNode | null; speaking: boolean; muted: boolean; waiting: boolean; ringing: boolean };

/**
 * A call, from ringing to hanging up, laid out like FaceTime: the other person's video (or their photo on the dark
 * stage) filling the screen with your own camera in a small window, a grid for a group, their name and the call's
 * standing at the top ("Calling…", "Connecting…", the running time), and a glass bar of controls along the bottom
 * (mute, speaker, camera, flip camera, the people in a group) with the red End button. The database says who is in the
 * call (this screen follows it live); the sound and picture flow over LiveKit, with a token from the server once you
 * are in. Leaving this screen in any way hangs up.
 */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const userId = user?.id ?? "";
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<CallRecord | null>(null);
  const [groupTitle, setGroupTitle] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [media, setMedia] = useState<{ token: string; url: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  /** The microphone or camera could not be opened (permission refused, in use): the call goes on without it, and says so. */
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [people, setPeople] = useState(false);
  const left = useRef(false);
  const callRef = useRef(call);
  callRef.current = call;

  const close = useCallback(() => {
    if (navigation.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, [navigation, router]);

  /** The call is over for me: the end tone, a moment of "Call ended", then the screen goes. */
  const finish = useCallback(
    (label: string) => {
      setEnded((current) => current ?? label);
      playCallEnded();
      setTimeout(close, ENDED_FOR_MS);
    },
    [close],
  );

  const hangUp = useCallback(
    (label = "Call ended") => {
      if (left.current) return;
      left.current = true;
      hapticSoft();
      leaveCall(supabase, id).catch(() => {});
      finish(label);
    },
    [id, finish],
  );

  // The call, and every change to it or to who is in it.
  const refresh = useCallback(async () => {
    try {
      const fresh = await getCall(supabase, id);
      if (fresh) setCall(fresh);
      else setLoadError("This call isn't available.");
    } catch (e) {
      setLoadError(errorText(e, "Couldn't load the call."));
    }
  }, [id]);
  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`call:${id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "call_participants", filter: `call_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  // Leaving this screen in any way (Android's Back included) hangs up; the screen stays awake while it is up.
  useEffect(() => {
    void keepAwake?.activateKeepAwakeAsync("call").catch(() => {});
    return () => {
      void keepAwake?.deactivateKeepAwake("call").catch(() => {});
      if (!left.current) {
        left.current = true;
        leaveCall(supabase, id).catch(() => {});
      }
    };
  }, [id]);

  const me = call?.participants.find((p) => p.user_id === userId) ?? null;
  const iStarted = call?.started_by === userId;
  const ringing = call?.status === "ringing";
  const others = useMemo(() => call?.participants.filter((p) => p.user_id !== userId) ?? [], [call, userId]);

  // A group's name for the top line (two people need none: the other person's name is it).
  useEffect(() => {
    if (!call || others.length < 2 || groupTitle) return;
    getConversation(supabase, call.conversation_id, userId)
      .then((c) => setGroupTitle(c?.title ?? null))
      .catch(() => {});
  }, [call, others.length, groupTitle, userId]);

  // In: a token for the room. (Only once the database has me joined, which it has from the moment this screen opens.)
  useEffect(() => {
    if (!CALLS_AVAILABLE || media || mediaError || !call || call.status === "ended" || me?.state !== "joined") return;
    let cancelled = false;
    fetchCallToken(supabase, call.id)
      .then((t) => {
        if (!cancelled) setMedia(t);
      })
      .catch((e) => {
        if (!cancelled) setMediaError(errorText(e, "Couldn't connect to the call."));
      });
    return () => {
      cancelled = true;
    };
  }, [call, me?.state, media, mediaError]);

  // The caller hears the ringback while it rings, and gives up when the ring runs out ("No answer": the database marks
  // the call missed for everyone it rang).
  useEffect(() => {
    if (!ringing || !iStarted || !call) return;
    startRingback();
    const wait = Math.max(0, CALL_RING_SECONDS * 1000 - (Date.now() - Date.parse(call.started_at)));
    const timer = setTimeout(() => hangUp("No answer"), wait);
    return () => {
      clearTimeout(timer);
      stopRingback();
    };
  }, [ringing, iStarted, call, hangUp]);

  // Over, from the other side (they declined, or the last of them hung up) or because nobody else is left in it.
  useEffect(() => {
    if (!call || ended) return;
    if (call.status === "ended") {
      left.current = true;
      finish(call.ended_reason === "declined" ? "Declined" : call.ended_reason === "missed" ? "No answer" : "Call ended");
      return;
    }
    if (call.status === "active" && others.length > 0 && others.every((p) => p.state !== "joined" && p.state !== "ringing")) {
      const timer = setTimeout(() => hangUp(), 800);
      return () => clearTimeout(timer);
    }
  }, [call, others, ended, finish, hangUp]);

  // The running time, from the moment the call was answered.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (call?.status !== "active" || ended) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call?.status, ended]);
  const elapsed = call?.answered_at ? Math.max(0, Math.floor((now - Date.parse(call.answered_at)) / 1000)) : 0;

  const title = others.length === 1 ? (others[0].profile?.full_name ?? "Someone") : (groupTitle ?? others.map((p) => p.profile?.full_name?.split(" ")[0] ?? "Someone").join(", "));
  const kind = call?.kind ?? "audio";

  if (!call) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <View style={[styles.centered, { paddingTop: insets.top }]}>
          <Text style={styles.status}>{loadError ?? "Connecting…"}</Text>
          {loadError ? <EndButton onPress={close} /> : null}
        </View>
      </View>
    );
  }

  const header = (status: string) => (
    <View style={[styles.top, { paddingTop: insets.top + 14 }]} pointerEvents="box-none">
      <Text style={styles.name} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.status} numberOfLines={1}>
        {status}
      </Text>
      {others.length > 1 ? (
        <GlassIconButton icon="people" label="People in the call" variant="media" size={40} iconSize={19} onPress={() => setPeople(true)} style={[styles.peopleButton, { top: insets.top + 10 }]} />
      ) : null}
    </View>
  );

  const base = { call, userId, others, kind, insets, header, ended, elapsed, onHangUp: () => hangUp() } as const;
  const cannot = !CALLS_AVAILABLE ? CALLS_UNAVAILABLE_TEXT : mediaError;

  return (
    <View style={styles.screen}>
      <Backdrop />
      {lk && media && !ended && !mediaError ? (
        <lk.LiveKitRoom
          serverUrl={media.url}
          token={media.token}
          connect
          audio
          video={kind === "video"}
          options={{ adaptiveStream: true, dynacast: true }}
          // A microphone or camera that could not be opened (refused, missing, busy) reaches onError too, when the room
          // publishes the tracks it was asked for; the call goes on without it and says so. Anything else is the
          // connection itself, and ends this stage.
          onError={(e) => {
            const failure = DEVICE_ERRORS[(e as { name?: string } | null)?.name ?? ""];
            if (failure) setDeviceNote(deviceNoteFor(failure));
            else setMediaError(errorText(e, "The call's connection failed."));
          }}
          onMediaDeviceFailure={(failure) => setDeviceNote(deviceNoteFor(failure))}
          // LiveKit retries a dropped connection by itself for a while; this fires once it gives up (or the room closed).
          onDisconnected={() => {
            if (!left.current) setMediaError("The call's connection was lost.");
          }}
        >
          <RoomStage {...base} note={deviceNote} openPeople={() => setPeople(true)} />
        </lk.LiveKitRoom>
      ) : (
        <PlainStage {...base} note={cannot} />
      )}
      <ParticipantsSheet visible={people} onClose={() => setPeople(false)} participants={call.participants} userId={userId} connected={new Set(call.participants.filter((p) => p.state === "joined").map((p) => p.user_id))} muted={new Set()} />
    </View>
  );
}

type StageProps = {
  call: CallRecord;
  userId: string;
  others: CallParticipant[];
  kind: "audio" | "video";
  insets: { top: number; bottom: number };
  header: (status: string) => ReactNode;
  ended: string | null;
  elapsed: number;
  onHangUp: () => void;
};

/** The stage without a room: while the build cannot carry the call, before the token comes, and once the call is over. */
function PlainStage({ call, userId, others, kind, insets, header, ended, elapsed, onHangUp, note }: StageProps & { note: string | null }) {
  const status = ended ? (ended === "Call ended" && call.answered_at ? `Call ended · ${formatCallDuration(elapsed)}` : ended) : standing(call, userId, elapsed, !note && call.status === "active");
  const tiles = others.map((p) => tileOf(p, p.state === "joined", null, false, false));
  return (
    <>
      <Stage tiles={tiles} mine={null} kind={kind} />
      {header(status)}
      <View style={[stageStyles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {note && !ended ? <Text style={stageStyles.note}>{note}</Text> : null}
        <EndButton onPress={onHangUp} />
      </View>
    </>
  );
}

/** The stage in the room: everyone's video and sound, and the controls. */
function RoomStage({ call, userId, others, kind, insets, header, ended, elapsed, onHangUp, note, openPeople }: StageProps & { note: string | null; openPeople: () => void }) {
  const sdk = lk as NonNullable<typeof lk>;
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, cameraTrack } = sdk.useLocalParticipant();
  const participants = sdk.useParticipants();
  const refs = sdk.useTracks(["camera", "microphone"] as Track.Source[], { onlySubscribed: false });
  const speakers = sdk.useSpeakingParticipants();
  const connection = String(sdk.useConnectionState());
  const [speaker, setSpeaker] = useState(kind === "video");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const connected = connection === "connected";
  const reconnecting = connection === "reconnecting" || connection === "signalReconnecting";

  // The phone's audio for a call: the earpiece for an audio call and the speaker for a video call, until switched.
  useEffect(() => {
    const { AudioSession, AndroidAudioTypePresets } = sdk;
    AudioSession.configureAudio({
      android: { preferredOutputList: ["headset", "bluetooth", "speaker", "earpiece"], audioTypeOptions: AndroidAudioTypePresets.communication },
      ios: { defaultOutput: kind === "video" ? "speaker" : "earpiece" },
    })
      .then(() => AudioSession.startAudioSession())
      .catch(() => {});
    return () => {
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, [sdk, kind]);

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    hapticSelect();
    sdk.AudioSession.selectAudioOutput(Platform.OS === "ios" ? (next ? "force_speaker" : "default") : next ? "speaker" : "earpiece").catch(() => {});
  };
  const toggleMic = () => {
    hapticSelect();
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {});
  };
  const toggleCamera = () => {
    hapticSelect();
    localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {});
  };
  const flipCamera = async () => {
    const track = cameraTrack?.track as LocalVideoTrack | undefined;
    if (!track) return;
    const next = facing === "user" ? "environment" : "user";
    hapticSelect();
    try {
      await track.restartTrack({ facingMode: next });
      setFacing(next);
    } catch {
      // The camera stays as it is.
    }
  };

  const speaking = new Set(speakers.map((p) => p.identity));
  const inRoom = new Map(participants.map((p) => [p.identity, p]));
  const videoOf = (identity: string): ReactNode | null => {
    const ref = refs.find((r) => r.participant.identity === identity && r.publication.source === "camera");
    if (!ref || ref.publication.isMuted || !ref.publication.track) return null;
    return <sdk.VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={identity === userId && facing === "user"} />;
  };
  const micMuted = (identity: string): boolean => {
    const ref = refs.find((r) => r.participant.identity === identity && r.publication.source === "microphone");
    return !ref || ref.publication.isMuted;
  };
  const tiles = others.map((p) => tileOf(p, inRoom.has(p.user_id), videoOf(p.user_id), speaking.has(p.user_id), micMuted(p.user_id)));
  const me = call.participants.find((p) => p.user_id === userId);
  const mine: Tile | null = me ? tileOf(me, true, videoOf(userId), speaking.has(userId), !isMicrophoneEnabled) : null;
  const status = ended ? (ended === "Call ended" && call.answered_at ? `Call ended · ${formatCallDuration(elapsed)}` : ended) : reconnecting ? "Reconnecting…" : standing(call, userId, elapsed, !connected);

  return (
    <>
      <Stage tiles={tiles} mine={mine} kind={kind} />
      {header(status)}
      <View style={[stageStyles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {note ? <Text style={stageStyles.note}>{note}</Text> : null}
        <View style={stageStyles.controls}>
          <GlassBackdrop variant="media" radius={36} />
          <Control icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} active={!isMicrophoneEnabled} onPress={toggleMic} />
          <Control icon={speaker ? "volume-high" : "volume-mute"} label={speaker ? "Speaker on" : "Speaker off"} active={speaker} onPress={toggleSpeaker} />
          {kind === "video" || isCameraEnabled ? <Control icon={isCameraEnabled ? "videocam" : "videocam-off"} label={isCameraEnabled ? "Camera off" : "Camera on"} active={!isCameraEnabled} onPress={toggleCamera} /> : null}
          {isCameraEnabled ? <Control icon="camera-reverse-outline" label="Flip camera" onPress={() => void flipCamera()} /> : null}
          {others.length > 1 ? <Control icon="people" label="People" onPress={openPeople} /> : null}
        </View>
        <EndButton onPress={onHangUp} />
      </View>
    </>
  );
}

/** "Calling…", "Ringing…", "Connecting…" or the running time. */
function standing(call: CallRecord, userId: string, elapsed: number, connecting: boolean): string {
  if (call.status === "ringing") return call.started_by === userId ? (call.participants.length > 2 ? "Ringing…" : "Calling…") : "Ringing…";
  if (connecting) return "Connecting…";
  return formatCallDuration(elapsed) || "0:00";
}

function tileOf(p: CallParticipant, inRoom: boolean, video: ReactNode | null, speaking: boolean, muted: boolean): Tile {
  return {
    key: p.user_id,
    name: p.profile?.full_name ?? "Someone",
    avatarUrl: p.profile?.avatar_url ?? null,
    me: false,
    video,
    speaking,
    muted: inRoom && muted,
    // Rung but not yet in, or gone: shown faded, until they come (a group) or the call ends (two people).
    waiting: p.state !== "joined" || !inRoom,
    ringing: p.state === "ringing",
  };
}

/**
 * Where everyone goes: one other person fills the screen (their video, or their photo on the dark) with my video in a
 * small window; a group is a grid, me among them; an audio call is photos. Before anyone has answered, my own camera
 * fills the screen, as FaceTime's does, with the people being rung over it.
 */
function Stage({ tiles, mine, kind }: { tiles: Tile[]; mine: Tile | null; kind: "audio" | "video" }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  if (tiles.length <= 1) {
    const other = tiles[0] ?? null;
    const otherVideo = other?.video ?? null;
    // Nobody in yet: my camera fills the screen; once they are in, theirs does and mine shrinks to the corner.
    const fill = otherVideo ?? (other?.waiting ? (mine?.video ?? null) : null);
    return (
      <View style={StyleSheet.absoluteFill}>
        {fill}
        {fill ? <View style={[StyleSheet.absoluteFill, styles.shade]} pointerEvents="none" /> : null}
        {!otherVideo && other ? (
          <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: 160 }]} pointerEvents="none">
            <View style={[styles.ring, other.speaking && styles.ringSpeaking]}>
              <Avatar name={other.name} url={other.avatarUrl} size={128} online={false} />
            </View>
          </View>
        ) : null}
        {mine?.video && otherVideo ? (
          <View style={[styles.pip, { top: insets.top + 84, right: 16 }]}>
            {mine.video}
            {mine.muted ? <MutedMark /> : null}
          </View>
        ) : null}
      </View>
    );
  }
  const all = mine ? [...tiles, { ...mine, me: true }] : tiles;
  const columns = 2;
  const rows = Math.ceil(all.length / columns);
  const gap = 8;
  const top = insets.top + 96;
  const bottom = 176 + insets.bottom;
  const tileWidth = (width - 16 - gap * (columns - 1)) / columns;
  const tileHeight = Math.max(120, Math.min(tileWidth * 1.3, (height - top - bottom - gap * (rows - 1)) / rows));
  return (
    <View style={[styles.grid, { paddingTop: top, gap }]}>
      {all.map((t) => (
        <View key={t.key} style={[styles.tile, { width: tileWidth, height: tileHeight }, t.speaking && styles.tileSpeaking, t.waiting && styles.tileWaiting]}>
          {t.video ?? (
            <View style={styles.tileAvatar}>
              <Avatar name={t.name} url={t.avatarUrl} size={kind === "video" ? 72 : 84} online={false} />
            </View>
          )}
          <View style={styles.tileName}>
            <Text style={styles.tileNameText} numberOfLines={1}>
              {t.me ? "You" : t.name}
              {t.ringing ? " · ringing" : ""}
            </Text>
            {t.muted ? <Icon name="mic-off" size={13} color={WHITE} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Backdrop() {
  const colors = useColors();
  return <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: auroraGradient(colors.aurora, 160), opacity: 0.28 }]} pointerEvents="none" />;
}

function MutedMark() {
  return (
    <View style={stageStyles.mutedMark}>
      <Icon name="mic-off" size={12} color={WHITE} />
    </View>
  );
}

/** One round control in the glass bar: white on glass, filled white when its state is on (muted, speaker, camera off). */
function Control({ icon, label, active, onPress }: { icon: IconName; label: string; active?: boolean; onPress: () => void }) {
  return (
    <GlassIconButton
      icon={icon}
      label={label}
      variant="media"
      size={52}
      iconSize={23}
      haptic={false}
      iconColor={active ? STAGE : WHITE}
      style={active ? stageStyles.controlOn : undefined}
      onPress={onPress}
    />
  );
}

function EndButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="End call" style={({ pressed }) => [stageStyles.end, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Icon name="call" size={26} color={WHITE} style={{ transform: [{ rotate: "135deg" }] }} />
    </Pressable>
  );
}

const stageStyles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: 18, paddingHorizontal: 16 },
  controls: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 36, borderCurve: "continuous", overflow: "hidden" },
  controlOn: { backgroundColor: WHITE },
  end: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ff3b30", alignItems: "center", justifyContent: "center" },
  mutedMark: { position: "absolute", left: 8, bottom: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  note: { fontSize: 15, lineHeight: 20, color: WHITE_SOFT, textAlign: "center", paddingHorizontal: 24, marginBottom: 4 },
});

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: STAGE },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24, paddingHorizontal: 32 },
  top: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 4, paddingHorizontal: 72 },
  name: { fontSize: 28, lineHeight: 34, fontWeight: "700", color: WHITE, textAlign: "center", textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 8 },
  status: { fontSize: 16, lineHeight: 21, color: WHITE_SOFT, textAlign: "center", textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 8 },
  peopleButton: { position: "absolute", right: 16, top: 0 },
  shade: { experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 22%, transparent 70%, rgba(0,0,0,0.5) 100%)" },
  ring: { padding: 6, borderRadius: 76, borderWidth: 2, borderColor: "rgba(255,255,255,0.25)" },
  ringSpeaking: { borderColor: colors.brand },
  pip: { position: "absolute", width: 108, height: 160, borderRadius: 16, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#1a1a24", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)" },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", paddingHorizontal: 8 },
  tile: { borderRadius: 20, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#171722", borderWidth: 2, borderColor: "transparent" },
  tileSpeaking: { borderColor: colors.brand },
  tileWaiting: { opacity: 0.55 },
  tileAvatar: { flex: 1, alignItems: "center", justifyContent: "center" },
  tileName: { position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "90%", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.45)" },
  tileNameText: { flexShrink: 1, fontSize: 12, fontWeight: "600", color: WHITE },
}));
