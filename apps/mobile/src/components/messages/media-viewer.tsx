import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** One photo or video in the viewer. `cacheKey` (the storage path) lets a fresh signed URL reuse the cached photo. */
export type MediaViewerItem = { kind: "image" | "video"; uri: string; cacheKey?: string };

const DOUBLE_TAP_MS = 280;
const MAX_ZOOM = 4;
/** How far a double tap zooms in. */
const TAP_ZOOM = 2.5;
const TOP_BAR = 52;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Full-screen dark viewer for a message's photos and videos: swipe between them, pinch or double tap to zoom a photo,
 * videos play with the system controls, and the close button (or Android's back) returns to the chat.
 */
export function MediaViewer({ visible, items, index, onClose }: { visible: boolean; items: MediaViewerItem[]; index: number; onClose: () => void }) {
  // Keep showing what was open while the modal fades out, even if the caller already cleared `items`. The viewer starts
  // over (at `index`) each time it opens or gets different media, never just because the caller rendered again.
  const shown = useRef<{ items: MediaViewerItem[]; index: number; key: number; signature: string }>({ items: [], index: 0, key: 0, signature: "" });
  const wasVisible = useRef(false);
  const open = visible && items.length > 0;
  const signature = open ? items.map((m) => `${m.kind}:${m.cacheKey ?? m.uri}`).join("|") : "";
  if (open && (!wasVisible.current || shown.current.signature !== signature)) shown.current = { items, index, key: shown.current.key + 1, signature };
  wasVisible.current = open;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait"]}>
      {shown.current.items.length > 0 ? <ViewerBody key={shown.current.key} items={shown.current.items} index={shown.current.index} onClose={onClose} /> : null}
    </Modal>
  );
}

function ViewerBody({ items, index, onClose }: { items: MediaViewerItem[]; index: number; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const start = clamp(Math.round(index) || 0, 0, items.length - 1);
  const [current, setCurrent] = useState(start);
  const [zoomed, setZoomed] = useState(false);

  function onPageEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = clamp(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)), 0, items.length - 1);
    if (page !== current) {
      setCurrent(page);
      setZoomed(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <FlatList
        data={items}
        horizontal
        pagingEnabled
        // A zoomed photo pans instead of turning the page; zoom back out (double tap or pinch) to swipe on.
        scrollEnabled={items.length > 1 && !zoomed}
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(item, i) => `${i}-${item.cacheKey ?? item.uri}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPageEnd}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        renderItem={({ item, index: i }) => (
          <View style={{ width, height }}>
            {item.kind === "video" ? (
              <VideoPage uri={item.uri} active={i === current} width={width} height={height - insets.top - TOP_BAR - insets.bottom} top={insets.top + TOP_BAR} />
            ) : Platform.OS === "ios" ? (
              <NativeZoomPhoto item={item} width={width} height={height} onZoomChange={setZoomed} />
            ) : (
              <TouchZoomPhoto item={item} width={width} height={height} onZoomChange={setZoomed} />
            )}
          </View>
        )}
      />
      <View style={[styles.top, { paddingTop: insets.top + 6, pointerEvents: "box-none" }]}>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
          <Ionicons name="close" size={24} color={colors.onMedia} />
        </Pressable>
        {items.length > 1 ? (
          <View style={styles.counter} accessibilityLabel={`${current + 1} of ${items.length}`}>
            <Text style={styles.counterText}>
              {current + 1} / {items.length}
            </Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

/** The photo itself, letterboxed, with a spinner until it has loaded. */
function Photo({ item, width, height }: { item: MediaViewerItem; width: number; height: number }) {
  const colors = useColors();
  const [loading, setLoading] = useState(true);
  return (
    <View style={{ width, height }}>
      <Image
        source={{ uri: item.uri, cacheKey: item.cacheKey }}
        style={{ width, height }}
        contentFit="contain"
        transition={150}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        accessibilityLabel="Photo"
      />
      {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.onMedia} /> : null}
    </View>
  );
}

/** iPhone: the system's own zooming scroll view (pinch, pan, bounce), plus double tap to zoom in or out. */
function NativeZoomPhoto({ item, width, height, onZoomChange }: { item: MediaViewerItem; width: number; height: number; onZoomChange: (zoomed: boolean) => void }) {
  const ref = useRef<ScrollView>(null);
  const zoomed = useRef(false);
  const lastTap = useRef(0);

  function track(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const z = (e.nativeEvent.zoomScale ?? 1) > 1.01;
    if (z !== zoomed.current) {
      zoomed.current = z;
      onZoomChange(z);
    }
  }

  function tap(e: GestureResponderEvent) {
    const now = Date.now();
    if (now - lastTap.current > DOUBLE_TAP_MS) {
      lastTap.current = now;
      return;
    }
    lastTap.current = 0;
    if (zoomed.current) {
      ref.current?.scrollResponderZoomTo({ x: 0, y: 0, width, height, animated: true });
      return;
    }
    // Zoom in around the tapped point.
    const { locationX, locationY } = e.nativeEvent;
    const w = width / TAP_ZOOM;
    const h = height / TAP_ZOOM;
    ref.current?.scrollResponderZoomTo({ x: clamp(locationX - w / 2, 0, width - w), y: clamp(locationY - h / 2, 0, height - h), width: w, height: h, animated: true });
  }

  return (
    <ScrollView
      ref={ref}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      minimumZoomScale={1}
      maximumZoomScale={MAX_ZOOM}
      pinchGestureEnabled
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={track}
      onScrollEndDrag={track}
    >
      <Pressable onPress={tap} accessibilityHint="Double tap to zoom">
        <Photo item={item} width={width} height={height} />
      </Pressable>
    </ScrollView>
  );
}

type Touch = { pageX: number; pageY: number };
const distance = (a: Touch, b: Touch) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

/**
 * Android and the web: two fingers pinch, one finger pans a zoomed photo, double tap zooms in or out. Built on the
 * responder system so the pager underneath stops scrolling while a finger is on the photo.
 */
function TouchZoomPhoto({ item, width, height, onZoomChange }: { item: MediaViewerItem; width: number; height: number; onZoomChange: (zoomed: boolean) => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const s = useRef({ scale: 1, x: 0, y: 0, startScale: 1, startX: 0, startY: 0, startDistance: 0, zoomed: false }).current;
  const lastTap = useRef(0);
  const notify = useRef(onZoomChange);
  notify.current = onZoomChange;

  const keepInside = () => {
    const maxX = (width * (s.scale - 1)) / 2;
    const maxY = (height * (s.scale - 1)) / 2;
    s.x = clamp(s.x, -maxX, maxX);
    s.y = clamp(s.y, -maxY, maxY);
  };
  const setZoomed = (z: boolean) => {
    if (z === s.zoomed) return;
    s.zoomed = z;
    notify.current(z);
  };
  const animateTo = (toScale: number, toX: number, toY: number) => {
    s.scale = toScale;
    s.x = toX;
    s.y = toY;
    Animated.parallel([
      Animated.spring(scale, { toValue: toScale, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(x, { toValue: toX, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(y, { toValue: toY, useNativeDriver: true, bounciness: 0 }),
    ]).start();
    setZoomed(toScale > 1.01);
  };

  const responder = useRef(
    PanResponder.create({
      // Taps stay with the photo (double tap); a second finger, or a drag on a zoomed photo, takes over.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (e, g) => e.nativeEvent.touches.length >= 2 || (s.zoomed && Math.abs(g.dx) + Math.abs(g.dy) > 4),
      onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length >= 2 || (s.zoomed && Math.abs(g.dx) + Math.abs(g.dy) > 4),
      onPanResponderGrant: () => {
        s.startScale = s.scale;
        s.startX = s.x;
        s.startY = s.y;
        s.startDistance = 0;
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches as unknown as Touch[];
        if (touches.length >= 2) {
          const d = distance(touches[0], touches[1]);
          if (!s.startDistance) {
            s.startDistance = d;
            s.startScale = s.scale;
          }
          s.scale = clamp((s.startScale * d) / Math.max(s.startDistance, 1), 1, MAX_ZOOM);
        } else if (s.zoomed || s.scale > 1.01) {
          s.x = s.startX + g.dx;
          s.y = s.startY + g.dy;
        }
        keepInside();
        scale.setValue(s.scale);
        x.setValue(s.x);
        y.setValue(s.y);
      },
      onPanResponderRelease: () => {
        if (s.scale < 1.05) animateTo(1, 0, 0);
        else setZoomed(true);
      },
      onPanResponderTerminate: () => {
        if (s.scale < 1.05) animateTo(1, 0, 0);
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    }),
  ).current;

  useEffect(() => () => notify.current(false), []);

  function tap() {
    const now = Date.now();
    if (now - lastTap.current > DOUBLE_TAP_MS) {
      lastTap.current = now;
      return;
    }
    lastTap.current = 0;
    if (s.scale > 1.01) animateTo(1, 0, 0);
    else animateTo(TAP_ZOOM, 0, 0);
  }

  return (
    <View style={{ width, height, overflow: "hidden" }} {...responder.panHandlers}>
      <Animated.View style={{ width, height, transform: [{ translateX: x }, { translateY: y }, { scale }] }}>
        <Pressable onPress={tap} accessibilityHint="Double tap to zoom">
          <Photo item={item} width={width} height={height} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A video with the system controls; it plays while its page is the one showing. */
function VideoPage({ uri, active, width, height, top }: { uri: string; active: boolean; width: number; height: number; top: number }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return (
    <View style={{ width, height: height + top, paddingTop: top }}>
      <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls fullscreenOptions={{ enable: false }} allowsPictureInPicture={false} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.mediaBg },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
  counter: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.mediaPill },
  counterText: { color: colors.onMedia, fontSize: 13, fontWeight: "700" },
  spacer: { width: 40 },
}));
