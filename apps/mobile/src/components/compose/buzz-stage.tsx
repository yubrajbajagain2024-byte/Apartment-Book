import { useEffect, useRef } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, withSpring, withTiming } from "react-native-reanimated";
import { BUZZ_COMPOSER_COPY, BUZZ_FEED_COPY, BUZZ_LIMITS, type BuzzScope } from "@apartment-book/shared";
import { BuzzGatePanel, useBuzzGate } from "@/components/buzz/gate";
import { ComposerGuard, ComposerModeBanner, useBuzzPostingStatus } from "@/components/buzz/guard";
import { BuzzPollEditor } from "@/components/buzz/poll-editor";
import { BuzzToastHost } from "@/components/buzz/toast";
import { Chip, ErrorState, P, PButton, Segmented, T } from "@/components/buzz/ui";
import { buzzDraftCheck, useBuzzSubmit } from "@/components/buzz/use-buzz-submit";
import { Icon } from "@/components/icon";
import { useReduceMotion } from "@/lib/accessibility";
import { ensureBuzzMeta } from "@/lib/buzz-actions";
import { buzzState, useBuzzState, type BuzzUiState } from "@/lib/buzz-store";

const selectDraft = (s: BuzzUiState) => s.draft;
const selectMeta = (s: BuzzUiState) => s.meta;
const selectCampus = (s: BuzzUiState) => s.campus;

const SCOPES = [
  { value: "campus" as const, label: "Campus", icon: "school-outline" as const },
  { value: "global" as const, label: "Global", icon: "globe-outline" as const },
];

/** Room left at the top of the stage for the camera screen's own row (Close, and the mode's pill). */
const TOP_ROW = 68;

/** The composer coming in: up 16 points into place on UIKit's critically damped spring as it fades in. */
function rise() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 16 }] },
    animations: { opacity: withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }), transform: [{ translateY: withSpring(0, { damping: 34, stiffness: 290, mass: 1 }) }] },
  };
}

/**
 * BUZZ on the create camera: the stage turns from the camera into a quiet text composer for a thought, an opinion or a
 * question, posted anonymously, in Buzz's own Phosphor look. "You're anonymous" first (with the small-campus warning
 * when details could give someone away), an optional title, the words in large type with their count, Campus | Global
 * with what each means, an optional poll for a question, and "Buzz it". It edits the same draft as the composer on
 * Home's Buzz page, so nothing typed in one is lost in the other. Until the guidelines are accepted the stage shows the
 * gate instead ("Not now" goes back to POST); a paused account sees why in place of the button.
 */
export function BuzzStage({ stageTop, onLeave, onPosted }: { stageTop: number; onLeave: () => void; onPosted: () => void }) {
  const reduce = useReduceMotion();
  const gate = useBuzzGate();
  const accepted = gate.status === "accepted";
  return (
    <Animated.View entering={reduce ? undefined : FadeIn.duration(180)} exiting={reduce ? undefined : FadeOut.duration(150)} style={styles.stage}>
      {accepted ? (
        <Animated.View entering={reduce ? undefined : rise} style={styles.flex}>
          <Composer stageTop={stageTop} onPosted={onPosted} />
        </Animated.View>
      ) : gate.status === "required" ? (
        <ScrollView contentContainerStyle={styles.gate} keyboardShouldPersistTaps="handled">
          <BuzzGatePanel variant="pane" onDismiss={onLeave} />
        </ScrollView>
      ) : gate.status === "error" ? (
        <View style={styles.center}>
          <ErrorState title={BUZZ_FEED_COPY.loadError} message={gate.error} onRetry={gate.retry} />
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={P.accent} />
        </View>
      )}
    </Animated.View>
  );
}

function Composer({ stageTop, onPosted }: { stageTop: number; onPosted: () => void }) {
  const draft = useBuzzState(selectDraft);
  const meta = useBuzzState(selectMeta);
  const campus = useBuzzState(selectCampus);
  const posting = useBuzzPostingStatus(true);
  const titleRef = useRef<TextInputInstance>(null);
  const textRef = useRef<TextInputInstance>(null);
  const { submit, sending, moderation } = useBuzzSubmit({ onDone: onPosted, onEdit: () => textRef.current?.focus() });
  const { ready, pollsLocked } = buzzDraftCheck(draft, posting);
  const canSubmit = ready && !sending;
  const campusMeta = meta.campus?.value ?? null;
  const media = draft.images.length > 0 || draft.video !== null;

  // The campus's name and the small-campus note, as on the Buzz page.
  useEffect(() => {
    ensureBuzzMeta("campus");
  }, []);

  // The words are what this mode is for: the keyboard comes up once the stage has turned.
  useEffect(() => {
    const t = setTimeout(() => textRef.current?.focus(), 320);
    return () => clearTimeout(t);
    // Once, as BUZZ is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={stageTop}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <ComposerModeBanner note={campusMeta?.smallCampusNote ? BUZZ_COMPOSER_COPY.smallCampusNote : BUZZ_COMPOSER_COPY.defaultNote} />
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
            style={[styles.bare, styles.words]}
            accessibilityLabel="Your buzz"
            accessibilityHint="A thought, an opinion or a question. Posted anonymously."
          />
          <Text style={[T.caption, styles.count, { color: draft.text.length > BUZZ_LIMITS.text - 40 ? P.warning : P.ink3 }]} accessibilityLabel={`${draft.text.length} of ${BUZZ_LIMITS.text} characters`}>
            {draft.text.length}/{BUZZ_LIMITS.text}
          </Text>
        </View>
        {media ? (
          <View style={styles.mediaNote}>
            <Icon name="images-outline" size={15} color={P.ink3} />
            <Text style={[T.caption, styles.flex, { color: P.ink3 }]}>Your draft's {draft.video ? "video" : draft.images.length === 1 ? "photo" : "photos"} will be posted too. Change them on the Buzz page.</Text>
          </View>
        ) : null}
        {draft.pollOn ? <BuzzPollEditor /> : null}
        <View style={{ gap: 8 }}>
          <Segmented<BuzzScope> label="Post to" value={draft.scope} options={SCOPES} onChange={(scope) => buzzState.setDraft({ scope })} />
          <Text style={[T.caption, { color: P.ink3 }]}>{draft.scope === "campus" ? (campus?.shortName ? BUZZ_COMPOSER_COPY.campusScopeNote(campus.shortName) : "Only shows in your campus feed.") : BUZZ_COMPOSER_COPY.globalScopeNote}</Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <ComposerGuard status={posting}>
          <View style={styles.footerRow}>
            <Chip
              label="Poll"
              size="md"
              selected={draft.pollOn}
              disabled={pollsLocked && !draft.pollOn}
              onPress={() => buzzState.setDraft({ pollOn: !draft.pollOn })}
              iconNode={<Icon name="bar-chart-outline" size={17} color={draft.pollOn ? P.accentInk : P.ink2} />}
              accessibilityHint={pollsLocked ? BUZZ_COMPOSER_COPY.pollsLocked : "Ask a question with two to four answers"}
            />
            <Text style={[T.caption, styles.flex, { color: P.ink3 }]} numberOfLines={2}>
              {pollsLocked ? BUZZ_COMPOSER_COPY.pollsLocked : ""}
            </Text>
            <PButton title={BUZZ_COMPOSER_COPY.submit} variant="hero" disabled={!canSubmit} loading={sending} onPress={() => void (canSubmit && submit())} />
          </View>
        </ComposerGuard>
      </View>
      <BuzzToastHost bottom={84} />
      {moderation.element}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: P.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: TOP_ROW, paddingHorizontal: 16 },
  gate: { paddingTop: TOP_ROW, paddingHorizontal: 16, paddingBottom: 24 },
  body: { gap: 18, paddingHorizontal: 18, paddingTop: TOP_ROW, paddingBottom: 20 },
  bare: { color: P.ink, padding: 0, margin: 0, textAlignVertical: "top" },
  title: { minHeight: 28 },
  words: { minHeight: 132, maxHeight: 280, fontSize: 21, lineHeight: 29, fontWeight: "500" },
  count: { alignSelf: "flex-end", marginTop: 6, fontVariant: ["tabular-nums"] },
  mediaNote: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line, backgroundColor: P.canvas },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
