import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { KeyboardAvoidingView, NativeModules, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TurboModuleRegistry, View, type ViewInstance } from "react-native";
import { Image } from "expo-image";
import { captureRef } from "react-native-view-shot";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { hapticSelect, hapticTap } from "@/lib/haptics";
import { localId, type ComposeMedia, type TextOverlay } from "@/lib/compose-store";

/**
 * Whether this build can draw texts into photos (react-native-view-shot's native side: Expo Go and builds made since it
 * was added have it). Without it the editor offers no Text tool rather than one that fails at Next.
 */
export const CAN_BAKE_TEXT = (() => {
  try {
    return Boolean(TurboModuleRegistry.get("RNViewShot") ?? NativeModules.RNViewShot);
  } catch {
    return false;
  }
})();

/** The colours a text can take, white first: the brand's Aurora stops among the usual bright set. */
export const TEXT_COLORS = ["#ffffff", "#000000", "#166fe5", "#2cc6ea", "#8250ea", "#ff375f", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158"] as const;

/**
 * Sizes are shares of the photo's width, never points: the same text drawn over the editor's photo (a phone's width)
 * and over the baker's (1080 pixels) wraps and sits exactly alike.
 */
const FONT = 0.072;
const WRAP = 0.84;

function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

/** The words themselves, as they look over the photo (no gestures): used by the editor and by the baker. */
export function TextBox({ overlay, frameWidth }: { overlay: Pick<TextOverlay, "text" | "color" | "style">; frameWidth: number }) {
  const filled = overlay.style === "filled";
  return (
    <View style={[{ maxWidth: frameWidth * WRAP }, filled && { backgroundColor: overlay.color, borderRadius: frameWidth * 0.024, paddingHorizontal: frameWidth * 0.03, paddingVertical: frameWidth * 0.012 }]}>
      <Text
        style={{
          fontSize: frameWidth * FONT,
          lineHeight: frameWidth * FONT * 1.2,
          fontWeight: "800",
          textAlign: "center",
          color: filled ? onColor(overlay.color) : overlay.color,
          ...(filled ? null : { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: frameWidth * 0.012, textShadowOffset: { width: 0, height: frameWidth * 0.003 } }),
        }}
      >
        {overlay.text}
      </Text>
    </View>
  );
}

/** A text over the photo as it will be baked: centred on (x, y) of the frame, at its scale. */
export function PlacedText({ overlay, width, height }: { overlay: TextOverlay; width: number; height: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, { transform: [{ translateX: (overlay.x - 0.5) * width }, { translateY: (overlay.y - 0.5) * height }, { scale: overlay.scale }] }]}>
      <TextBox overlay={overlay} frameWidth={width} />
    </View>
  );
}

/**
 * A text on the editor's photo that the finger moves: drag it anywhere, pinch it bigger or smaller, tap it to change it.
 * Dragged onto the bin at the bottom (`trash`, in screen points) it goes. `onDrag` tells the editor a drag is on, so it
 * can show the bin and hide everything else, and whether the finger is over it.
 */
export function DraggableText({ overlay, width, height, trash, onChange, onEdit, onDelete, onDrag }: { overlay: TextOverlay; width: number; height: number; trash: { x: number; y: number }; onChange: (next: TextOverlay) => void; onEdit: () => void; onDelete: () => void; onDrag: (state: { dragging: boolean; over: boolean }) => void }) {
  const tx = useSharedValue((overlay.x - 0.5) * width);
  const ty = useSharedValue((overlay.y - 0.5) * height);
  const sc = useSharedValue(overlay.scale);
  const start = useSharedValue({ x: 0, y: 0, s: 1 });
  const over = useSharedValue(false);

  const commit = useCallback(
    (x: number, y: number, s: number, deleted: boolean) => {
      onDrag({ dragging: false, over: false });
      if (deleted) return onDelete();
      onChange({ ...overlay, x: Math.min(1, Math.max(0, 0.5 + x / width)), y: Math.min(1, Math.max(0, 0.5 + y / height)), scale: s });
    },
    [onChange, onDelete, onDrag, overlay, width, height],
  );
  const changed = useCallback((dragging: boolean, isOver: boolean) => {
    if (isOver) hapticSelect();
    onDrag({ dragging, over: isOver });
  }, [onDrag]);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      start.value = { x: tx.value, y: ty.value, s: sc.value };
      runOnJS(changed)(true, false);
    })
    .onUpdate((e) => {
      tx.value = Math.min(width / 2, Math.max(-width / 2, start.value.x + e.translationX));
      ty.value = Math.min(height / 2 + 60, Math.max(-height / 2, start.value.y + e.translationY));
      const isOver = Math.abs(e.absoluteX - trash.x) < 48 && Math.abs(e.absoluteY - trash.y) < 48;
      if (isOver !== over.value) {
        over.value = isOver;
        runOnJS(changed)(true, isOver);
      }
    })
    .onEnd(() => {
      const deleted = over.value;
      over.value = false;
      runOnJS(commit)(tx.value, ty.value, sc.value, deleted);
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = { x: tx.value, y: ty.value, s: sc.value };
    })
    .onUpdate((e) => {
      sc.value = Math.min(4, Math.max(0.4, start.value.s * e.scale));
    })
    .onEnd(() => {
      runOnJS(commit)(tx.value, ty.value, sc.value, false);
    });
  const tap = Gesture.Tap().onEnd(() => runOnJS(onEdit)());

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: over.value ? sc.value * 0.6 : sc.value }], opacity: over.value ? 0.6 : 1 }));

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, tap)}>
        <Animated.View style={style} accessibilityRole="button" accessibilityLabel={`Text: ${overlay.text}`} accessibilityHint="Tap to edit. Drag to move.">
          <TextBox overlay={overlay} frameWidth={width} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Writing or changing a text, over the dimmed editor: the words in the middle as they'll look, the style switch (plain
 * or on a block of colour) and Done at the top, the colours over the keyboard. Done with nothing written removes it.
 */
export function TextEditor({ initial, frameWidth, onDone }: { initial: TextOverlay | null; frameWidth: number; onDone: (next: TextOverlay | null) => void }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initial?.text ?? "");
  const [color, setColor] = useState<string>(initial?.color ?? TEXT_COLORS[0]);
  const [style, setStyle] = useState<TextOverlay["style"]>(initial?.style ?? "plain");
  const filled = style === "filled";
  const finish = () => {
    const words = text.trim();
    if (!words) return onDone(null);
    onDone({ id: initial?.id ?? localId("t"), text: words, color, style, x: initial?.x ?? 0.5, y: initial?.y ?? 0.42, scale: initial?.scale ?? 1 });
  };
  return (
    <View style={[StyleSheet.absoluteFill, styles.editor]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.editorTop, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={() => {
              hapticTap();
              setStyle(filled ? "plain" : "filled");
            }}
            hitSlop={10}
            style={[styles.styleButton, filled && styles.styleButtonOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: filled }}
            accessibilityLabel="Text background"
          >
            <Icon name="text-outline" sf="textformat" size={20} weight="semibold" color={filled ? "#000" : "#fff"} />
          </Pressable>
          <Pressable onPress={finish} hitSlop={10} accessibilityRole="button" style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <Pressable style={styles.editorMiddle} onPress={finish} accessible={false}>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            multiline
            maxLength={160}
            keyboardAppearance="dark"
            placeholder="Type something"
            placeholderTextColor="rgba(255,255,255,0.45)"
            selectionColor={filled ? onColor(color) : color === "#000000" ? "#ffffff" : color}
            accessibilityLabel="Text on the photo"
            style={[
              styles.input,
              { fontSize: frameWidth * FONT, maxWidth: frameWidth * WRAP, color: filled ? onColor(color) : color },
              filled ? { backgroundColor: color, borderRadius: frameWidth * 0.024, paddingHorizontal: frameWidth * 0.03 } : styles.inputShadow,
            ]}
          />
        </Pressable>
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches} style={{ flexGrow: 0 }}>
          {TEXT_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                hapticSelect();
                setColor(c);
              }}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: c === color }}
              accessibilityLabel={`Colour ${c}`}
              style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchOn]}
            />
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export type PhotoBakerHandle = { bake: (item: ComposeMedia) => Promise<string> };

/** How wide a baked photo comes out, in pixels: what feeds show photos at. */
const BAKE_WIDTH = 1080;

/**
 * Draws a photo's texts into it: the photo and its texts are laid out once more, out of sight behind the editor (the
 * capture draws the view itself, not the screen, so being covered doesn't matter), and captured as a JPEG 1080 pixels
 * wide. `bake` resolves with the new file once the picture under the words has been drawn.
 */
export const PhotoBaker = forwardRef<PhotoBakerHandle, { screenWidth: number }>(function PhotoBaker({ screenWidth }, ref) {
  const [job, setJob] = useState<{ item: ComposeMedia; resolve: (uri: string) => void; reject: (e: unknown) => void } | null>(null);
  const view = useRef<ViewInstance>(null);
  const shot = useRef(false);

  useImperativeHandle(ref, () => ({
    bake: (item) =>
      new Promise<string>((resolve, reject) => {
        shot.current = false;
        setJob({ item, resolve, reject });
      }),
  }));

  if (!job) return null;
  const { item } = job;
  const width = Math.min(screenWidth, BAKE_WIDTH / PixelRatio.get());
  const height = width * (item.height / Math.max(1, item.width));
  const capture = () => {
    if (shot.current) return;
    shot.current = true;
    // Two frames after the picture reports it is on screen, so the words and the picture are both drawn.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // view-shot's width and height are points (it multiplies by the screen's scale): BAKE_WIDTH pixels is this many.
        captureRef(view, { format: "jpg", quality: 0.92, result: "tmpfile", width: BAKE_WIDTH / PixelRatio.get(), height: (BAKE_WIDTH / PixelRatio.get()) * (item.height / Math.max(1, item.width)) })
          .then((uri) => {
            setJob(null);
            job.resolve(uri.startsWith("file://") ? uri : `file://${uri}`);
          })
          .catch((e) => {
            setJob(null);
            job.reject(e);
          });
      }),
    );
  };
  return (
    <View pointerEvents="none" style={styles.bakerHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View ref={view} collapsable={false} style={{ width, height, backgroundColor: "#000" }}>
        <Image source={{ uri: item.baseUri }} style={StyleSheet.absoluteFill} contentFit="fill" onDisplay={capture} onError={() => job.reject(new Error("Couldn't draw the photo"))} />
        {item.texts.map((t) => (
          <PlacedText key={t.id} overlay={t} width={width} height={height} />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  editor: { backgroundColor: "rgba(0,0,0,0.78)" },
  editorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  styleButton: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  styleButtonOn: { backgroundColor: "#fff" },
  done: { paddingHorizontal: 6, paddingVertical: 8 },
  doneText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  editorMiddle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  input: { fontWeight: "800", textAlign: "center", paddingVertical: 6, minWidth: 40 },
  inputShadow: { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  swatches: { gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  swatchOn: { transform: [{ scale: 1.2 }], borderWidth: 3, borderColor: "#fff" },
  bakerHolder: { position: "absolute", top: 0, left: 0 },
});
