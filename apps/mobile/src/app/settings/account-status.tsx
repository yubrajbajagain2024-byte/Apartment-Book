import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  acknowledgeSanction,
  formatDate,
  getBuzzPostingStatus,
  listMySanctions,
  MODERATION_CATEGORY_LABELS,
  SANCTION_KIND_LABELS,
  submitAppeal,
  type BuzzPostingStatus,
  type SanctionNotice,
} from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { Badge, Button, Card, EmptyState, ErrorBanner } from "@/components/ui";
import { buzzState } from "@/lib/buzz-store";
import { hapticSuccess, refreshWithHaptic } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { SITE_URL, supabase } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { makeStyles, useAppTheme, useColors } from "@/lib/theme-provider";

/*
 * Settings → Account status (UniVerse's AccountStatusPage): how the account stands, then every notice about your own
 * content and account (warnings, mutes, suspensions, bans, removed content), newest first, each with its guideline,
 * "Got it" for one not read yet and, where it can be appealed, an appeal (one per notice, within 14 days, read by a
 * different reviewer than the one who acted). Only you ever see this list.
 */

const APPEAL_LABEL: Record<SanctionNotice["appealStatus"], string | null> = {
  none: null,
  open: "Appeal under review",
  upheld: "Appeal reviewed: decision stands",
  reversed: "Appeal accepted",
  reduced: "Appeal reviewed: reduced",
};
/** UniVerse's LIMITS.appealText; an appeal needs at least a sentence. */
const APPEAL_MAX = 1000;
const APPEAL_MIN = 10;

function day(ms: number): string {
  return formatDate(new Date(ms).toISOString());
}

function openGuideline(anchor?: string | null) {
  void WebBrowser.openBrowserAsync(`${SITE_URL}/guidelines${anchor ? `#${anchor}` : ""}`, { dismissButtonStyle: "close" }).catch(() => {});
}

/** The restriction in force now, if any: a mute, a suspension or a ban that has started and not ended. */
function activeRestriction(items: SanctionNotice[]): SanctionNotice | null {
  const now = Date.now();
  return items.find((n) => (n.kind === "mute" || n.kind === "suspension" || n.kind === "ban") && n.startsAt <= now && (n.until === null || n.until > now)) ?? null;
}

export default function AccountStatusScreen() {
  const styles = useStyles();
  const colors = useColors();
  const [items, setItems] = useState<SanctionNotice[] | null>(null);
  const [posting, setPosting] = useState<BuzzPostingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([listMySanctions(supabase), getBuzzPostingStatus(supabase).catch(() => null)]);
      setItems(list ?? []);
      setPosting(status);
      if (status) buzzState.setPosting(status);
      setError(null);
    } catch (e) {
      setError(errorText(e, "Could not load your account status."));
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = items ? activeRestriction(items) : null;
  const scopeWords = (n: SanctionNotice) => (n.scope === "buzz_only" ? " on Buzz" : n.scope === "requests" ? " for new requests" : "");
  const standing = active
    ? active.kind === "ban"
      ? "Your account is permanently banned."
      : active.kind === "suspension"
        ? `Your account is suspended${active.until ? ` until ${day(active.until)}` : ""}.`
        : `You're muted${active.until ? ` until ${day(active.until)}` : ""}${scopeWords(active)}.`
    : posting && !posting.allowed && posting.reason === "warning"
      ? "Read the warning below to post on Buzz again."
      : "Your account is in good standing.";
  const warn = Boolean(active) || (posting !== null && !posting.allowed);

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshWithHaptic(() => {
            setRefreshing(true);
            void load();
          })}
        />
      }
    >
      <Stack.Screen options={{ title: "Account status" }} />
      <Card style={[styles.standing, warn ? { backgroundColor: colors.warningSoft, borderColor: "transparent" } : null]}>
        <View style={[styles.standingIcon, { backgroundColor: warn ? colors.card : colors.successSoft }]}>
          {warn ? <MaterialCommunityIcons name="shield-alert-outline" size={22} color={colors.warningText} /> : <Icon name="shield-checkmark-outline" size={22} color={colors.successText} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.standingTitle} accessibilityRole="header">
            {items === null && !error ? "Checking your account…" : standing}
          </Text>
          <Text style={styles.muted}>Notices about your own content and account appear below. Only you can see them.</Text>
        </View>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {items === null && !error ? (
        <ActivityIndicator style={{ paddingVertical: 24 }} color={colors.brand} />
      ) : items && items.length === 0 ? (
        <EmptyState icon="shield-checkmark-outline" title="Nothing on your record." body="Warnings, removals and restrictions would show up here." />
      ) : (
        items?.map((n) => <NoticeCard key={n.id} notice={n} onChanged={() => void load()} />)
      )}

      <Button title="Community Guidelines" variant="secondary" icon="book-outline" onPress={() => openGuideline()} />
    </ScrollView>
  );
}

function NoticeCard({ notice, onChanged }: { notice: SanctionNotice; onChanged: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { isDark } = useAppTheme();
  const [appealing, setAppealing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"ack" | "appeal" | null>(null);
  const tone = notice.kind === "suspension" || notice.kind === "ban" ? "danger" : notice.kind === "removal" ? "neutral" : "warning";
  const iconColor = tone === "danger" ? colors.dangerText : tone === "warning" ? colors.warningText : colors.muted;
  const iconBg = tone === "danger" ? colors.dangerSoft : tone === "warning" ? colors.warningSoft : colors.input;
  const icon: keyof typeof MaterialCommunityIcons.glyphMap = notice.kind === "warning" ? "alert-outline" : notice.kind === "mute" ? "microphone-off" : notice.kind === "removal" ? "delete-outline" : "cancel";
  const category = notice.category ? MODERATION_CATEGORY_LABELS[notice.category] : null;
  const appealLabel = APPEAL_LABEL[notice.appealStatus];
  const ended = notice.until !== null && notice.until <= Date.now();
  const canAppeal = notice.canAppeal && notice.appealStatus === "none";

  const ack = async () => {
    setBusy("ack");
    try {
      await acknowledgeSanction(supabase, notice.id);
      // Posting may resume once every warning is read: the composer asks again.
      buzzState.setPosting(null);
      onChanged();
    } catch (e) {
      Alert.alert("Could not save", errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const appeal = async () => {
    if (text.trim().length < APPEAL_MIN) return;
    setBusy("appeal");
    try {
      await submitAppeal(supabase, notice.id, text);
      hapticSuccess();
      setAppealing(false);
      setText("");
      Alert.alert("Appeal sent", "A different reviewer will look at it.");
      onChanged();
    } catch (e) {
      Alert.alert("Could not send the appeal", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <View style={styles.noticeHead}>
        <View style={[styles.noticeIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.badges}>
            <Text style={styles.kind}>{SANCTION_KIND_LABELS[notice.kind]}</Text>
            {notice.scope !== "all" ? <Badge label={notice.scope === "buzz_only" ? "Buzz only" : "Requests only"} /> : null}
            {appealLabel ? <Badge label={appealLabel} tone={notice.appealStatus === "reversed" ? "green" : notice.appealStatus === "open" ? "blue" : "gray"} /> : null}
          </View>
          <Text style={styles.muted}>
            {category ? `Guideline: ${category}` : "Community Guidelines"}
            {notice.contentLabel ? ` · your ${notice.contentLabel}` : ""}
          </Text>
          <Text style={styles.dates}>
            {day(notice.startsAt)}
            {notice.until ? ` – ${day(notice.until)}` : notice.kind === "ban" ? " – permanent" : ""}
            {ended ? " · ended" : ""}
          </Text>
        </View>
      </View>
      {notice.contentExcerpt ? <Text style={styles.quote}>“{notice.contentExcerpt}”</Text> : null}
      <View style={styles.actions}>
        {notice.guidelineAnchor ? <Button title="Read the guideline" variant="ghost" size="compact" icon="book-outline" onPress={() => openGuideline(notice.guidelineAnchor)} /> : null}
        {notice.acknowledgedAt === null ? <Button title="Got it" variant="secondary" size="compact" icon="checkmark" loading={busy === "ack"} onPress={() => void ack()} /> : null}
        {canAppeal && !appealing ? <Button title="Appeal" size="compact" onPress={() => setAppealing(true)} /> : null}
      </View>
      {canAppeal && notice.appealDeadline ? <Text style={styles.muted}>Appeal by {day(notice.appealDeadline)}</Text> : null}
      {appealing ? (
        <View style={styles.appeal}>
          <Text style={styles.label}>Why should this be reviewed?</Text>
          <Text style={styles.muted}>Read by the Trust & Safety team only.</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Tell us what we got wrong. Be specific."
            placeholderTextColor={colors.faint}
            keyboardAppearance={isDark ? "dark" : "light"}
            multiline
            maxLength={APPEAL_MAX}
            style={styles.input}
            accessibilityLabel="Why should this be reviewed?"
          />
          <Text style={[styles.muted, { alignSelf: "flex-end" }]}>
            {text.length}/{APPEAL_MAX}
          </Text>
          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" size="compact" disabled={busy === "appeal"} onPress={() => setAppealing(false)} />
            <Button title="Send appeal" size="compact" loading={busy === "appeal"} disabled={text.trim().length < APPEAL_MIN} onPress={() => void appeal()} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  page: { padding: 16, gap: 14, paddingBottom: 48 },
  standing: { flexDirection: "row", alignItems: "center" },
  standingIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  standingTitle: { ...textStyle.headline, color: colors.text },
  muted: { ...textStyle.footnote, color: colors.muted },
  noticeHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  noticeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  kind: { ...textStyle.headline, color: colors.text },
  dates: { ...textStyle.caption1, color: colors.faint, fontVariant: ["tabular-nums"] },
  quote: { ...textStyle.footnote, color: colors.muted, backgroundColor: colors.input, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  appeal: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { minHeight: 96, maxHeight: 200, textAlignVertical: "top", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text },
}));
