import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { MAX_IMAGES_PER_LISTING, type ListingVideo, type PhotoMeta, type UploadKind } from "@apartment-book/shared";
import { pickPhotos, takePhoto, uploadPickedPhoto } from "@/lib/photos";
import { pickVideo, uploadVideo } from "@/lib/video";
import { radius, space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { useActionSheet } from "./action-sheet";

/** Photo (and optional video-tour) picker with immediate uploads; hands back URLs + meta for the form. */
/** `plain` = wording for Home posts (no "tour" talk). `maxPhotos` defaults to the listing limit. */
export function MediaPicker({ kind, userId, photos, onPhotos, video, onVideo, videoFirst, plain = false, maxPhotos = MAX_IMAGES_PER_LISTING }: { kind: UploadKind; userId: string; photos: PhotoMeta[]; onPhotos: (p: PhotoMeta[]) => void; video?: ListingVideo | null; onVideo?: (v: ListingVideo | null) => void; videoFirst?: boolean; plain?: boolean; maxPhotos?: number }) {
  const colors = useColors();
  const styles = useStyles();
  const show = useActionSheet();
  const [uploading, setUploading] = useState(0);
  const [videoState, setVideoState] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);

  async function addPhotos(fromCamera: boolean) {
    try {
      const assets = fromCamera ? [await takePhoto()].filter((a): a is NonNullable<typeof a> => a !== null) : await pickPhotos(maxPhotos - photos.length);
      if (assets.length === 0) return;
      setUploading((n) => n + assets.length);
      const uploaded: PhotoMeta[] = [];
      for (const a of assets) {
        try {
          uploaded.push(await uploadPickedPhoto(a, kind, userId));
        } catch (e) {
          Alert.alert("Photo not added", e instanceof Error ? e.message : "Upload failed");
        } finally {
          setUploading((n) => n - 1);
        }
      }
      onPhotos([...photos, ...uploaded]);
    } catch (e) {
      Alert.alert("Photos", e instanceof Error ? e.message : "Could not open photos");
    }
  }

  async function addVideo(source: "camera" | "library") {
    try {
      const asset = await pickVideo(source);
      if (!asset) return;
      setVideoState({ phase: "uploading", progress: 0 });
      const v = await uploadVideo(asset, (progress, phase) => setVideoState({ phase, progress }));
      onVideo?.(v);
    } catch (e) {
      Alert.alert("Video not added", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setVideoState(null);
    }
  }

  const pickPhotoSource = () => show([{ label: "Take a photo", icon: "camera-outline", onPress: () => void addPhotos(true) }, { label: "Choose from library", icon: "images-outline", onPress: () => void addPhotos(false) }]);
  const pickVideoSource = () => show([{ label: plain ? "Film now" : "Film a tour now", icon: "videocam-outline", onPress: () => void addVideo("camera") }, { label: "Choose a video", icon: "film-outline", onPress: () => void addVideo("library") }]);

  return (
    <View style={{ gap: space.sm + space.xxs }}>
      {onVideo ? (
        <View style={[styles.videoBox, videoFirst && { borderColor: colors.text }]}>
          {video ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm + space.xxs }}>
              {video.poster_url ? <Image source={{ uri: video.poster_url }} style={styles.videoPoster} contentFit="cover" transition={150} /> : null}
              <Text style={styles.videoTitle}>{plain ? "Video ready" : "Video tour ready"}</Text>
              <Pressable onPress={() => onVideo(null)} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.7 }} accessibilityRole="button" accessibilityLabel="Remove video">
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </Pressable>
            </View>
          ) : videoState ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.videoTitle}>{videoState.phase === "uploading" ? `Uploading ${Math.round(videoState.progress * 100)}%` : "Processing your video…"}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(videoState.progress * 100)}%` }]} />
              </View>
            </View>
          ) : (
            <Pressable onPress={pickVideoSource} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.sm + space.xxs }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={plain ? "Add a video" : "Add a video tour"}>
              <View style={styles.iconCircle}>
                <Ionicons name="videocam" size={20} color={colors.onBrand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>{videoFirst ? "Start with a video tour" : "Add a video (optional)"}</Text>
                <Text style={styles.videoSub}>{plain ? "Film now or choose one from your library." : "Posts with a video rank higher and get more messages."}</Text>
              </View>
            </Pressable>
          )}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        <Pressable onPress={pickPhotoSource} style={({ pressed }) => [styles.addTile, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add photos" disabled={photos.length >= maxPhotos}>
          <Ionicons name="add" size={22} color={colors.text} />
          <Text style={styles.addText}>{uploading > 0 ? `Uploading ${uploading}…` : "Add photos"}</Text>
        </Pressable>
        {photos.map((p, i) => (
          <View key={p.url} style={styles.thumb}>
            <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            {i === 0 ? (
              <View style={styles.cover}>
                <Text style={styles.coverText}>Cover</Text>
              </View>
            ) : null}
            <Pressable onPress={() => onPhotos(photos.filter((x) => x.url !== p.url))} style={styles.remove} accessibilityRole="button" accessibilityLabel="Remove photo">
              <Ionicons name="close" size={14} color={colors.onMedia} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The video box and the add tile share one quiet dashed edge (ink when the video comes first); photos sit on the skeleton grey until they load.
  videoBox: { borderWidth: 1, borderColor: colors.faint, borderStyle: "dashed", borderRadius: radius.md, padding: space.md, backgroundColor: "transparent" },
  videoPoster: { width: 64, height: 80, borderRadius: radius.sm, backgroundColor: colors.skeleton },
  videoTitle: { flex: 1, ...type.subheading, color: colors.text },
  videoSub: { ...type.footnote, color: colors.muted, marginTop: 1 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 4, backgroundColor: colors.brand },
  addTile: { width: 88, height: 88, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.faint, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: "transparent" },
  addText: { ...type.footnote, fontSize: 11, fontWeight: "600", color: colors.text },
  thumb: { width: 88, height: 88, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.skeleton },
  cover: { position: "absolute", left: space.xs, bottom: space.xs, backgroundColor: colors.mediaPill, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  coverText: { color: colors.onMedia, fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 0.3 },
  remove: { position: "absolute", right: space.xs, top: space.xs, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.mediaPill, alignItems: "center", justifyContent: "center" },
}));
