import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { createReel, muxPosterUrl, reelSchema, type ListingVideo } from "@apartment-book/shared";
import { useActionSheet } from "@/components/action-sheet";
import { markReelsStale } from "@/components/home/reels-section";
import { Button, Field, Loading } from "@/components/ui";
import { openHomeSection } from "@/lib/home-section";
import { markForYouStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { pickVideo, uploadVideo } from "@/lib/video";
import { radius, space, type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

const CAPTION_MAX = 2200;
export default function CreateReelScreen() {
  const colors = useColors();
  const styles = useStyles();
  const { user, profile, loading } = useSession();
  const router = useRouter();
  const show = useActionSheet();
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [upload, setUpload] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);
  const [caption, setCaption] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Posting needs an account: send signed-out visitors to log in instead of showing a dead form.
  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/login");
  }, [loading, user, router]);

  async function addVideo(source: "camera" | "library") {
    try {
      const asset = await pickVideo(source);
      if (!asset || !mounted.current) return;
      setErrors({});
      setVideo(null);
      setUpload({ phase: "uploading", progress: 0 });
      const ready = await uploadVideo(asset, (progress, phase) => {
        if (mounted.current) setUpload({ phase, progress });
      });
      if (mounted.current) setVideo(ready);
    } catch (e) {
      Alert.alert("Video not added", e instanceof Error ? e.message : "The upload failed. Please try again.");
    } finally {
      if (mounted.current) setUpload(null);
    }
  }

  const chooseSource = () =>
    show(
      [
        { label: "Record a video", icon: "videocam-outline", onPress: () => void addVideo("camera") },
        { label: "Choose from library", icon: "film-outline", onPress: () => void addVideo("library") },
      ],
      "Add a video to your reel",
    );

  async function submit() {
    if (!user || busy) return;
    const parsed = reelSchema.safeParse({ body: caption, universityId: profile?.university_id ?? undefined, videos: video ? [JSON.stringify(video)] : [] });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      setErrors(e);
      Alert.alert("Almost there", Object.values(e)[0]);
      return;
    }
    setBusy(true);
    try {
      await createReel(supabase, user.id, parsed.data);
      markReelsStale();
      markForYouStale();
      // Back to Home, opened on Reels, so the new reel is the first thing they see.
      openHomeSection("reels");
      router.dismissTo("/(tabs)");
    } catch (e) {
      Alert.alert("Could not post", e instanceof Error ? e.message : "Try again");
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <>
        <Stack.Screen options={{ title: "New reel" }} />
        <Loading />
      </>
    );
  }

  const percent = upload ? Math.round(upload.progress * 100) : 0;
  const poster = video ? (video.poster_url ?? muxPosterUrl(video.playback_id)) : null;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "New reel" }} />

      {video && poster ? (
        <View style={styles.previewWrap}>
          <View style={styles.preview}>
            <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityLabel="Your video" />
            <View style={styles.readyBadge}>
              <Ionicons name="checkmark-circle" size={14} color={colors.onMedia} />
              <Text style={styles.readyText}>Video ready</Text>
            </View>
            <Pressable onPress={() => setVideo(null)} disabled={busy} style={({ pressed }) => [styles.remove, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Remove video">
              <Ionicons name="close" size={18} color={colors.onMedia} />
            </Pressable>
          </View>
          <Pressable onPress={chooseSource} disabled={busy} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.7 }} accessibilityRole="button">
            <Text style={styles.link}>Use a different video</Text>
          </Pressable>
        </View>
      ) : upload ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>{upload.phase === "uploading" ? `Uploading ${percent}%` : "Processing..."}</Text>
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.fillBar, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.hint}>{upload.phase === "uploading" ? "Keep the app open while your video uploads." : "Almost done. We are getting your video ready to play."}</Text>
        </View>
      ) : (
        <Pressable onPress={chooseSource} style={({ pressed }) => [styles.box, styles.pick, errors.videos ? { borderColor: colors.red } : null, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add a video">
          <View style={styles.iconCircle}>
            <Ionicons name="videocam" size={26} color={colors.onBrand} />
          </View>
          <Text style={styles.boxTitle}>Add a video</Text>
          <Text style={[styles.hint, { textAlign: "center" }]}>Record one now or pick one from your phone. Vertical videos up to 3 minutes look best.</Text>
        </Pressable>
      )}
      {errors.videos && !video && !upload ? <Text style={styles.error}>{errors.videos}</Text> : null}

      <Field label="Caption" value={caption} onChangeText={setCaption} multiline maxLength={CAPTION_MAX} placeholder="Say something about your video…" error={errors.body} hint={caption.length > CAPTION_MAX - 200 ? `${CAPTION_MAX - caption.length} characters left` : undefined} />

      <Text style={styles.hint}>Your reel is posted with your name and shows up in Home → Reels for other students.</Text>

      <Button title={upload ? "Waiting for your video…" : "Post reel"} onPress={() => void submit()} loading={busy} disabled={upload !== null} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  previewWrap: { alignItems: "center", gap: space.md },
  preview: { width: 200, aspectRatio: 9 / 16, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.mediaBg },
  readyBadge: { position: "absolute", left: space.sm, bottom: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs, backgroundColor: colors.mediaPill, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  readyText: { ...type.footnote, fontWeight: "600", color: colors.onMedia },
  remove: { position: "absolute", right: space.sm, top: space.sm, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.mediaPill, alignItems: "center", justifyContent: "center" },
  link: { ...type.label, color: colors.text },
  // A card like the system's; the empty picker draws a quiet dashed edge instead, with the one ink disc in the middle.
  box: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm + space.xxs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pick: { alignItems: "center", paddingVertical: space.xxl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.faint, backgroundColor: "transparent" },
  iconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  boxTitle: { ...type.heading, fontSize: 16, color: colors.text },
  // A thin progress line in ink.
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  fillBar: { height: 4, backgroundColor: colors.brand },
  hint: { ...type.caption, color: colors.muted },
  error: { ...type.footnote, color: colors.red },
}));
