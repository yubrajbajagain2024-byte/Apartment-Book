import { useCallback, useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { BUZZ_COMPOSER_COPY, formatDate, getBuzzPostingStatus, type BuzzPostingStatus } from "@apartment-book/shared";
import { buzzState, useBuzzState, type BuzzUiState } from "@/lib/buzz-store";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { HERO_SOFT_GRADIENT, MaskDisc, MaskGlyph, P, R, T } from "./ui";

/*
 * The composer half of the anonymity firewall (UniVerse's components/Composer.tsx): the "You're anonymous" banner every
 * Buzz create surface carries, and ComposerGuard, which swaps the composer's actions for "Muted until {date} · Details"
 * while the account cannot post (a mute, a suspension, a ban, or a warning to read first), so the screen never offers a
 * button the server would refuse.
 */

/** How long a posting status read is trusted before it is asked again. */
const FRESH_MS = 60_000;

const selectPosting = (s: BuzzUiState) => s.posting;

/** Whether the person may post right now and when polls unlock; asked again when stale or after a refusal. */
export function useBuzzPostingStatus(enabled = true): BuzzPostingStatus | null {
  const { user } = useSession();
  const posting = useBuzzState(selectPosting);
  const fetchStatus = useCallback(() => {
    getBuzzPostingStatus(supabase).then(
      (value) => buzzState.setPosting(value),
      () => {
        // Unknown: the composer stays usable and the server checks again when it posts.
      },
    );
  }, []);
  const stale = posting.value === null || Date.now() - posting.at > FRESH_MS;
  useEffect(() => {
    if (enabled && user && stale) fetchStatus();
  }, [enabled, user, stale, fetchStatus]);
  return posting.value;
}

/**
 * The banner: the mask and "YOU'RE ANONYMOUS" on the soft Phosphor gradient, with its note (the small-campus warning
 * where details can identify people). `inline` is the one-line pill of the reply bar.
 */
export function ComposerModeBanner({ note, inline, style }: { note?: string; inline?: boolean; style?: StyleProp<ViewStyle> }) {
  if (inline) {
    return (
      <View style={[styles.inline, style]} accessible accessibilityLabel={BUZZ_COMPOSER_COPY.banner}>
        <View style={styles.inlineDisc}>
          <MaskGlyph size={14} />
        </View>
        <Text style={[T.caption, { color: P.accentInk }]}>{BUZZ_COMPOSER_COPY.banner}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.banner, style]} accessible accessibilityLabel={`${BUZZ_COMPOSER_COPY.banner}. ${note ?? BUZZ_COMPOSER_COPY.defaultNote}`}>
      <MaskDisc size={40} glyph={20} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[T.overline, { color: P.accentInk }]}>{BUZZ_COMPOSER_COPY.banner}</Text>
        <Text style={[T.caption, { color: P.ink2 }]}>{note ?? BUZZ_COMPOSER_COPY.defaultNote}</Text>
      </View>
    </View>
  );
}

/** The composer's actions, or the disabled bar that says why posting is paused, with Details (Account status). */
export function ComposerGuard({ status, children, onDetails, style }: { status: BuzzPostingStatus | null; children: ReactNode; onDetails?: () => void; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  if (!status || status.allowed) return <>{children}</>;
  const text =
    status.reason === "warning"
      ? "Read the warning on your account to post again"
      : status.mutedUntil
        ? `${status.reason === "suspended" ? "Suspended" : "Muted"} until ${formatDate(new Date(status.mutedUntil).toISOString())}`
        : status.reason === "banned"
          ? "Your account can no longer post"
          : "Posting is paused on your account";
  return (
    <View style={[styles.guard, style]} accessibilityRole="summary">
      <Text style={[T.footnote, styles.flex, { color: P.ink2 }]} numberOfLines={2}>
        {text}
      </Text>
      <Pressable
        onPress={() => {
          onDetails?.();
          router.push("/settings/account-status" as never);
        }}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityLabel="Details"
        accessibilityHint="Opens your account status"
      >
        <Text style={[T.labelSm, { color: P.accentInk }]}>Details</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: R.lg, borderCurve: "continuous", borderWidth: 1, borderColor: P.accentLine, backgroundColor: P.surface2, experimental_backgroundImage: HERO_SOFT_GRADIENT },
  inline: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 12, paddingVertical: 3, borderRadius: R.pill, backgroundColor: P.surface2, experimental_backgroundImage: HERO_SOFT_GRADIENT },
  inlineDisc: { width: 24, height: 24, borderRadius: 12, backgroundColor: P.accentSoft, alignItems: "center", justifyContent: "center" },
  guard: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: R.lg, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: P.line, backgroundColor: P.surface3 },
});
