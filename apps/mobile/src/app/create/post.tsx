import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { createFeedPost, feedPostSchema, MAX_IMAGES_PER_POST, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { FormSection } from "@/components/form";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Card } from "@/components/ui";
import { markPostsStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space, type } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";

const MAX_LENGTH = 4000;

export default function CreatePostScreen() {
  const { colors, isDark } = useAppTheme();
  const styles = useStyles();
  const { user, profile, loading } = useSession();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [video, setVideo] = useState<ListingVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/login");
  }, [loading, user, router]);
  if (!user) return null;

  async function submit() {
    const parsed = feedPostSchema.safeParse({
      body,
      universityId: profile?.university_id ?? undefined,
      images: photos.map((p) => p.url),
      imageMeta: photos.map((p) => JSON.stringify(p)),
      videos: video ? [JSON.stringify(video)] : [],
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Please check your post";
      setError(message);
      Alert.alert("Almost there", message);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await createFeedPost(supabase, user!.id, parsed.data);
      markPostsStale();
      hapticSuccess();
      router.replace({ pathname: "/posts/[id]", params: { id: created.id } } as never);
    } catch (e) {
      alertWithHaptic("error", "Could not post", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  const empty = body.trim().length === 0 && photos.length === 0 && !video;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {/* The composer: who is posting, then the words, large and unboxed, like a note. */}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm + space.xxs }}>
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size="md" online={false} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {profile?.full_name || "You"}
            </Text>
            <Text style={styles.where} numberOfLines={1}>
              {profile?.university?.name ? `Posting to ${profile.university.name}` : "Posting with your name"}
            </Text>
          </View>
        </View>
        <TextInput value={body} onChangeText={setBody} placeholder="What's on your mind?" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} multiline autoFocus maxLength={MAX_LENGTH} style={styles.input} accessibilityLabel="Post text" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {body.length > MAX_LENGTH - 200 ? <Text style={styles.counter}>{MAX_LENGTH - body.length} characters left</Text> : null}
      </Card>
      <FormSection title="Photos and video">
        <MediaPicker kind="posts" plain maxPhotos={MAX_IMAGES_PER_POST} userId={user.id} photos={photos} onPhotos={(p) => setPhotos(p.slice(0, MAX_IMAGES_PER_POST))} video={video} onVideo={setVideo} />
        <Text style={styles.hint}>Up to {MAX_IMAGES_PER_POST} photos and one video. Your name and photo are shown on posts. For anonymous threads, use Buzz.</Text>
      </FormSection>
      <Button title="Post" onPress={() => void submit()} loading={busy} disabled={empty} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  name: { ...type.subheading, color: colors.text },
  where: { ...type.footnote, color: colors.muted, marginTop: 1 },
  input: { minHeight: 120, fontSize: 17, lineHeight: 24, color: colors.text, textAlignVertical: "top", paddingVertical: space.xs },
  error: { ...type.footnote, color: colors.red },
  counter: { ...type.footnote, color: colors.muted, textAlign: "right" },
  hint: { ...type.footnote, lineHeight: 17, color: colors.muted },
}));
