import { createContext, memo, useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useIsFocused } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { muxPlaybackUrl, muxPosterUrl, type BuzzMedia } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { MediaViewer, type MediaViewerItem } from "@/components/messages/media-viewer";
import { VIDEO_AUDIO_MODE } from "@/lib/video-sound";
import { P, R } from "./ui";

/**
 * Whether the Buzz surface around the media is on screen (Home's Buzz page while it is the page shown, a thread while
 * it is on top). A video playing inline pauses when it is not, so nothing goes on talking behind another screen.
 */
export const BuzzMediaActive = createContext(true);

type Photo = Extract<BuzzMedia, { type: "image" }>;
type Video = Extract<BuzzMedia, { type: "video" }>;

const GAP = 2;

/** A picture keeps its own shape, between 3:4 and 16:9 (UniVerse's aspectOf). */
function aspectOf(m: { width: number | null; height: number | null }, fallback: number): number {
  if (m.width && m.height && m.width > 0 && m.height > 0) return Math.min(1.78, Math.max(0.75, m.width / m.height));
  return fallback;
}

/**
 * A buzz's photos or its one video (UniVerse's BuzzMediaView). Up to four photos in the 1 / 2 / 3 / 4 layouts, a tap
 * opening them full screen (swipe between them, pinch or double tap to zoom: the app's media viewer); or one video, its
 * still with a play button, then playing in place with the system controls. Anonymous photos carry no metadata (they
 * were re-encoded on the phone that posted them) and the viewer shows nothing but the picture.
 */
export const BuzzMediaView = memo(function BuzzMediaView({ media, style }: { media: readonly BuzzMedia[]; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState<number | null>(null);
  if (media.length === 0) return null;
  const video = media.find((m): m is Video => m.type === "video");
  if (video) return <BuzzVideo video={video} style={style} />;
  const photos = media.filter((m): m is Photo => m.type === "image").slice(0, 4);
  const n = photos.length;
  if (n === 0) return null;
  const items: MediaViewerItem[] = photos.map((p) => ({ kind: "image", uri: p.url }));
  const tile = (i: number, tileStyle: StyleProp<ViewStyle>) => {
    const p = photos[i]!;
    return (
      <Pressable key={p.url} onPress={() => setOpen(i)} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${n}`} accessibilityHint="Opens it full screen" style={[styles.tile, tileStyle]}>
        <Image source={{ uri: p.url }} placeholder={p.blur ? { blurhash: p.blur } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={p.url} />
      </Pressable>
    );
  };

  let grid;
  if (n === 1) grid = <View style={{ aspectRatio: aspectOf(photos[0]!, 4 / 3) }}>{tile(0, styles.fill)}</View>;
  else if (n === 2)
    grid = (
      <View style={styles.row}>
        {tile(0, [styles.flex, { aspectRatio: 0.8 }])}
        {tile(1, [styles.flex, { aspectRatio: 0.8 }])}
      </View>
    );
  else if (n === 3)
    grid = (
      <View style={[styles.row, { aspectRatio: 1 }]}>
        {tile(0, styles.flex)}
        <View style={[styles.flex, styles.column]}>
          {tile(1, styles.flex)}
          {tile(2, styles.flex)}
        </View>
      </View>
    );
  else
    grid = (
      <View style={[styles.column, { aspectRatio: 1 }]}>
        <View style={[styles.row, styles.flex]}>
          {tile(0, styles.flex)}
          {tile(1, styles.flex)}
        </View>
        <View style={[styles.row, styles.flex]}>
          {tile(2, styles.flex)}
          {tile(3, styles.flex)}
        </View>
      </View>
    );

  return (
    <>
      <View style={[styles.frame, style]}>{grid}</View>
      <MediaViewer visible={open !== null} items={items} index={open ?? 0} onClose={() => setOpen(null)} />
    </>
  );
});

/** One video: its still and a play button until tapped, then the player itself with the system's controls. */
function BuzzVideo({ video, style }: { video: Video; style?: StyleProp<ViewStyle> }) {
  const [playing, setPlaying] = useState(false);
  const poster = video.posterUrl ?? muxPosterUrl(video.playbackId);
  return (
    <View style={[styles.frame, { aspectRatio: aspectOf(video, 16 / 9) }, style]}>
      {playing ? (
        <InlinePlayer playbackId={video.playbackId} />
      ) : (
        <Pressable onPress={() => setPlaying(true)} accessibilityRole="button" accessibilityLabel="Play video" style={styles.fill}>
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          <View style={styles.playWrap} pointerEvents="none">
            <View style={styles.play}>
              <Icon name="play" size={26} color="#ffffff" style={{ marginLeft: 3 }} />
            </View>
          </View>
        </Pressable>
      )}
    </View>
  );
}

/** Plays once it mounts (the person asked for it), with sound; pauses whenever the Buzz surface leaves the screen. */
function InlinePlayer({ playbackId }: { playbackId: string }) {
  const active = useContext(BuzzMediaActive);
  const focused = useIsFocused();
  const player = useVideoPlayer({ uri: muxPlaybackUrl(playbackId) }, (p) => {
    p.loop = false;
    p.audioMixingMode = VIDEO_AUDIO_MODE;
    p.muted = false;
    p.play();
  });
  const onScreen = active && focused;
  useEffect(() => {
    if (!onScreen) player.pause();
  }, [onScreen, player]);
  return <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} allowsPictureInPicture={false} allowsVideoFrameAnalysis={false} accessibilityLabel="Video" />;
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", borderRadius: R.lg, borderCurve: "continuous", backgroundColor: P.surface2 },
  fill: { ...StyleSheet.absoluteFill },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: GAP },
  column: { flexDirection: "column", gap: GAP },
  tile: { overflow: "hidden", backgroundColor: P.surface3 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
});
