import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { MAX_IMAGES_PER_LISTING, type ListingVideo, type PhotoMeta, type UploadKind } from "@apartment-book/shared";
import { pickPhotos, takePhoto, uploadPickedPhoto } from "@/lib/photos";
import { pickVideo, uploadVideo } from "@/lib/video";
import { colors, radius } from "@/lib/theme";
import { useActionSheet } from "./action-sheet";

/** Photo (and optional video-tour) picker with immediate uploads; hands back URLs + meta for the form. */
export function MediaPicker({ kind, userId, photos, onPhotos, video, onVideo, videoFirst }: { kind: UploadKind; userId: string; photos: PhotoMeta[]; onPhotos: (p: PhotoMeta[]) => void; video?: ListingVideo | null; onVideo?: (v: ListingVideo | null) => void; videoFirst?: boolean }) {
  const show = useActionSheet();
  const [uploading, setUploading] = useState(0);
  const [videoState, setVideoState] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);

  async function addPhotos(fromCamera: boolean) {
    try {
      const assets = fromCamera ? [await takePhoto()].filter((a): a is NonNullable<typeof a> => a !== null) : await pickPhotos(MAX_IMAGES_PER_LISTING - photos.length);
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
  const pickVideoSource = () => show([{ label: "Film a tour now", icon: "videocam-outline", onPress: () => void addVideo("camera") }, { label: "Choose a video", icon: "film-outline", onPress: () => void addVideo("library") }]);

  return (
    <View style={{ gap: 10 }}>
      {onVideo ? (
        <View style={[styles.videoBox, videoFirst && { borderColor: colors.brand }]}>
          {video ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {video.poster_url ? <Image source={{ uri: video.poster_url }} style={{ width: 64, height: 80, borderRadius: 8 }} contentFit="cover" /> : null}
              <Text style={{ flex: 1, fontWeight: "600", color: colors.text }}>Video tour ready</Text>
              <Pressable onPress={() => onVideo(null)} accessibilityRole="button" accessibilityLabel="Remove video">
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </Pressable>
            </View>
          ) : videoState ? (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{videoState.phase === "uploading" ? `Uploading ${Math.round(videoState.progress * 100)}%` : "Processing your video…"}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(videoState.progress * 100)}%` }]} />
              </View>
            </View>
          ) : (
            <Pressable onPress={pickVideoSource} style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityRole="button" accessibilityLabel="Add a video tour">
              <View style={styles.iconCircle}>
                <Ionicons name="videocam" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>{videoFirst ? "Start with a video tour" : "Add a video (optional)"}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Posts with a video rank higher and get more messages.</Text>
              </View>
            </Pressable>
          )}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Pressable onPress={pickPhotoSource} style={styles.addTile} accessibilityRole="button" accessibilityLabel="Add photos" disabled={photos.length >= MAX_IMAGES_PER_LISTING}>
          <Ionicons name="add" size={24} color={colors.brand} />
          <Text style={{ fontSize: 11, color: colors.brand, fontWeight: "600" }}>{uploading > 0 ? `Uploading ${uploading}…` : "Add photos"}</Text>
        </Pressable>
        {photos.map((p, i) => (
          <View key={p.url} style={styles.thumb}>
            <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            {i === 0 ? (
              <View style={styles.cover}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>Cover</Text>
              </View>
            ) : null}
            <Pressable onPress={() => onPhotos(photos.filter((x) => x.url !== p.url))} style={styles.remove} accessibilityRole="button" accessibilityLabel="Remove photo">
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  videoBox: { borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md, padding: 12, backgroundColor: colors.card },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.brand },
  addTile: { width: 88, height: 88, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brand, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: colors.brandSoft },
  thumb: { width: 88, height: 88, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.border },
  cover: { position: "absolute", left: 4, bottom: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  remove: { position: "absolute", right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
});
