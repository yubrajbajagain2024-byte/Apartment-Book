import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { createFeedPost, feedPostSchema, MAX_IMAGES_PER_POST, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { MediaPicker } from "@/components/photo-picker";
import { Button, Card } from "@/components/ui";
import { markPostsStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

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
      router.replace({ pathname: "/posts/[id]", params: { id: created.id } } as never);
    } catch (e) {
      Alert.alert("Could not post", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  const empty = body.trim().length === 0 && photos.length === 0 && !video;
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size="md" online={false} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.text, fontSize: 15 }}>{profile?.full_name || "You"}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{profile?.university?.name ? `Posting to ${profile.university.name}` : "Posting with your name"}</Text>
          </View>
        </View>
        <TextInput value={body} onChangeText={setBody} placeholder="What's on your mind?" placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} multiline autoFocus maxLength={MAX_LENGTH} style={styles.input} accessibilityLabel="Post text" />
        {error ? <Text style={{ color: colors.red, fontSize: 13 }}>{error}</Text> : null}
        {body.length > MAX_LENGTH - 200 ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: "right" }}>{MAX_LENGTH - body.length} characters left</Text> : null}
      </Card>
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Photos and video</Text>
        <MediaPicker kind="posts" plain maxPhotos={MAX_IMAGES_PER_POST} userId={user.id} photos={photos} onPhotos={(p) => setPhotos(p.slice(0, MAX_IMAGES_PER_POST))} video={video} onVideo={setVideo} />
        <Text style={{ fontSize: 12, color: colors.muted }}>Up to {MAX_IMAGES_PER_POST} photos and one video. Your name and photo are shown on posts. For anonymous threads, use Buzz.</Text>
      </Card>
      <Button title="Post" onPress={() => void submit()} loading={busy} disabled={empty} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  input: { minHeight: 120, fontSize: 17, lineHeight: 23, color: colors.text, textAlignVertical: "top", paddingVertical: 4 },
}));
