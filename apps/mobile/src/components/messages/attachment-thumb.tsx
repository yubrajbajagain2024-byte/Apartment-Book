import { useEffect, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { createVideoPlayer, type VideoThumbnail } from "expo-video";
import { makeStyles } from "@/lib/theme-provider";

// Chat videos have no poster file, so the first frame is drawn on the device: a muted player that never plays loads
// the video, expo-video grabs one small frame, and the player is released. Frames are kept for the session, by key
// (the storage path, or the local id while sending), so scrolling back never loads a video twice.

const MAX_KEPT = 40;
const frames = new Map<string, VideoThumbnail>();
const loading = new Map<string, Promise<VideoThumbnail | null>>();

function keep(key: string, frame: VideoThumbnail) {
  frames.set(key, frame);
  if (frames.size > MAX_KEPT) {
    const oldest = frames.keys().next().value;
    if (oldest !== undefined) frames.delete(oldest);
  }
}

function loadFrame(key: string, uri: string): Promise<VideoThumbnail | null> {
  const ready = frames.get(key);
  if (ready) return Promise.resolve(ready);
  const running = loading.get(key);
  if (running) return running;
  const job = (async () => {
    const player = createVideoPlayer(null);
    try {
      player.muted = true;
      player.audioMixingMode = "mixWithOthers";
      // replaceAsync resolves once the video is loaded, so the frame can be read right after.
      await player.replaceAsync({ uri });
      const [frame] = await player.generateThumbnailsAsync([0], { maxWidth: 480, maxHeight: 480 });
      if (frame) keep(key, frame);
      return frame ?? null;
    } catch {
      return null;
    } finally {
      loading.delete(key);
      try {
        player.release();
      } catch {
        // Already gone.
      }
    }
  })();
  loading.set(key, job);
  return job;
}

/** Remember an already drawn frame under another key too (a sent video's storage path, once it is uploaded). */
export function shareVideoThumbnail(fromKey: string, toKey: string) {
  const frame = frames.get(fromKey);
  if (frame && !frames.has(toKey)) keep(toKey, frame);
}

/** The first frame of a video (local file or signed URL), or null until it is ready (and always on the web). */
export function useVideoThumbnail(key: string | null | undefined, uri: string | null | undefined): VideoThumbnail | null {
  const [frame, setFrame] = useState<VideoThumbnail | null>(() => (key ? (frames.get(key) ?? null) : null));
  useEffect(() => {
    if (!key) return;
    const ready = frames.get(key);
    if (ready) {
      setFrame(ready);
      return;
    }
    if (!uri || Platform.OS === "web") return;
    let active = true;
    void loadFrame(key, uri).then((f) => {
      if (active && f) setFrame(f);
    });
    return () => {
      active = false;
    };
  }, [key, uri]);
  return frame;
}

/** A video's first frame filling `style`, over a placeholder shade while it loads (the play mark sits on top). */
export function VideoPoster({ cacheKey, uri, style }: { cacheKey: string | null | undefined; uri: string | null | undefined; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const frame = useVideoThumbnail(cacheKey, uri);
  return <View style={[styles.poster, style]}>{frame ? <Image source={frame} style={styles.fill} contentFit="cover" transition={120} /> : null}</View>;
}

const useStyles = makeStyles((colors) => ({
  // Not the black media background: on the dark theme's black screen a loading video would vanish.
  poster: { backgroundColor: colors.skeleton, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
}));
