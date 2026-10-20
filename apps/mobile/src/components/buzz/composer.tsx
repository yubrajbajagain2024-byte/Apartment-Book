import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BUZZ_COMPOSER_COPY,
  BUZZ_LIMITS,
  BUZZ_POLL_DURATIONS,
  buzzErrorMessage,
  createBuzzPost,
  deleteImageByUrl,
  type Buzz,
  type BuzzScope,
  type CreateBuzzRequest,
} from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { buzzWriteTarget, ensureBuzzMeta } from "@/lib/buzz-actions";
import { pickBuzzPhotos, takeBuzzPhoto, uploadBuzzPhoto, type BuzzPickedPhoto } from "@/lib/buzz-photos";
import { buzzState, emitBuzzEvent, getBuzzState, putBuzzItems, useBuzzState, type BuzzUiState, type DraftVideo } from "@/lib/buzz-store";
import { BuzzVideoTooLong, pickBuzzVideo, uploadBuzzVideo } from "@/lib/buzz-video";
import { hapticSuccess } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { ComposerGuard, ComposerModeBanner, useBuzzPostingStatus } from "./guard";
import { useBuzzModeration } from "./moderation";
import { BuzzSheet } from "./sheet";
import { BuzzToastHost } from "./toast";
import { Chip, P, PButton, PIconButton, R, Segmented, T } from "./ui";

/*
 * The Buzz composer (UniVerse's features/buzz/Composer.tsx, design §7.2): a full-height sheet (the system's page sheet on
 * iPhone, swipe down to close) with the "You're anonymous" banner, today's prompt when answering it, Campus | Global
 * with what each means, an optional title (100; Return goes on to the words), the words (500), up to four photos OR one
 * video (a minute at most, refused before upload), a poll (2–4 options, 1 / 3 / 7 days; locked for the first 24 hours of
 * an account) and the hero "Buzz it". No avatar, no handle. The draft lives in memory for the session (lib/buzz-store),
 * never on the phone's storage, and is wiped on sign-out. Posting goes through the website's moderated write API.
 */

const selectDraft = (s: BuzzUiState) => s.draft;
const selectMeta = (s: BuzzUiState) => s.meta;
const selectCampus = (s: BuzzUiState) => s.campus;

const SCOPES = [
  { value: "campus" as const, label: "Campus", icon: "school-outline" as const },
  { value: "global" as const, label: "Global", icon: "globe-outline" as const },
];
const TILE = 96;

export function BuzzComposer({ visible, onClose, onPosted }: { visible: boolean; onClose: () => void; onPosted?: (buzz: Buzz) => void }) {
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const draft = useBuzzState(selectDraft);
  const meta = useBuzzState(selectMeta);
  const campus = useBuzzState(selectCampus);
  const posting = useBuzzPostingStatus(visible);
  const moderation = useBuzzModeration();
  const titleRef = useRef<TextInput>(null);
  const textRef = useRef<TextInput>(null);
  const [photoUploads, setPhotoUploads] = useState(0);
  const [video, setVideo] = useState<{ phase: "uploading" | "processing"; progress: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [mediaSheet, setMediaSheet] = useState<"photo" | "video" | null>(null);
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  /** What the media sheet's choice runs once the sheet is fully gone (iOS presents the camera only then). */
  const afterMediaSheet = useRef<(() => void) | null>(null);
  const chooseSource = (kind: "photo" | "video") => {
    setMediaSheet(kind);
    setMediaSheetOpen(true);
  };
  const [sheetTop, setSheetTop] = useState(0);
  const root = useRef<View>(null);
  /**
   * Where the page sheet starts on screen, for the keyboard: KeyboardAvoidingView measures against its own parent, and
   * the sheet sits below the status bar. Measured once the sheet has finished rising (a measure during the slide would
   * catch it half way up), and again whenever the keyboard comes up.
   */
  const measureTop = useCallback(() => {
    root.current?.measureInWindow((_x, y) => {
      const top = Math.max(0, Math.round(y));
      setSheetTop((prev) => (prev === top ? prev : top));
    });
  }, []);
  useEffect(() => {
    if (!visible) return;
    const sub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", measureTop);
    return () => sub.remove();
  }, [visible, measureTop]);

  // The campus's name and the small-campus note, when Home's Buzz page has not loaded them (opened from My buzzes).
  useEffect(() => {
    if (visible) ensureBuzzMeta("campus");
  }, [visible]);

  // Focus the title as the sheet settles (UniVerse focuses it 60ms after opening).
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => (draft.title || draft.text ? textRef : titleRef).current?.focus(), 450);
    return () => clearTimeout(t);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const now = Date.now();
  const pollsLocked = posting?.pollsUnlockAt != null && posting.pollsUnlockAt > now;
  const campusMeta = meta.campus?.value ?? null;
  const prompt = draft.promptId ? (Object.values(meta).find((m) => m?.value.prompt?.id === draft.promptId)?.value.prompt ?? null) : null;
  const text = draft.text.trim();
  const title = draft.title.trim();
  const options = draft.options.map((o) => o.trim());
  const filled = options.filter(Boolean);
  const pollValid = !draft.pollOn || (filled.length >= BUZZ_LIMITS.pollMinOptions && filled.length === options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length);
  const uploading = photoUploads > 0 || video !== null;
  const canSubmit = (text.length > 0 || title.length > 0) && text.length <= BUZZ_LIMITS.text && title.length <= BUZZ_LIMITS.title && pollValid && !uploading && !sending && (!draft.pollOn || !pollsLocked);
  const roomForPhotos = BUZZ_LIMITS.images - draft.images.length - photoUploads;

  /* ---------- photos ---------- */

  const addPhotos = useCallback(
    async (fromCamera: boolean) => {
      if (!user) return;
      const room = BUZZ_LIMITS.images - currentDraft().images.length - photoUploads;
      try {
        const shot = fromCamera ? await takeBuzzPhoto() : null;
        const picked: BuzzPickedPhoto[] = fromCamera ? (shot ? [shot] : []) : await pickBuzzPhotos(room);
        const chosen = picked.slice(0, Math.max(0, room));
        if (chosen.length === 0) return;
        setPhotoUploads((n) => n + chosen.length);
        for (const p of chosen) {
          try {
            const photo = await uploadBuzzPhoto(p, user.id);
            const images = currentDraft().images;
            if (images.length < BUZZ_LIMITS.images) buzzState.setDraft({ images: [...images, photo], video: null });
          } catch (e) {
            buzzState.toast(buzzErrorMessage(e), { tone: "error", title: "Photo not added" });
          } finally {
            setPhotoUploads((n) => n - 1);
          }
        }
      } catch (e) {
        buzzState.toast(buzzErrorMessage(e), { tone: "error" });
      }
    },
    [user, photoUploads],
  );

  const removePhoto = (url: string) => {
    buzzState.setDraft({ images: currentDraft().images.filter((p) => p.url !== url) });
    // Not left on the server once the person changed their mind.
    void deleteImageByUrl(supabase, url).catch(() => {});
  };

  /* ---------- video ---------- */

  const addVideo = useCallback(async (source: "camera" | "library") => {
    try {
      const asset = await pickBuzzVideo(source);
      if (!asset) return;
      setVideo({ phase: "uploading", progress: 0 });
      const ready: DraftVideo = await uploadBuzzVideo(asset, (progress, phase) => setVideo({ phase, progress }));
      for (const p of currentDraft().images) void deleteImageByUrl(supabase, p.url).catch(() => {});
      buzzState.setDraft({ video: ready, images: [] });
    } catch (e) {
      buzzState.toast(e instanceof BuzzVideoTooLong ? e.message : buzzErrorMessage(e), { tone: "error", title: e instanceof BuzzVideoTooLong ? undefined : "Video not added" });
    } finally {
      setVideo(null);
    }
  }, []);

  const toggleVideo = () => {
    if (draft.video) {
      buzzState.setDraft({ video: null });
      return;
    }
    if (draft.images.length > 0) {
      Alert.alert("Use a video instead?", "A buzz has photos or one video. Your photos will be removed.", [
        { text: "Cancel", style: "cancel" },
        { text: "Choose a video", onPress: () => chooseSource("video") },
      ], { userInterfaceStyle: "dark" });
      return;
    }
    chooseSource("video");
  };

  /* ---------- poll ---------- */

  const setOption = (i: number, v: string) => buzzState.setDraft({ options: draft.options.map((o, k) => (k === i ? v : o)) });
  const addOption = () => {
    if (draft.options.length < BUZZ_LIMITS.pollMaxOptions) buzzState.setDraft({ options: [...draft.options, ""] });
  };
  const removeOption = (i: number) => {
    if (draft.options.length > BUZZ_LIMITS.pollMinOptions) buzzState.setDraft({ options: draft.options.filter((_, k) => k !== i) });
  };

  /* ---------- post ---------- */

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    const d = currentDraft();
    const body: CreateBuzzRequest = {
      text,
      scope: d.scope,
      ...(title ? { title } : {}),
      ...(d.video ? { video: d.video } : d.images.length > 0 ? { images: d.images.map((p) => p.url), imageMeta: d.images } : {}),
      ...(d.pollOn ? { poll: { options, durationDays: d.durationDays } } : {}),
      ...(d.promptId ? { promptId: d.promptId } : {}),
    };
    try {
      const res = await createBuzzPost(await buzzWriteTarget(), body);
      const { moderation: notice, ...buzz } = res;
      putBuzzItems([buzz]);
      hapticSuccess();
      buzzState.clearDraft();
      // Show the feed the buzz went to, so it is right there.
      buzzState.setScope(buzz.scope);
      buzzState.dropFeeds();
      emitBuzzEvent({ type: "refresh", scope: buzz.scope });
      onPosted?.(buzz);
      if (notice.status !== "held") buzzState.toast(BUZZ_COMPOSER_COPY.posted(buzz.scope, buzz.alias.label), { tone: "success", duration: 4500 });
      moderation.showNotice(notice, { onSupportClosed: onClose });
    } catch (e) {
      if (!moderation.handleWriteError(e, { onEdit: () => textRef.current?.focus() })) buzzState.toast(buzzErrorMessage(e), { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    if (sending) return;
    onClose();
  };

  const ios = Platform.OS === "ios";
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={ios ? "pageSheet" : undefined}
      allowSwipeDismissal={ios && !sending}
      statusBarTranslucent={!ios}
      onRequestClose={close}
      onShow={measureTop}
    >
      <StatusBar style="light" />
      <View ref={root} style={[styles.root, { paddingTop: ios ? 0 : insets.top }]}>
        <KeyboardAvoidingView style={styles.flex} behavior={ios ? "padding" : undefined} keyboardVerticalOffset={sheetTop}>
          <View style={styles.header}>
            {ios ? <View style={styles.grabber} /> : null}
            <View style={styles.headerRow}>
              <Text style={[T.title2, styles.flex, { color: P.ink }]} accessibilityRole="header">
                {BUZZ_COMPOSER_COPY.title}
              </Text>
              <PIconButton icon="close" label="Close" onPress={close} variant="filled" size={36} iconSize={18} color={P.ink2} disabled={sending} />
            </View>
          </View>
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <ComposerModeBanner note={campusMeta?.smallCampusNote ? BUZZ_COMPOSER_COPY.smallCampusNote : BUZZ_COMPOSER_COPY.defaultNote} />
            {prompt ? (
              <View style={styles.prompt}>
                <Icon name="sparkles" size={16} color={P.accentInk} />
                <Text style={[T.footnote, styles.flex, { color: P.ink2 }]} numberOfLines={2}>
                  {BUZZ_COMPOSER_COPY.promptAttached(prompt.text)}
                </Text>
                <PIconButton icon="close" label="Detach the prompt" onPress={() => buzzState.setDraft({ promptId: null })} size={32} iconSize={16} />
              </View>
            ) : null}
            <View style={{ gap: 8 }}>
              <Segmented<BuzzScope> label="Post to" value={draft.scope} options={SCOPES} onChange={(scope) => buzzState.setDraft({ scope })} />
              <Text style={[T.caption, { color: P.ink3 }]}>{draft.scope === "campus" ? BUZZ_COMPOSER_COPY.campusScopeNote(campus?.shortName ?? "your") : BUZZ_COMPOSER_COPY.globalScopeNote}</Text>
            </View>
            <TextInput
              ref={titleRef}
              value={draft.title}
              onChangeText={(v) => buzzState.setDraft({ title: v.replace(/\n/g, " ") })}
              placeholder={BUZZ_COMPOSER_COPY.titlePlaceholder}
              placeholderTextColor={P.ink4}
              keyboardAppearance="dark"
              maxLength={BUZZ_LIMITS.title}
              multiline
              submitBehavior="submit"
              returnKeyType="next"
              onSubmitEditing={() => textRef.current?.focus()}
              style={[T.title3, styles.bare, styles.title]}
              accessibilityLabel="Title"
              accessibilityHint="Optional"
            />
            <View>
              <TextInput
                ref={textRef}
                value={draft.text}
                onChangeText={(v) => buzzState.setDraft({ text: v })}
                placeholder={BUZZ_COMPOSER_COPY.bodyPlaceholder}
                placeholderTextColor={P.ink4}
                keyboardAppearance="dark"
                maxLength={BUZZ_LIMITS.text}
                multiline
                style={[T.bodyLg, styles.bare, styles.text]}
                accessibilityLabel="Your buzz"
              />
              <Text style={[T.caption, styles.count, { color: draft.text.length > BUZZ_LIMITS.text - 40 ? P.warning : P.ink3 }]} accessibilityLabel={`${draft.text.length} of ${BUZZ_LIMITS.text} characters`}>
                {draft.text.length}/{BUZZ_LIMITS.text}
              </Text>
            </View>

            {video ? (
              <View style={styles.progressCard} accessibilityLiveRegion="polite">
                <Text style={[T.labelSm, { color: P.ink }]}>{video.phase === "uploading" ? `Uploading video… ${Math.round(video.progress * 100)}%` : "Processing your video…"}</Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round((video.phase === "uploading" ? video.progress : 1) * 100)}%` }]} />
                </View>
              </View>
            ) : draft.video ? (
              <View style={[styles.videoPreview, { aspectRatio: draft.video.width && draft.video.height ? Math.min(1.78, Math.max(0.75, draft.video.width / draft.video.height)) : 16 / 9 }]}>
                {draft.video.posterUrl ? <Image source={{ uri: draft.video.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Your video" /> : null}
                <View style={styles.videoBadge}>
                  <Icon name="videocam" size={14} color="#ffffff" />
                  {draft.video.durationSeconds ? <Text style={[T.micro, { color: "#ffffff" }]}>{`0:${String(Math.min(60, Math.round(draft.video.durationSeconds))).padStart(2, "0")}`}</Text> : null}
                </View>
                <PIconButton icon="close" label="Remove video" onPress={() => buzzState.setDraft({ video: null })} size={32} iconSize={16} color="#ffffff" style={styles.removeVideo} />
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray} keyboardShouldPersistTaps="handled">
                  {roomForPhotos > 0 ? (
                    <Pressable onPress={() => chooseSource("photo")} disabled={sending} accessibilityRole="button" accessibilityLabel={`Add photos, ${draft.images.length} of ${BUZZ_LIMITS.images}`} style={({ pressed }) => [styles.addTile, pressed && { opacity: 0.75 }]}>
                      <MaterialCommunityIcons name="image-plus-outline" size={28} color={P.ink3} />
                      <Text style={[T.labelSm, { color: P.ink3 }]}>
                        {draft.images.length}/{BUZZ_LIMITS.images}
                      </Text>
                    </Pressable>
                  ) : null}
                  {draft.images.map((p, i) => (
                    <View key={p.url} style={styles.thumb}>
                      <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Photo ${i + 1}`} />
                      <PIconButton icon="close" label={`Remove photo ${i + 1}`} onPress={() => removePhoto(p.url)} size={26} iconSize={14} color="#ffffff" style={styles.removePhoto} />
                    </View>
                  ))}
                  {Array.from({ length: photoUploads }, (_, i) => (
                    <View key={`up${i}`} style={[styles.thumb, styles.uploadingTile]} accessibilityLabel="Uploading a photo">
                      <ActivityIndicator color={P.accent} />
                    </View>
                  ))}
                </ScrollView>
                <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_COMPOSER_COPY.mediaHint}</Text>
              </View>
            )}

            {draft.pollOn ? (
              <View style={styles.pollCard}>
                <View style={styles.pollHead}>
                  <Text style={[T.labelSm, { color: P.ink }]}>Poll</Text>
                  <Text style={[T.caption, { color: P.ink3 }]}>{BUZZ_COMPOSER_COPY.pollHint}</Text>
                </View>
                {draft.options.map((o, i) => (
                  <View key={i} style={styles.optionRow}>
                    <TextInput
                      value={o}
                      onChangeText={(v) => setOption(i, v)}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={P.ink4}
                      keyboardAppearance="dark"
                      maxLength={BUZZ_LIMITS.pollOptionText}
                      style={[T.body, styles.option]}
                      accessibilityLabel={`Option ${i + 1}`}
                    />
                    {draft.options.length > BUZZ_LIMITS.pollMinOptions ? <PIconButton icon="close" label={`Remove option ${i + 1}`} onPress={() => removeOption(i)} size={36} iconSize={16} /> : null}
                  </View>
                ))}
                {draft.options.length < BUZZ_LIMITS.pollMaxOptions ? <PButton title="Add option" icon="add" variant="ghost" size="sm" onPress={addOption} style={styles.addOption} /> : null}
                <View style={styles.durations} accessibilityLabel="Poll duration">
                  {BUZZ_POLL_DURATIONS.map((n) => (
                    <Chip key={n} label={n === 1 ? "1 day" : `${n} days`} selected={draft.durationDays === n} onPress={() => buzzState.setDraft({ durationDays: n })} />
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <ComposerGuard status={posting} onDetails={onClose}>
              <View style={styles.footerRow}>
                <Chip
                  label="Poll"
                  size="md"
                  selected={draft.pollOn}
                  disabled={pollsLocked && !draft.pollOn}
                  onPress={() => buzzState.setDraft({ pollOn: !draft.pollOn })}
                  iconNode={<Icon name="bar-chart-outline" size={17} color={draft.pollOn ? P.accentInk : P.ink2} />}
                  accessibilityHint={pollsLocked ? BUZZ_COMPOSER_COPY.pollsLocked : undefined}
                />
                <Chip label="Video" size="md" selected={draft.video !== null} disabled={video !== null || sending} onPress={toggleVideo} iconNode={<Icon name="videocam-outline" size={17} color={draft.video ? P.accentInk : P.ink2} />} />
                <Text style={[T.caption, styles.flex, { color: P.ink3 }]} numberOfLines={2}>
                  {uploading ? "Uploading…" : pollsLocked ? BUZZ_COMPOSER_COPY.pollsLocked : ""}
                </Text>
                <PButton title={BUZZ_COMPOSER_COPY.submit} variant="hero" disabled={!canSubmit} loading={sending} onPress={() => void submit()} />
              </View>
            </ComposerGuard>
          </View>
        </KeyboardAvoidingView>
        <BuzzToastHost bottom={Math.max(insets.bottom, 12) + 76} />
        {moderation.element}
        <BuzzSheet
          visible={mediaSheetOpen}
          onClose={() => setMediaSheetOpen(false)}
          onDismiss={() => {
            setMediaSheet(null);
            const run = afterMediaSheet.current;
            afterMediaSheet.current = null;
            run?.();
          }}
          closeLabel="Close"
        >
          <View style={styles.sourceList}>
            <PButton
              title={mediaSheet === "video" ? "Film a video" : "Take a photo"}
              icon={mediaSheet === "video" ? "videocam-outline" : "camera-outline"}
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => {
                const kind = mediaSheet;
                afterMediaSheet.current = () => (kind === "video" ? void addVideo("camera") : void addPhotos(true));
                setMediaSheetOpen(false);
              }}
            />
            <PButton
              title={mediaSheet === "video" ? "Choose a video" : "Choose from library"}
              icon={mediaSheet === "video" ? "film-outline" : "images-outline"}
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => {
                const kind = mediaSheet;
                afterMediaSheet.current = () => (kind === "video" ? void addVideo("library") : void addPhotos(false));
                setMediaSheetOpen(false);
              }}
            />
            <Text style={[T.caption, { color: P.ink3, textAlign: "center" }]}>{BUZZ_COMPOSER_COPY.mediaHint}</Text>
          </View>
        </BuzzSheet>
      </View>
    </Modal>
  );
}

/** The draft as it is right now: what runs after an await (an upload) must not use the copy of the render it started in. */
function currentDraft() {
  return getBuzzState().draft;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: P.surface2 },
  header: { paddingTop: 8 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 2.5, backgroundColor: P.surface4 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  body: { gap: 18, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  prompt: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingVertical: 4, paddingRight: 4, borderRadius: R.md, borderCurve: "continuous", backgroundColor: P.surface3 },
  bare: { color: P.ink, padding: 0, margin: 0, textAlignVertical: "top" },
  title: { minHeight: 28 },
  text: { minHeight: 104, maxHeight: 300 },
  count: { alignSelf: "flex-end", marginTop: 6, fontVariant: ["tabular-nums"] },
  tray: { gap: 10 },
  addTile: { width: TILE, height: TILE, borderRadius: R.md, borderCurve: "continuous", borderWidth: 1.5, borderStyle: "dashed", borderColor: P.lineStrong, backgroundColor: P.canvas, alignItems: "center", justifyContent: "center", gap: 4 },
  thumb: { width: TILE, height: TILE, borderRadius: R.md, borderCurve: "continuous", overflow: "hidden", backgroundColor: P.surface3 },
  uploadingTile: { alignItems: "center", justifyContent: "center" },
  removePhoto: { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)" },
  videoPreview: { overflow: "hidden", borderRadius: R.lg, borderCurve: "continuous", backgroundColor: P.surface3 },
  videoBadge: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: "rgba(0,0,0,0.6)" },
  removeVideo: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)" },
  progressCard: { gap: 10, padding: 14, borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.surface1 },
  track: { height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: P.surface4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: P.accent },
  pollCard: { gap: 12, padding: 14, borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.canvas },
  pollHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  option: { flex: 1, height: 48, color: P.ink, paddingHorizontal: 14, borderRadius: R.md, borderCurve: "continuous", borderWidth: 1, borderColor: P.line, backgroundColor: P.surface2 },
  addOption: { alignSelf: "flex-start" },
  durations: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.surface2 },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceList: { gap: 10, paddingTop: 16 },
});
