import { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useIsFocused, useRouter } from "expo-router";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn, ZoomOut, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "expo-symbols";
import { CoverPicker } from "@/components/compose/cover-picker";
import { CropEditor } from "@/components/compose/crop-editor";
import { GallerySheet } from "@/components/compose/gallery-sheet";
import { CAN_BAKE_TEXT, DraggableText, PhotoBaker, TextEditor, type PhotoBakerHandle } from "@/components/compose/text-layer";
import { useActionSheet } from "@/components/action-sheet";
import { GlassIconButton } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { Button, AnimatedPressable, usePressScale } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { saveDraft } from "@/lib/compose-drafts";
import { clock, dropUploads } from "@/lib/compose-media";
import { useCloseCompose } from "@/lib/compose-nav";
import { compose, roomFor, useCompose, type ComposeMedia, type TextOverlay } from "@/lib/compose-store";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { motion } from "@/lib/theme";

type Tool = { kind: "text"; editing: TextOverlay | null } | { kind: "crop" } | { kind: "cover" } | null;

const STRIP = 60;
/** The strip's items making room as one is added or taken out. */
const STRIP_MOVE = LinearTransition.springify().damping(30).stiffness(320);
const ACTIONS = 52;

/**
 * The editor, between the camera and the publish screen (TikTok's): the post's photos and video fill a rounded stage,
 * one at a time, with the tools for the one showing down the right edge: Text and Crop for a photo, Cover for a video.
 * Texts are dragged where they go, pinched to size, tapped to change and dragged onto the bin to go. Under the stage a
 * post's items line up (tap to show one, × to take it out, + to add more), over Save draft and Next. Next draws the
 * texts into their photos and moves on; Back asks before anything is thrown away.
 */
export default function EditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { user } = useSession();
  const s = useCompose();
  const show = useActionSheet();
  const closeCompose = useCloseCompose();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [tool, setTool] = useState<Tool>(null);
  const [drag, setDrag] = useState({ dragging: false, over: false });
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [working, setWorking] = useState<"next" | "draft" | null>(null);
  const baker = useRef<PhotoBakerHandle>(null);
  const pager = useRef<FlatList<ComposeMedia>>(null);
  /** Set when the editor is on its way out (discarded, saved as a draft): its emptied session must not send it back twice. */
  const leaving = useRef(false);

  const media = s.media;
  const current = media[Math.min(index, media.length - 1)] ?? null;
  const room = roomFor(s);
  const strip = s.mode === "post";
  const bottom = Math.max(insets.bottom, 10);
  const stageTop = insets.top + 2;
  const stageHeight = screenHeight - stageTop - bottom - ACTIONS - 12 - (strip ? STRIP + 10 : 0);
  const trash = { x: screenWidth / 2, y: stageTop + stageHeight - 56 };

  // Everything taken out: back to the camera.
  useEffect(() => {
    if (focused && media.length === 0 && !working && !leaving.current) {
      leaving.current = true;
      router.back();
    }
  }, [focused, media.length, working, router]);

  useEffect(() => {
    if (index > media.length - 1 && media.length > 0) setIndex(media.length - 1);
  }, [index, media.length]);

  const go = (i: number) => {
    setIndex(i);
    pager.current?.scrollToIndex({ index: i, animated: true });
  };

  function back() {
    show(
      [
        {
          label: "Discard",
          icon: "trash-outline",
          destructive: true,
          onPress: () => {
            leaving.current = true;
            dropUploads();
            compose.start(s.mode);
            router.back();
          },
        },
        { label: "Save draft", icon: "archive-outline", onPress: () => void finish("draft") },
      ],
      s.mode === "reel" ? "Discard this reel? Your edits will be lost." : "Discard this post? Your edits will be lost.",
    );
  }

  /** Photos whose texts have not been drawn in yet get them now, one at a time. */
  async function bakeAll(): Promise<boolean> {
    for (const m of compose.get().media) {
      if (m.kind !== "photo" || m.texts.length === 0 || m.uri !== m.baseUri) continue;
      const uri = await baker.current?.bake(m);
      if (!uri) return false;
      compose.replace(m.id, { uri });
    }
    return true;
  }

  async function finish(kind: "next" | "draft") {
    if (working) return;
    setWorking(kind);
    try {
      if (!(await bakeAll())) throw new Error("Couldn't add your text to the photo.");
      if (kind === "next") {
        router.push("/compose/publish");
        return;
      }
      if (!user) return;
      await saveDraft(user.id, compose.get());
      hapticSuccess();
      leaving.current = true;
      dropUploads();
      compose.start(s.mode);
      closeCompose();
    } catch (e) {
      alertWithHaptic("error", kind === "draft" ? "Couldn't save the draft" : "Couldn't finish editing", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setWorking(null);
    }
  }

  function addMore() {
    show(
      [
        { label: "Take a photo or video", icon: "camera-outline", onPress: () => router.back() },
        { label: "Choose from library", icon: "images-outline", onPress: () => setGalleryOpen(true) },
      ],
      `Add to your ${s.mode}`,
    );
  }

  function remove(item: ComposeMedia) {
    if (media.length === 1) return back();
    compose.remove(item.id);
  }

  const setTexts = (item: ComposeMedia, texts: TextOverlay[]) => compose.replace(item.id, { texts, uri: item.baseUri });
  const rail: { icon: IconName; sf: SFSymbol; label: string; onPress: () => void }[] =
    current?.kind === "photo"
      ? [
          ...(CAN_BAKE_TEXT ? [{ icon: "text-outline" as const, sf: "textformat" as const, label: "Text", onPress: () => setTool({ kind: "text", editing: null }) }] : []),
          { icon: "crop-outline", sf: "crop.rotate", label: "Crop", onPress: () => setTool({ kind: "crop" }) },
        ]
      : current?.kind === "video"
        ? [{ icon: "image-outline", sf: "photo.on.rectangle.angled", label: "Cover", onPress: () => setTool({ kind: "cover" }) }]
        : [];

  const frameFor = (item: ComposeMedia) => {
    const aspect = item.width / Math.max(1, item.height);
    const w = Math.min(screenWidth, stageHeight * aspect);
    return { w, h: w / aspect };
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {/* Drawn first, so the editor covers it: see PhotoBaker. */}
      <PhotoBaker ref={baker} screenWidth={screenWidth} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.cover} />
      </View>

      <View style={[styles.stage, { top: stageTop, height: stageHeight }]}>
        <FlatList
          ref={pager}
          data={media}
          keyExtractor={(m) => m.id}
          horizontal
          pagingEnabled
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
          renderItem={({ item, index: i }) => (
            <View style={{ width: screenWidth, height: stageHeight }}>
              {item.kind === "photo" ? (
                <PhotoPage
                  item={item}
                  frame={frameFor(item)}
                  trash={trash}
                  onTexts={(texts) => setTexts(item, texts)}
                  onEditText={(t) => setTool({ kind: "text", editing: t })}
                  onDrag={setDrag}
                />
              ) : (
                <VideoPage item={item} active={focused && i === index && tool === null} />
              )}
            </View>
          )}
        />

        {!drag.dragging ? (
          <>
            <View style={styles.topRow} pointerEvents="box-none">
              <GlassIconButton icon="chevron-back" label="Back" onPress={back} variant="media" size={40} iconSize={20} haptic={false} />
              {media.length > 1 ? (
                <View style={styles.counter}>
                  <Text style={styles.counterText}>
                    {index + 1} / {media.length}
                  </Text>
                </View>
              ) : null}
              <View style={{ width: 40 }} />
            </View>
            <View style={styles.rail} pointerEvents="box-none">
              {rail.map((r) => (
                <Pressable key={r.label} onPress={r.onPress} hitSlop={8} style={({ pressed }) => [styles.railButton, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={r.label}>
                  <View style={styles.railIcon}>
                    <Icon name={r.icon} sf={r.sf} size={24} weight="medium" color="#fff" />
                  </View>
                  <Text style={styles.railLabel}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Trash over={drag.over} y={stageHeight - 56} />
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: bottom }]} pointerEvents={drag.dragging ? "none" : "auto"}>
        {strip ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} style={styles.stripScroll}>
            {media.map((m, i) => (
              <Animated.View key={m.id} entering={reduceMotion ? undefined : ZoomIn.duration(180)} exiting={reduceMotion ? undefined : ZoomOut.duration(140)} layout={reduceMotion ? undefined : STRIP_MOVE}>
              <Pressable onPress={() => go(i)} style={[styles.thumb, i === index && styles.thumbOn]} accessibilityRole="button" accessibilityLabel={`${m.kind === "video" ? "Video" : "Photo"} ${i + 1}`} accessibilityState={{ selected: i === index }}>
                <Image source={{ uri: m.kind === "video" ? (m.thumbUri ?? undefined) : m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {m.kind === "video" ? <Text style={styles.thumbClock}>{clock(m.duration)}</Text> : null}
                {i === index ? (
                  <Pressable onPress={() => remove(m)} hitSlop={8} style={styles.thumbRemove} accessibilityRole="button" accessibilityLabel="Remove from the post">
                    <Icon name="close" size={10} weight="bold" color="#fff" />
                  </Pressable>
                ) : null}
              </Pressable>
              </Animated.View>
            ))}
            {room.photos + room.videos > 0 ? (
              <Animated.View layout={reduceMotion ? undefined : STRIP_MOVE}>
                <Pressable onPress={addMore} style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add more">
                  <Icon name="add" size={22} weight="semibold" color="#fff" />
                </Pressable>
              </Animated.View>
            ) : null}
          </ScrollView>
        ) : null}
        <View style={styles.actions}>
          <DarkButton title="Save draft" icon="archive-outline" sf="archivebox" busy={working === "draft"} onPress={() => void finish("draft")} />
          <View style={{ flex: 1 }}>
            <Button title="Next" size="large" loading={working === "next"} disabled={working !== null || media.length === 0} onPress={() => void finish("next")} />
          </View>
        </View>
      </View>

      {tool?.kind === "text" && current?.kind === "photo" ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={StyleSheet.absoluteFill}>
          <TextEditor
            initial={tool.editing}
            frameWidth={frameFor(current).w}
            onDone={(next) => {
              const others = current.texts.filter((t) => t.id !== tool.editing?.id);
              setTexts(current, next ? (tool.editing ? current.texts.map((t) => (t.id === next.id ? next : t)) : [...others, next]) : others);
              setTool(null);
            }}
          />
        </Animated.View>
      ) : null}
      {tool?.kind === "crop" && current?.kind === "photo" ? (
        <CropEditor
          item={current}
          onCancel={() => setTool(null)}
          onDone={(next) => {
            compose.replace(current.id, { ...next, uri: next.baseUri });
            setTool(null);
          }}
        />
      ) : null}
      {tool?.kind === "cover" && current?.kind === "video" ? (
        <CoverPicker
          item={current}
          onCancel={() => setTool(null)}
          onDone={(next) => {
            compose.replace(current.id, next);
            setTool(null);
          }}
        />
      ) : null}

      <GallerySheet
        visible={galleryOpen}
        mode={s.mode}
        room={room}
        onClose={() => setGalleryOpen(false)}
        onPicked={(items) => {
          const before = media.length;
          if (compose.add(items) > 0) setTimeout(() => go(Math.min(before, compose.get().media.length - 1)), 50);
          setGalleryOpen(false);
        }}
      />
    </View>
  );
}

/** A photo on the stage: a blurred copy of itself behind, the photo at its own shape in the middle, its texts on top. */
function PhotoPage({ item, frame, trash, onTexts, onEditText, onDrag }: { item: ComposeMedia; frame: { w: number; h: number }; trash: { x: number; y: number }; onTexts: (texts: TextOverlay[]) => void; onEditText: (t: TextOverlay) => void; onDrag: (state: { dragging: boolean; over: boolean }) => void }) {
  return (
    <View style={styles.page}>
      <Image source={{ uri: item.baseUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={0} />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <View style={{ width: frame.w, height: frame.h }}>
        <Image source={{ uri: item.baseUri }} style={StyleSheet.absoluteFill} contentFit="fill" transition={0} accessibilityLabel="Your photo" />
        {item.texts.map((t) => (
          <DraggableText
            key={t.id}
            overlay={t}
            width={frame.w}
            height={frame.h}
            trash={trash}
            onChange={(next) => onTexts(item.texts.map((x) => (x.id === next.id ? next : x)))}
            onEdit={() => onEditText(t)}
            onDelete={() => onTexts(item.texts.filter((x) => x.id !== t.id))}
            onDrag={onDrag}
          />
        ))}
      </View>
    </View>
  );
}

/** A video on the stage, playing on a loop with its sound while it is the one showing; a tap pauses it. */
function VideoPage({ item, active }: { item: ComposeMedia; active: boolean }) {
  const [paused, setPaused] = useState(false);
  const player = useVideoPlayer({ uri: item.uri }, (p) => {
    p.loop = true;
  });
  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);
  return (
    <Pressable style={styles.page} onPress={() => setPaused((p) => !p)} accessibilityRole="button" accessibilityLabel={paused ? "Play" : "Pause"}>
      {item.thumbUri ? <Image source={{ uri: item.thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} /> : null}
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} />
      {paused ? (
        <View style={styles.paused} pointerEvents="none">
          <Icon name="play" size={44} color="rgba(255,255,255,0.9)" />
        </View>
      ) : null}
    </Pressable>
  );
}

/** The bin a text is dragged onto: it grows and turns red under the finger. */
function Trash({ over, y }: { over: boolean; y: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(over ? 1.25 : 1, motion.snappy) }], backgroundColor: over ? "#ff453a" : "rgba(0,0,0,0.45)" }), [over]);
  return (
    <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} pointerEvents="none" style={[styles.trash, { top: y - 26 }, style]}>
      <Icon name="trash-outline" size={24} color="#fff" />
    </Animated.View>
  );
}

/** A capsule on the dark editor: TikTok's grey "Your Story" place, here Save draft. */
function DarkButton({ title, icon, sf, busy, onPress }: { title: string; icon: IconName; sf: SFSymbol; busy?: boolean; onPress: () => void }) {
  const press = usePressScale();
  return (
    <AnimatedPressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }} style={[styles.dark, { opacity: press.opacity, transform: [{ scale: press.scale }] }]}>
      <Icon name={icon} sf={sf} size={18} weight="semibold" color="#fff" />
      <Text style={styles.darkText}>{busy ? "Saving…" : title}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  cover: { flex: 1, backgroundColor: "#000" },
  stage: { position: "absolute", left: 0, right: 0, borderRadius: 22, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#0b0b0f" },
  page: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dim: { backgroundColor: "rgba(0,0,0,0.35)" },
  topRow: { position: "absolute", top: 14, left: 12, right: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counter: { paddingHorizontal: 10, height: 26, borderRadius: 13, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  counterText: { color: "#fff", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rail: { position: "absolute", top: 70, right: 8, gap: 14, alignItems: "center" },
  railButton: { alignItems: "center", gap: 3, minWidth: 52 },
  railIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.32)" },
  railLabel: { color: "#fff", fontSize: 11, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  paused: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  trash: { position: "absolute", alignSelf: "center", width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.8)" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 10 },
  stripScroll: { flexGrow: 0 },
  strip: { gap: 8, alignItems: "center", height: STRIP, paddingHorizontal: 2 },
  thumb: { width: 44, height: 58, borderRadius: 8, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#222", opacity: 0.7 },
  thumbOn: { opacity: 1, borderWidth: 2, borderColor: "#fff" },
  thumbClock: { position: "absolute", left: 3, bottom: 2, color: "#fff", fontSize: 9, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  thumbRemove: { position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  add: { width: 44, height: 58, borderRadius: 8, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  actions: { flexDirection: "row", gap: 10, height: ACTIONS, alignItems: "center" },
  dark: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 50, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.14)" },
  darkText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
