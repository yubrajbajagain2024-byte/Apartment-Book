import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { Stack, useNavigation, useRouter } from "expo-router";
import { Image } from "expo-image";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DEFAULT_POST_AUDIENCE, POST_TITLE_MAX, captionParts, createFeedPost, createReel, createStory, isMissingRelation, feedPostSchema, postDetailsAvailable, reelSchema, sharedPostFromFeedPost, startingAudience, verifiedCampus, type FeedPostWithAuthor, type ListingVideo, type PhotoMeta } from "@apartment-book/shared";
import { CaptionSuggestions, tokenAt, type CaptionToken } from "@/components/compose/caption-suggestions";
import { CoverPicker } from "@/components/compose/cover-picker";
import { DraftsButton } from "@/components/compose/drafts-button";
import { GallerySheet } from "@/components/compose/gallery-sheet";
import { PeopleSheet } from "@/components/compose/people-sheet";
import { AUDIENCE_ICONS, AudienceSheet, LinkSheet, MoreOptionsSheet, SettingRow, ShareToSheet, audienceSentence } from "@/components/compose/publish-sheets";
import { markReelsStale } from "@/components/home/reels-section";
import { useActionSheet } from "@/components/action-sheet";
import { Icon } from "@/components/icon";
import { useShareSheet } from "@/components/share-sheet";
import { Button } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { deleteDraft, saveDraft } from "@/lib/compose-drafts";
import { clock, dropUploads, ensureUpload, saveToDevice, useUploads, withCover } from "@/lib/compose-media";
import { useCloseCompose } from "@/lib/compose-nav";
import { compose, roomFor, useCompose, type ComposeMedia, isListing } from "@/lib/compose-store";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { openHomeSection } from "@/lib/home-section";
import { markStoriesStale } from "@/lib/stories-store";
import { linkLabel } from "@/lib/post-details";
import { markForYouStale, markPostsStale } from "@/lib/posts-events";
import { useSession } from "@/lib/session";
import { SITE_URL, supabase } from "@/lib/supabase";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

const CAPTION_MAX = { post: 4000, reel: 2200 } as const;
/** The media row making room as photos are added. */
const TILE_MOVE = LinearTransition.springify().damping(30).stiffness(320);
type Open = "link" | "audience" | "people" | "more" | "share" | "gallery" | null;

/**
 * The last step, TikTok's post screen: the post's pictures in a row (the first marked Cover, a video's cover chosen by
 * tapping it, + to add more), a bold title, the caption with # and @ helpers that suggest tags in use and people to
 * mention, then Add link, who can view it, More options and Share to, each opening its own sheet, over Drafts and
 * Post. The photos and video start uploading as this screen opens, so Post usually only has to wait for the words.
 * Before migration 44 is on the database, the title, link, audience and comment settings stay greyed out.
 */
export default function PublishScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const { user, profile } = useSession();
  const s = useCompose();
  const uploads = useUploads();
  const show = useActionSheet();
  const shareSheet = useShareSheet();
  const closeCompose = useCloseCompose();
  const [open, setOpen] = useState<Open>(null);
  const [cover, setCover] = useState<ComposeMedia | null>(null);
  const [detailsOk, setDetailsOk] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState(0);
  const [captionFocused, setCaptionFocused] = useState(false);
  const [busy, setBusy] = useState<"post" | "story" | "draft" | null>(null);
  const caption = useRef<TextInputInstance>(null);
  const noun = s.mode === "reel" ? "reel" : "post";
  const max = s.mode === "reel" ? CAPTION_MAX.reel : CAPTION_MAX.post;

  useEffect(() => {
    let active = true;
    void postDetailsAvailable(supabase).then((ok) => active && setDetailsOk(ok));
    return () => {
      active = false;
    };
  }, []);

  // Uploads start (or carry on) for everything in the post; anything taken out stops.
  useEffect(() => {
    if (!user) return;
    dropUploads(s.media.map((m) => m.id));
    for (const m of s.media) void ensureUpload(m, user.id).catch(() => {});
  }, [s.media, user]);

  const token: CaptionToken | null = captionFocused ? tokenAt(s.caption, cursor) : null;
  const statuses = s.media.map((m) => uploads[m.id]);
  const failed = statuses.some((u) => u?.phase === "failed");
  const progress = useMemo(() => {
    if (statuses.length === 0) return 1;
    return statuses.reduce((sum, u) => sum + (u ? (u.phase === "done" ? 1 : u.phase === "processing" ? 0.95 : u.progress * 0.9) : 0), 0) / statuses.length;
  }, [statuses]);
  const room = roomFor(s);
  // "Campus only" is the campus of the account's confirmed university email, as the database decides it, not the
  // profile's (which people can change). Until that is known the profile's stands in, so the row doesn't flicker.
  const [verified, setVerified] = useState<{ id: string; name: string } | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void verifiedCampus(supabase, { email: user?.email, email_confirmed_at: user?.email_confirmed_at }, profile?.role).then((c) => active && setVerified(c));
    return () => {
      active = false;
    };
  }, [user?.email, user?.email_confirmed_at, profile?.role]);
  const campusId = verified === undefined ? (profile?.university_id ?? null) : (verified?.id ?? null);
  const campus = verified === undefined ? (profile?.university?.name ?? null) : (verified?.name ?? null);
  // Unchosen, a post starts on the author's campus (Global for someone without one).
  const audience = s.audience ?? startingAudience(campusId);
  const shareable = audience === "global" || audience === "campus";
  /** What a sheet asked for once it is fully gone (iOS presents nothing new while a modal is still leaving). */
  const afterSheet = useRef<(() => void) | null>(null);

  function pick(text: string) {
    if (!token) return;
    const next = `${s.caption.slice(0, token.start)}${text} ${s.caption.slice(token.end)}`;
    compose.update({ caption: next.slice(0, max) });
    setCursor(token.start + text.length + 1);
  }

  function insert(char: "#" | "@") {
    const at = captionFocused ? cursor : s.caption.length;
    const before = s.caption.slice(0, at);
    const spacer = before.length > 0 && !/\s$/.test(before) ? " " : "";
    compose.update({ caption: `${before}${spacer}${char}${s.caption.slice(at)}`.slice(0, max) });
    setCursor(at + spacer.length + 1);
    caption.current?.focus();
  }

  function addMore() {
    show(
      [
        {
          label: "Take a photo or video",
          icon: "camera-outline",
          onPress: () => router.dismissTo("/compose"),
        },
        { label: "Choose from library", icon: "images-outline", onPress: () => setOpen("gallery") },
      ],
      `Add to your ${noun}`,
    );
  }

  function openItem(m: ComposeMedia) {
    if (m.kind === "video") return setCover(m);
    // Photos are edited in the editor: one step back, or (opened from a draft, straight from the camera) in its place.
    const below = navigation.getState()?.routes.at(-2)?.name;
    if (below === "edit") router.back();
    else router.replace("/compose/edit");
  }

  async function saveAsDraft() {
    if (!user || busy) return;
    setBusy("draft");
    try {
      await saveDraft(user.id, compose.get());
      hapticSuccess();
      dropUploads();
      compose.start(s.mode);
      closeCompose();
    } catch (e) {
      alertWithHaptic("error", "Couldn't save the draft", e instanceof Error ? e.message : "Please try again.");
      setBusy(null);
    }
  }

  /**
   * To your story instead of (or as well as, with a second tap) the feed: each photo and video becomes a story with the
   * audience chosen above, for 24 hours (migration 58). Posts and reels keep their own path: nothing here changes them.
   */
  async function postStory() {
    if (!user || busy) return;
    const now = compose.get();
    if (isListing(now.mode)) return;
    const chosen = now.audience ?? startingAudience(campusId);
    setBusy("story");
    try {
      const done = await Promise.all(now.media.map((m) => ensureUpload(m, user.id)));
      const viewerIds = chosen === "selected" ? now.viewers.map((v) => v.id) : [];
      const universityId = chosen === "campus" ? campusId : undefined;
      for (let i = 0; i < done.length; i++) {
        const d = done[i]!;
        await createStory(supabase, user.id, d.kind === "photo" ? { photo: d.photo, audience: chosen, viewerIds, universityId } : { video: withCover(d.video, now.media[i]!.coverTime), audience: chosen, viewerIds, universityId });
      }
      hapticSuccess();
      markStoriesStale();
      if (now.saveToDevice) void saveToDevice(now.media);
      if (now.draftId) void deleteDraft(user.id, now.draftId);
      dropUploads();
      compose.start(now.mode);
      closeCompose();
      // Home, on Orbit, where the new story is first in the tray.
      openHomeSection("foryou");
      router.navigate("/(tabs)");
    } catch (e) {
      if (isMissingRelation(e)) Alert.alert("Not available yet", "Stories arrive with the next update of the server. Your photos and videos can still go out as a post.");
      else alertWithHaptic("error", "Couldn't share your story", e instanceof Error ? e.message : "Please try again.");
      setBusy(null);
    }
  }

  async function post(plain = false) {
    if (!user || busy) return;
    const now = compose.get();
    const chosen = now.audience ?? startingAudience(campusId);
    const extras = now.title.trim() !== "" || now.link !== "" || chosen !== DEFAULT_POST_AUDIENCE || now.commentsOff;
    // Before the database can keep titles and audiences (migration 44), a post is never quietly made public instead.
    if (extras && detailsOk === false && !plain) {
      Alert.alert("Not available yet", "Titles, links, who can view it and the comments switch arrive with the next update. You can post now without them: it will be visible to everyone, with comments on.", [
        { text: "Cancel", style: "cancel" },
        { text: "Post without them", onPress: () => void post(true) },
      ]);
      return;
    }
    setBusy("post");
    try {
      const done = await Promise.all(now.media.map((m) => ensureUpload(m, user.id)));
      const photos: PhotoMeta[] = [];
      let video: ListingVideo | null = null;
      done.forEach((d, i) => {
        if (d.kind === "photo") photos.push(d.photo);
        else video = withCover(d.video, now.media[i].coverTime);
      });
      const details = plain
        ? { audience: DEFAULT_POST_AUDIENCE }
        : { title: now.title, linkUrl: now.link, audience: chosen, viewerIds: chosen === "selected" ? now.viewers.map((v) => v.id) : [], commentsOff: now.commentsOff };
      // A campus-only post belongs to the verified campus; any other keeps the profile's university, as posts always have.
      const universityId = (details.audience === "campus" ? campusId : profile?.university_id) ?? undefined;
      const videos = video ? [JSON.stringify(video)] : [];
      const parsed =
        now.mode === "reel"
          ? reelSchema.safeParse({ body: now.caption, universityId, videos, ...details })
          : feedPostSchema.safeParse({ body: now.caption, universityId, images: photos.map((p) => p.url), imageMeta: photos.map((p) => JSON.stringify(p)), videos, ...details });
      if (!parsed.success) {
        Alert.alert("Almost there", parsed.error.issues[0]?.message ?? `Please check your ${noun}`);
        setBusy(null);
        return;
      }
      const created = now.mode === "reel" ? await createReel(supabase, user.id, parsed.data as never) : await createFeedPost(supabase, user.id, parsed.data as never);
      hapticSuccess();
      markForYouStale();
      if (now.mode === "reel") markReelsStale();
      else markPostsStale();
      if (now.saveToDevice) void saveToDevice(now.media);
      if (now.draftId) void deleteDraft(user.id, now.draftId);
      dropUploads();
      compose.start(now.mode);

      const postedTo = plain ? DEFAULT_POST_AUDIENCE : chosen;
      const canShare = postedTo === "global" || postedTo === "campus";
      const shareFriends = now.shareToFriends && canShare;
      const shareApps = now.shareToApps && canShare;
      closeCompose();
      if (now.mode === "reel") {
        // Home, on Reels, so the new reel is the first thing there.
        openHomeSection("reels");
        router.navigate("/(tabs)");
      } else {
        router.push({ pathname: "/posts/[id]", params: { id: created.id } } as never);
      }
      if (shareFriends || shareApps) {
        const url = `${SITE_URL}/posts/${created.id}`;
        const full = { ...created, author: { id: user.id, full_name: profile?.full_name ?? "", avatar_url: profile?.avatar_url ?? null, university: null }, university: null } as unknown as FeedPostWithAuthor;
        // Once the create flow has gone: iOS presents nothing over a screen that is still leaving.
        setTimeout(() => {
          if (shareFriends) shareSheet.open(sharedPostFromFeedPost(full), { url, restricted: postedTo === "campus" });
          else void Share.share({ url, message: now.title.trim() || undefined }).catch(() => {});
        }, 700);
      }
    } catch (e) {
      alertWithHaptic("error", `Couldn't post your ${noun}`, e instanceof Error ? e.message : "Please try again.");
      setBusy(null);
    }
  }

  const postLabel = busy === "post" ? (progress < 1 ? `Posting ${Math.round(progress * 100)}%` : "Posting…") : "Post";
  const shareValue = !shareable ? "Not for this audience" : [s.shareToFriends && "Friends", s.shareToApps && "Other apps"].filter(Boolean).join(", ") || null;
  const moreValue = [s.commentsOff && "Comments off", s.saveToDevice && "Save to device"].filter(Boolean).join(", ") || null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: s.mode === "reel" ? "New reel" : "New post" }} />
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 24 }} keyboardDismissMode="interactive">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.media}>
          {s.media.map((m, i) => {
            const u = uploads[m.id];
            return (
              <Animated.View key={m.id} entering={reduceMotion ? undefined : FadeIn.duration(180)} layout={reduceMotion ? undefined : TILE_MOVE}>
              <Pressable onPress={() => openItem(m)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={m.kind === "video" ? "Video, choose its cover" : `Photo ${i + 1}, edit`}>
                <Image source={{ uri: m.kind === "video" ? (m.thumbUri ?? undefined) : m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                <View style={styles.tileShade} />
                {i === 0 ? (
                  <View style={styles.coverTag}>
                    <Text style={styles.coverText}>Cover</Text>
                  </View>
                ) : null}
                {m.kind === "video" ? (
                  <View style={styles.tileFoot}>
                    <Text style={styles.tileFootText}>Edit cover</Text>
                    <Text style={styles.tileFootText}>{clock(m.duration)}</Text>
                  </View>
                ) : null}
                <UploadMark status={u} onRetry={() => user && void ensureUpload(m, user.id).catch(() => {})} />
              </Pressable>
              </Animated.View>
            );
          })}
          {room.photos + room.videos > 0 ? (
            <Pressable onPress={addMore} style={({ pressed }) => [styles.addTile, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add more photos or a video">
              <Icon name="add" size={30} weight="regular" color={colors.text} />
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.words}>
          <TextInput
            value={s.title}
            onChangeText={(title) => compose.update({ title })}
            placeholder="Add a catchy title"
            placeholderTextColor={colors.faint}
            maxLength={POST_TITLE_MAX}
            returnKeyType="next"
            onSubmitEditing={() => caption.current?.focus()}
            submitBehavior="submit"
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Title"
            style={styles.title}
          />
          <View style={styles.rule} />
          {/* The words as styled runs rather than a plain value, so #tags and @mentions show in colour as they're typed. */}
          <TextInput
            ref={caption}
            onChangeText={(text) => compose.update({ caption: text })}
            onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
            onFocus={() => setCaptionFocused(true)}
            onBlur={() => setCaptionFocused(false)}
            placeholder={`Say more about your ${noun}. Add #hashtags and @mention friends so classmates find it.`}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={max}
            keyboardAppearance={isDark ? "dark" : "light"}
            accessibilityLabel="Caption"
            style={styles.caption}
          >
            {captionParts(s.caption).map((part, i) => (
              <Text key={i} style={part.tag || part.mention ? styles.captionTag : undefined}>
                {part.text}
              </Text>
            ))}
          </TextInput>
          <View style={styles.tools}>
            <ToolChip label="#" hint="Hashtags" onPress={() => insert("#")} />
            <ToolChip label="@" hint="Mention" onPress={() => insert("@")} />
            <View style={{ flex: 1 }} />
            {s.caption.length > max * 0.8 ? <Text style={styles.count}>{max - s.caption.length}</Text> : null}
          </View>
        </View>

        <View style={styles.divider} />

        {token ? (
          <CaptionSuggestions token={token} me={user?.id ?? null} onPick={pick} />
        ) : (
          <View>
            <SettingRow icon="link-outline" sf="link.badge.plus" title={s.link ? linkLabel(s.link) : "Add link"} onPress={() => setOpen("link")} />
            <SettingRow icon={AUDIENCE_ICONS[audience].icon} sf={AUDIENCE_ICONS[audience].sf} title={audienceSentence(audience, noun, campus, s.viewers.length)} onPress={() => setOpen("audience")} />
            <SettingRow icon="settings-outline" sf="gearshape" title="More options" value={moreValue} onPress={() => setOpen("more")} />
            <SettingRow icon="arrow-redo-outline" sf="arrowshape.turn.up.right" title="Share to" value={shareValue} disabled={!shareable} onPress={() => setOpen("share")} />
          </View>
        )}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <DraftsButton busy={busy === "draft"} disabled={busy !== null} onPress={() => void saveAsDraft()} />
        {isListing(s.mode) ? null : (
          <Button title={busy === "story" ? "Sharing…" : "Your story"} variant="secondary" icon={busy === "story" ? undefined : "radio-button-on-outline"} size="large" loading={false} disabled={busy !== null || s.media.length === 0} onPress={() => void postStory()} accessibilityHint="Shares it to your story for 24 hours, to the audience chosen above" />
        )}
        <View style={{ flex: 1 }}>
          <Button title={postLabel} icon={busy === "post" ? undefined : "arrow-up-circle"} size="large" loading={false} disabled={busy !== null || s.media.length === 0} onPress={() => void post()} accessibilityHint={failed ? "An upload failed; posting tries it again" : undefined} />
        </View>
      </View>

      <LinkSheet
        visible={open === "link"}
        value={s.link}
        onClose={() => setOpen(null)}
        onSave={(link) => {
          compose.update({ link });
          setOpen(null);
        }}
      />
      <AudienceSheet
        visible={open === "audience"}
        value={audience}
        noun={noun}
        campus={campus}
        people={s.viewers.length}
        onClose={() => setOpen(null)}
        onDismiss={() => {
          const next = afterSheet.current;
          afterSheet.current = null;
          next?.();
        }}
        onChange={(next) => compose.update({ audience: next })}
        onChoosePeople={() => {
          // The picker rises once the audience sheet has gone.
          afterSheet.current = () => setOpen("people");
          setOpen(null);
        }}
      />
      <PeopleSheet
        visible={open === "people"}
        value={s.viewers}
        me={user?.id ?? null}
        onClose={() => setOpen(null)}
        onDone={(people) => {
          compose.update({ viewers: people, audience: "selected" });
          setOpen(null);
        }}
      />
      <MoreOptionsSheet
        visible={open === "more"}
        commentsOff={s.commentsOff}
        saveToDevice={s.saveToDevice}
        onClose={() => setOpen(null)}
        onComments={(allow) => compose.update({ commentsOff: !allow })}
        onSaveToDevice={(saveToDevice) => compose.update({ saveToDevice })}
      />
      <ShareToSheet visible={open === "share"} friends={s.shareToFriends} apps={s.shareToApps} onClose={() => setOpen(null)} onFriends={(shareToFriends) => compose.update({ shareToFriends })} onApps={(shareToApps) => compose.update({ shareToApps })} />
      <GallerySheet
        visible={open === "gallery"}
        mode={s.mode}
        room={room}
        onClose={() => setOpen(null)}
        onPicked={(items) => {
          compose.add(items);
          setOpen(null);
        }}
      />
      {cover ? (
        <CoverPicker
          item={cover}
          onCancel={() => setCover(null)}
          onDone={(next) => {
            compose.replace(cover.id, next);
            setCover(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** A thumbnail's upload: a ring of progress while it goes, a retry if it failed, nothing once it is up. */
function UploadMark({ status, onRetry }: { status?: { phase: string; progress: number }; onRetry: () => void }) {
  const styles = useStyles();
  if (!status) return null;
  if (status.phase === "done") return null;
  if (status.phase === "failed") {
    return (
      <Pressable onPress={onRetry} hitSlop={8} style={styles.mark} accessibilityRole="button" accessibilityLabel="Upload failed, try again">
        <Icon name="refresh-outline" sf="arrow.clockwise" size={14} weight="bold" color="#fff" />
      </Pressable>
    );
  }
  return (
    <Animated.View exiting={FadeOut.duration(220)} style={styles.markBar} accessibilityLabel={status.phase === "processing" ? "Processing" : `Uploading ${Math.round(status.progress * 100)}%`}>
      <View style={[styles.markFill, { width: `${Math.max(6, (status.phase === "processing" ? 1 : status.progress) * 100)}%` }]} />
    </Animated.View>
  );
}

function ToolChip({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={hint} hitSlop={4}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipHint}>{hint}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  media: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 },
  tile: { width: 104, height: 138, borderRadius: 14, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  tileShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 40, experimental_backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%)" },
  coverTag: { position: "absolute", top: 0, left: 0, paddingHorizontal: 9, paddingVertical: 4, borderBottomRightRadius: 10, backgroundColor: "rgba(0,0,0,0.55)" },
  coverText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tileFoot: { position: "absolute", left: 7, right: 7, bottom: 6, flexDirection: "row", justifyContent: "space-between" },
  tileFootText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  addTile: { width: 104, height: 138, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  mark: { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.red },
  markBar: { position: "absolute", left: 8, right: 8, bottom: 26, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  markFill: { height: 3, backgroundColor: "#fff" },
  words: { paddingHorizontal: 16, paddingTop: 12 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, paddingVertical: 10 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  caption: { minHeight: 132, fontSize: 16, lineHeight: 22, color: colors.text, paddingTop: 12, paddingBottom: 8, textAlignVertical: "top" },
  captionTag: { color: colors.hashtag, fontWeight: "600" },
  tools: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 10, borderCurve: "continuous", backgroundColor: colors.input },
  chipLabel: { fontSize: 17, fontWeight: "700", color: colors.text },
  chipHint: { fontSize: 14, fontWeight: "600", color: colors.text },
  count: { fontSize: 13, color: colors.muted, fontVariant: ["tabular-nums"] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: 4 },
  bar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
}));
