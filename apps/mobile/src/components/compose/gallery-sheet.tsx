import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library/legacy";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Icon } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { clock, itemsFromAssets, pickWithSystemPicker } from "@/lib/compose-media";
import { REEL_MAX_SECONDS, type ComposeMedia, type ComposeMode } from "@/lib/compose-store";
import { hapticSelect } from "@/lib/haptics";
import { auroraGradient, motion, radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

type Filter = "all" | "video" | "photo";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Videos" },
  { value: "photo", label: "Photos" },
];
const PAGE = 60;
/** A pick's number disc arriving: a quick, barely-there spring from small to full size. */
const POP = ZoomIn.springify().damping(15).stiffness(320).mass(0.6);
/** Picks in the tray making room for each other. */
const TRAY_MOVE = LinearTransition.springify().damping(30).stiffness(320);
const COLUMNS = 3;
const GAP = 2;
/** Grid cells are a little taller than wide, as on TikTok: phone photos and videos are mostly upright. */
const CELL_ASPECT = 3 / 4;

type Album = { id: string | null; title: string; count: number; cover: string | null };
type Access = "unknown" | "all" | "limited" | "denied" | "unavailable";

/**
 * The create flow's photo library, TikTok's "Recents" sheet: the phone's photos and videos newest first in a grid of
 * upright cells, filtered by All | Videos | Photos (a reel shows videos only) and by album from the title. Tapping a
 * cell picks it (numbered in the order picked, up to what the post has room for); the picks line up along the bottom
 * over Next, which turns them into files and hands them to `onPicked`. With limited access iOS's own "select more"
 * picker is one tap away; without access, or where this build can't read the library (Expo Go on Android), the system
 * photo picker stands in.
 */
export function GallerySheet({ visible, mode, room, onClose, onDismiss, onPicked }: { visible: boolean; mode: ComposeMode; room: { photos: number; videos: number }; onClose: () => void; onDismiss?: () => void; onPicked: (items: ComposeMedia[]) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [access, setAccess] = useState<Access>("unknown");
  const [filter, setFilter] = useState<Filter>(mode === "reel" ? "video" : "all");
  const [album, setAlbum] = useState<Album>({ id: null, title: "Recents", count: 0, cover: null });
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [choosingAlbum, setChoosingAlbum] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [end, setEnd] = useState<{ after?: string; more: boolean }>({ more: true });
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<MediaLibrary.Asset[]>([]);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const request = useRef(0);

  const onlyVideos = mode === "reel" || room.photos === 0;
  const onlyPhotos = mode !== "reel" && room.videos === 0;
  const shownFilter: Filter = onlyVideos ? "video" : onlyPhotos ? "photo" : filter;
  const maxPicks = mode === "reel" ? 1 : room.photos + room.videos;

  // Ask for the library when the sheet opens (once: iOS remembers the answer), and start empty-handed each time.
  useEffect(() => {
    if (!visible) return;
    setPicked([]);
    setChoosingAlbum(false);
    let active = true;
    (async () => {
      try {
        let permission = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
        if (permission.status === "undetermined" || (!permission.granted && permission.canAskAgain)) permission = await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
        if (!active) return;
        setAccess(!permission.granted ? "denied" : permission.accessPrivileges === "limited" ? "limited" : "all");
      } catch {
        if (active) setAccess("unavailable");
      }
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  const load = useCallback(
    async (reset: boolean) => {
      if (access !== "all" && access !== "limited") return;
      const id = reset ? ++request.current : request.current;
      setLoading(true);
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: PAGE,
          after: reset ? undefined : end.after,
          album: album.id ?? undefined,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
          mediaType: shownFilter === "video" ? [MediaLibrary.MediaType.video] : shownFilter === "photo" ? [MediaLibrary.MediaType.photo] : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        });
        if (id !== request.current) return;
        setAssets((list) => (reset ? page.assets : [...list, ...page.assets]));
        setEnd({ after: page.endCursor, more: page.hasNextPage });
      } catch {
        if (id === request.current) setAccess("unavailable");
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [access, album.id, end.after, shownFilter],
  );

  // A new filter or album starts the grid over.
  useEffect(() => {
    if (visible && (access === "all" || access === "limited")) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, access, album.id, shownFilter]);

  // The phone's albums, read the first time the title is tapped.
  async function openAlbums() {
    setChoosingAlbum((open) => !open);
    if (albums) return;
    try {
      const all = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      const withItems = all.filter((a) => a.assetCount > 0).slice(0, 40);
      const covers = await Promise.all(
        withItems.map((a) =>
          MediaLibrary.getAssetsAsync({ album: a, first: 1, sortBy: [[MediaLibrary.SortBy.creationTime, false]], mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] })
            .then((p) => p.assets[0]?.uri ?? null)
            .catch(() => null),
        ),
      );
      setAlbums([{ id: null, title: "Recents", count: 0, cover: assets[0]?.uri ?? null }, ...withItems.map((a, i) => ({ id: a.id, title: a.title, count: a.assetCount, cover: covers[i] }))]);
    } catch {
      setAlbums([{ id: null, title: "Recents", count: 0, cover: null }]);
    }
  }

  const tooLong = (a: MediaLibrary.Asset) => mode === "reel" && a.mediaType === "video" && a.duration > REEL_MAX_SECONDS;
  const pickedPhotos = picked.filter((a) => a.mediaType === "photo").length;
  const pickedVideos = picked.filter((a) => a.mediaType === "video").length;
  const canTake = (a: MediaLibrary.Asset) => (a.mediaType === "video" ? pickedVideos < room.videos : pickedPhotos < room.photos);

  const toggle = useCallback(
    (a: MediaLibrary.Asset) => {
      const index = picked.findIndex((p) => p.id === a.id);
      if (index >= 0) {
        hapticSelect();
        setPicked(picked.filter((p) => p.id !== a.id));
        return;
      }
      if (tooLong(a)) {
        Alert.alert("Too long for a reel", `Reels can be up to ${REEL_MAX_SECONDS / 60} minutes. Choose a shorter video.`);
        return;
      }
      // A reel is one video: picking another swaps it.
      if (mode === "reel") {
        hapticSelect();
        setPicked([a]);
        return;
      }
      if (!canTake(a)) {
        Alert.alert(a.mediaType === "video" ? "One video per post" : "That's the most photos", a.mediaType === "video" ? (room.videos === 0 ? "This post already has its video." : "A post can have one video. Unselect it to choose another.") : `You can add ${room.photos === 1 ? "one more photo" : `${room.photos} more photos`} to this post.`);
        return;
      }
      hapticSelect();
      setPicked([...picked, a]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, mode, room.photos, room.videos],
  );

  async function next() {
    if (picked.length === 0 || preparing) return;
    setPreparing({ done: 0, total: picked.length });
    const { items, failed } = await itemsFromAssets(picked, (done) => setPreparing({ done, total: picked.length }));
    setPreparing(null);
    if (failed > 0) Alert.alert(failed === 1 ? "One item couldn't be added" : `${failed} items couldn't be added`, "It may still be downloading from iCloud. Try it again in a moment.");
    if (items.length > 0) onPicked(items);
  }

  async function systemPicker() {
    try {
      const items = await pickWithSystemPicker(mode, room);
      if (items.length > 0) onPicked(items);
    } catch (e) {
      Alert.alert("Couldn't open your photos", e instanceof Error ? e.message : "Please try again.");
    }
  }

  const cell = gridWidth > 0 ? (gridWidth - GAP * (COLUMNS - 1)) / COLUMNS : 0;
  const order = useMemo(() => new Map(picked.map((a, i) => [a.id, i + 1])), [picked]);
  const full = mode !== "reel" && picked.length >= maxPicks;

  const title = (
    <Pressable onPress={() => void openAlbums()} disabled={access !== "all" && access !== "limited"} style={({ pressed }) => [styles.albumPill, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${album.title}, choose an album`} hitSlop={6}>
      <Text style={styles.albumTitle} numberOfLines={1}>
        {album.title}
      </Text>
      <Icon name={choosingAlbum ? "chevron-up" : "chevron-down"} size={15} weight="semibold" color={colors.text} />
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close your photos" height="94%">
      <SheetHeader titleNode={title} divider={false} />
      {!onlyVideos && !onlyPhotos && access !== "denied" && access !== "unavailable" ? <FilterTabs value={filter} onChange={setFilter} /> : null}
      {access === "limited" ? (
        <Pressable
          onPress={() => void MediaLibrary.presentPermissionsPickerAsync(["photo", "video"]).then(() => load(true)).catch(() => {})}
          style={({ pressed }) => [styles.limited, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
        >
          <Text style={styles.limitedText}>You've given UniBuzz access to some of your photos and videos.</Text>
          <Text style={styles.limitedAction}>Manage</Text>
        </Pressable>
      ) : null}

      <View style={styles.body} onLayout={(e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width)}>
        {access === "denied" || access === "unavailable" ? (
          <NoAccess denied={access === "denied"} onSystemPicker={() => void systemPicker()} />
        ) : choosingAlbum ? (
          <AlbumList
            albums={albums}
            current={album.id}
            onChoose={(a) => {
              setAlbum(a);
              setChoosingAlbum(false);
            }}
          />
        ) : access === "unknown" || (loading && assets.length === 0) ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : assets.length === 0 ? (
          <View style={styles.center}>
            <Icon name="images-outline" size={34} color={colors.faint} />
            <Text style={styles.emptyText}>{shownFilter === "video" ? "No videos here yet" : shownFilter === "photo" ? "No photos here yet" : "Nothing here yet"}</Text>
          </View>
        ) : cell > 0 ? (
          <FlatList
            data={assets}
            keyExtractor={(a) => a.id}
            numColumns={COLUMNS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, paddingBottom: 12 }}
            renderItem={({ item }) => (
              <GridCell asset={item} size={cell} order={order.get(item.id) ?? 0} dimmed={(full && !order.has(item.id)) || tooLong(item)} single={mode === "reel"} onPress={toggle} />
            )}
            onEndReached={() => {
              if (end.more && !loading) void load(false);
            }}
            onEndReachedThreshold={0.6}
            initialNumToRender={18}
            windowSize={7}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
          />
        ) : null}
      </View>

      <SheetFooter style={styles.footer}>
        {picked.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray} style={styles.trayScroll}>
            {picked.map((a) => (
              <Animated.View key={a.id} entering={reduceMotion ? undefined : FadeIn.duration(160)} exiting={reduceMotion ? undefined : FadeOut.duration(120)} layout={reduceMotion ? undefined : TRAY_MOVE} style={styles.trayItem}>
                <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={a.id} accessibilityIgnoresInvertColors />
                {a.mediaType === "video" ? <Text style={styles.trayClock}>{clock(a.duration)}</Text> : null}
                <Pressable onPress={() => toggle(a)} hitSlop={8} style={styles.trayRemove} accessibilityRole="button" accessibilityLabel="Remove from selection">
                  <Icon name="close" size={11} weight="bold" color="#fff" />
                </Pressable>
              </Animated.View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.hint}>{mode === "reel" ? "Choose one video, up to 3 minutes." : room.photos > 0 && room.videos > 0 ? `Choose up to ${room.photos} photos and a video.` : room.photos > 0 ? `Choose up to ${room.photos} photos.` : "Choose a video."}</Text>
        )}
        <Button
          title={preparing ? (preparing.total > 1 ? `Preparing ${Math.min(preparing.done + 1, preparing.total)} of ${preparing.total}…` : "Preparing…") : picked.length > 1 ? `Next (${picked.length})` : "Next"}
          size="large"
          disabled={picked.length === 0 || preparing !== null}
          onPress={() => void next()}
          accessibilityHint="Adds what you picked"
        />
      </SheetFooter>
    </Sheet>
  );
}

/** One square of the grid: the picture, a video's length, and the pick circle (its number once picked). */
const GridCell = memo(function GridCell({ asset, size, order, dimmed, single, onPress }: { asset: MediaLibrary.Asset; size: number; order: number; dimmed: boolean; single: boolean; onPress: (a: MediaLibrary.Asset) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduce = useReduceMotion();
  const on = order > 0;
  return (
    <Pressable
      onPress={() => onPress(asset)}
      style={{ width: size, height: size / CELL_ASPECT, opacity: dimmed ? 0.4 : 1 }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${asset.mediaType === "video" ? `Video, ${clock(asset.duration)}` : "Photo"}${on ? `, selected ${order}` : ""}`}
    >
      <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={asset.id} transition={0} accessibilityIgnoresInvertColors />
      {on ? <Animated.View entering={reduce ? undefined : FadeIn.duration(120)} style={styles.cellDim} /> : null}
      {asset.mediaType === "video" ? <Text style={styles.cellClock}>{clock(asset.duration)}</Text> : null}
      <View style={styles.pick}>
        {on ? (
          // Only the pick turning on moves: its disc pops in; one taken back is simply gone (see animate-only-what-turns-on).
          <Animated.View entering={reduce ? undefined : POP} style={[styles.pickOn, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.aurora, 135) }]}>
            {single ? <Icon name="checkmark" size={14} weight="bold" color="#fff" /> : <Text style={styles.pickNumber}>{order}</Text>}
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
  );
});

/** All | Videos | Photos, with one underline gliding to the choice. */
function FilterTabs({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [boxes, setBoxes] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const box = boxes[value];
    if (!box) return;
    if (reduce || !placed.current) {
      x.value = box.x;
      w.value = box.width;
    } else {
      x.value = withSpring(box.x, motion.snappy);
      w.value = withSpring(box.width, motion.snappy);
    }
    placed.current = true;
  }, [boxes, value, reduce, x, w]);
  const line = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {FILTERS.map((f) => (
        <Pressable
          key={f.value}
          onPress={() => onChange(f.value)}
          onLayout={(e) => {
            const { x: bx, width } = e.nativeEvent.layout;
            setBoxes((b) => (b[f.value]?.x === bx && b[f.value]?.width === width ? b : { ...b, [f.value]: { x: bx, width } }));
          }}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === f.value }}
        >
          <Text style={[styles.tabText, value === f.value && styles.tabTextOn]}>{f.label}</Text>
        </Pressable>
      ))}
      <Animated.View style={[styles.tabLine, line]} />
    </View>
  );
}

function AlbumList({ albums, current, onChoose }: { albums: Album[] | null; current: string | null; onChoose: (a: Album) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  if (!albums) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return (
    <FlatList
      data={albums}
      keyExtractor={(a) => a.id ?? "recents"}
      contentContainerStyle={{ paddingVertical: 6 }}
      renderItem={({ item }) => (
        <Pressable onPress={() => onChoose(item)} style={({ pressed }) => [styles.albumRow, pressed && { backgroundColor: colors.input }]} accessibilityRole="button" accessibilityState={{ selected: item.id === current }}>
          <View style={styles.albumCover}>{item.cover ? <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="images-outline" size={20} color={colors.faint} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.albumName} numberOfLines={1}>
              {item.title}
            </Text>
            {item.count > 0 ? <Text style={styles.albumCount}>{item.count.toLocaleString()}</Text> : null}
          </View>
          {item.id === current ? <Icon name="checkmark" size={18} weight="semibold" color={colors.brand} /> : null}
        </Pressable>
      )}
    />
  );
}

function NoAccess({ denied, onSystemPicker }: { denied: boolean; onSystemPicker: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.center, { paddingHorizontal: 32, gap: 10 }]}>
      <View style={styles.noAccessIcon}>
        <Icon name="images-outline" size={28} color={colors.brand} />
      </View>
      <Text style={styles.noAccessTitle}>{denied ? "Allow access to your photos" : "Choose from your photos"}</Text>
      <Text style={styles.noAccessBody}>{denied ? "UniBuzz shows your photos and videos here so you can post them. You can also pick a few without giving access." : "Pick the photos and videos to post from your phone's library."}</Text>
      <View style={{ gap: 8, alignSelf: "stretch", marginTop: 6 }}>
        <Button title="Choose from library" icon="images-outline" onPress={onSystemPicker} />
        {denied && Platform.OS === "ios" ? <Button title="Open Settings" variant="ghost" onPress={() => void Linking.openSettings()} /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontSize: 15, color: colors.muted },
  albumPill: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 4, paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.input, maxWidth: 220 },
  albumTitle: { fontSize: 16, fontWeight: "700", color: colors.text, flexShrink: 1 },
  tabs: { flexDirection: "row", paddingHorizontal: 16, gap: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { paddingVertical: 10 },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  tabTextOn: { color: colors.text },
  tabLine: { position: "absolute", left: 16, bottom: -0.5, height: 2.5, borderRadius: 2, backgroundColor: colors.text },
  limited: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.panel },
  limitedText: { flex: 1, fontSize: 13, lineHeight: 17, color: colors.muted },
  limitedAction: { fontSize: 14, fontWeight: "700", color: colors.brand },
  cellDim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  cellClock: { position: "absolute", right: 6, bottom: 5, color: "#fff", fontSize: 12, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  pick: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.95)", backgroundColor: "rgba(0,0,0,0.18)", alignItems: "center", justifyContent: "center" },
  pickOn: { position: "absolute", top: -1.5, left: -1.5, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pickNumber: { color: "#fff", fontSize: 13, fontWeight: "700" },
  footer: { gap: 10 },
  trayScroll: { flexGrow: 0 },
  tray: { gap: 8, paddingVertical: 2 },
  trayItem: { width: 52, height: 52, borderRadius: 10, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  trayClock: { position: "absolute", left: 4, bottom: 2, color: "#fff", fontSize: 10, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  trayRemove: { position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  albumRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  albumCover: { width: 54, height: 54, borderRadius: 8, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  albumName: { fontSize: 16, fontWeight: "600", color: colors.text },
  albumCount: { fontSize: 13, color: colors.muted, marginTop: 2 },
  noAccessIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  noAccessTitle: { fontSize: 18, fontWeight: "700", color: colors.text, textAlign: "center" },
  noAccessBody: { fontSize: 14, lineHeight: 19, color: colors.muted, textAlign: "center" },
}));
