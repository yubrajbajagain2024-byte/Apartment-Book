import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { BUZZ_TOPICS, buzzPostSchema, createBuzz, deleteImageByUrl, MAX_IMAGES_PER_BUZZ, type BuzzTopic, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { FormSection } from "@/components/form";
import { emitBuzzEvent } from "@/components/home/buzz-card";
import { Button, Chip, Field, Loading } from "@/components/ui";
import { pickBuzzPhotos, takeBuzzPhoto, uploadBuzzPhoto, type BuzzPickedPhoto } from "@/lib/buzz-photos";
import { errorText } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors, radius } from "@/lib/theme";
import { pickVideo, uploadVideo } from "@/lib/video";

/** Start an anonymous Buzz thread. Photos only ever leave the phone through buzz-photos.ts (re-encoded, no metadata, no user id in the link). */
export default function CreateBuzzScreen() {
  const { user, profile, loading } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const [topic, setTopic] = useState<BuzzTopic | undefined>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [uploading, setUploading] = useState(0);
  const [videoState, setVideoState] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/login");
  }, [loading, user, router]);

  if (!user) return <Loading />;
  const userId = user.id;
  const room = MAX_IMAGES_PER_BUZZ - photos.length - uploading;

  async function addPhotos(fromCamera: boolean) {
    try {
      const shot = fromCamera ? await takeBuzzPhoto() : null;
      const picked: BuzzPickedPhoto[] = fromCamera ? (shot ? [shot] : []) : await pickBuzzPhotos(room);
      const chosen = picked.slice(0, Math.max(0, room));
      if (chosen.length === 0) return;
      setUploading((n) => n + chosen.length);
      for (const p of chosen) {
        try {
          const meta = await uploadBuzzPhoto(p, userId);
          setPhotos((prev) => (prev.length >= MAX_IMAGES_PER_BUZZ ? prev : [...prev, meta]));
        } catch (e) {
          Alert.alert("Photo not added", errorText(e, "Upload failed. Please try again."));
        } finally {
          setUploading((n) => n - 1);
        }
      }
    } catch (e) {
      Alert.alert("Photos", errorText(e, "Could not open your photos."));
    }
  }

  async function addVideo(source: "camera" | "library") {
    try {
      const asset = await pickVideo(source);
      if (!asset) return;
      setVideoState({ phase: "uploading", progress: 0 });
      // A neutral file name: the original can contain a date, a place or a person's name.
      const v = await uploadVideo({ ...asset, fileName: "buzz.mp4" }, (progress, phase) => setVideoState({ phase, progress }));
      setVideo(v);
    } catch (e) {
      Alert.alert("Video not added", errorText(e, "Upload failed. Please try again."));
    } finally {
      setVideoState(null);
    }
  }

  function removePhoto(url: string) {
    setPhotos((prev) => prev.filter((x) => x.url !== url));
    // Do not leave a photo the person changed their mind about on the server.
    void deleteImageByUrl(supabase, url).catch(() => {});
  }

  const pickPhotoSource = () => show([{ label: "Take a photo", icon: "camera-outline", onPress: () => void addPhotos(true) }, { label: "Choose from library", icon: "images-outline", onPress: () => void addPhotos(false) }]);
  const pickVideoSource = () => show([{ label: "Film now", icon: "videocam-outline", onPress: () => void addVideo("camera") }, { label: "Choose a video", icon: "film-outline", onPress: () => void addVideo("library") }]);

  async function submit() {
    if (uploading > 0 || videoState) {
      Alert.alert("Still uploading", "Wait for your photos or video to finish, then post.");
      return;
    }
    const parsed = buzzPostSchema.safeParse({
      topic,
      title,
      body,
      universityId: profile?.university_id ?? undefined,
      images: photos.map((p) => p.url),
      imageMeta: photos.map((p) => JSON.stringify(p)),
      videos: video ? [JSON.stringify(video)] : [],
    });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      setErrors(e);
      Alert.alert("Almost there", Object.values(e)[0]);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const id = await createBuzz(supabase, userId, parsed.data);
      emitBuzzEvent({ type: "reload" });
      router.replace({ pathname: "/buzz/[id]", params: { id } });
    } catch (e) {
      Alert.alert("Could not post", errorText(e, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "New Buzz post" }} />

      <View style={styles.notice} accessibilityRole="summary">
        <Ionicons name="eye-off-outline" size={20} color={colors.brand} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.noticeTitle}>This post is anonymous</Text>
          <Text style={styles.noticeText}>Your name and photo are never shown. People see a random name like "Student 48213".</Text>
          <Text style={styles.noticeText}>Be kind. Do not share names or personal details of other people. Reported posts are reviewed by our team.</Text>
        </View>
      </View>

      <FormSection title="Pick a topic">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {BUZZ_TOPICS.map((t) => (
            <Chip key={t.value} label={t.label} active={topic === t.value} onPress={() => setTopic(t.value)} />
          ))}
        </View>
        {errors.topic ? <Text style={styles.error}>{errors.topic}</Text> : null}
      </FormSection>

      <FormSection title="What is on your mind?">
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Is it worth living off campus in second year?" maxLength={160} error={errors.title} />
        <Field label="More details (optional)" value={body} onChangeText={setBody} multiline placeholder="Share your thoughts, your experience, advice or a question…" maxLength={6000} error={errors.body} style={{ minHeight: 140 }} />
      </FormSection>

      <FormSection title="Photos and video (optional)">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Pressable onPress={pickPhotoSource} disabled={room <= 0} style={[styles.addTile, room <= 0 && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Add photos">
            <Ionicons name="add" size={24} color={colors.brand} />
            <Text style={styles.addText}>{uploading > 0 ? `Uploading ${uploading}…` : `Add photos (${photos.length}/${MAX_IMAGES_PER_BUZZ})`}</Text>
          </Pressable>
          {photos.map((p) => (
            <View key={p.url} style={styles.thumb}>
              <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <Pressable onPress={() => removePhoto(p.url)} style={styles.remove} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove photo">
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        {errors.images ? <Text style={styles.error}>{errors.images}</Text> : null}

        <View style={styles.videoBox}>
          {video ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {video.poster_url ? <Image source={{ uri: video.poster_url }} style={{ width: 64, height: 80, borderRadius: 8 }} contentFit="cover" /> : null}
              <Text style={{ flex: 1, fontWeight: "600", color: colors.text }}>Video ready</Text>
              <Pressable onPress={() => setVideo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove video">
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
            <Pressable onPress={pickVideoSource} style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityRole="button" accessibilityLabel="Add a video">
              <View style={styles.iconCircle}>
                <Ionicons name="videocam" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>Add one video</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Film now or choose one from your library.</Text>
              </View>
            </Pressable>
          )}
        </View>
        {errors.videos ? <Text style={styles.error}>{errors.videos}</Text> : null}

        <Text style={styles.hint}>We remove location and camera details from your photos before they are uploaded. Still, check that faces, voices, name tags or your room do not give you or someone else away.</Text>
      </FormSection>

      <Button title="Post anonymously" icon="eye-off-outline" onPress={() => void submit()} loading={busy} disabled={uploading > 0 || videoState !== null} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", gap: 10, backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: 14 },
  noticeTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  noticeText: { fontSize: 13, color: colors.text, lineHeight: 18 },
  error: { color: colors.red, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  addTile: { width: 104, height: 88, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brand, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: colors.brandSoft, paddingHorizontal: 4 },
  addText: { fontSize: 11, color: colors.brand, fontWeight: "600", textAlign: "center" },
  thumb: { width: 88, height: 88, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.border },
  remove: { position: "absolute", right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  videoBox: { borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md, padding: 12, backgroundColor: colors.card },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.brand },
});
