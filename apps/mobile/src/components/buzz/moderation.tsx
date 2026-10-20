import { useCallback, useRef, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { buzzErrorMessage, isBuzzError, type AuthorNotice, type ContentBlockedDetails, type SupportResources } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { openGuidelines } from "@/lib/buzz-actions";
import { buzzState } from "@/lib/buzz-store";
import { hapticError } from "@/lib/haptics";
import { BuzzSheet } from "./sheet";
import { P, PButton, T } from "./ui";

/*
 * The write-time side of moderation (UniVerse's lib/moderation + ModerationHost), for the composer and the reply bar:
 *  - 422 `content_blocked`: a sheet with the engine's title and words, [Edit], [Read the guidelines] and, when the text
 *    named someone, [Get help reporting]; then the support sheet when the details carry resources;
 *  - a muted, suspended or banned account, or a warning to read first: the composer's guard takes over (posting status);
 *  - 429: "You're going fast…";
 *  - after a successful write: "Held for review" when the safety team looks first, and the support sheet when the words
 *    touched on self-harm (S-HEAD / S-BODY).
 * The sheets render inside the caller's own tree (`element`), so from the composer they rise over the composer itself.
 */

const HELD_BODY = "Your post is with our safety team before it goes live. This usually takes under a day. You don't need to do anything.";

type Blocked = { details: ContentBlockedDetails; body: string; onEdit?: () => void };

export function useBuzzModeration() {
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [support, setSupport] = useState<SupportResources | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const afterSupport = useRef<(() => void) | null>(null);

  /** Handles what a create call threw. Returns true when the error was a moderation outcome shown here. */
  const handleWriteError = useCallback((e: unknown, opts?: { onEdit?: () => void }): boolean => {
    if (isBuzzError(e, "content_blocked")) {
      hapticError();
      const d = (e.details ?? {}) as Partial<ContentBlockedDetails>;
      const details: ContentBlockedDetails = {
        messageId: d.messageId ?? "M-GENERIC",
        title: d.title ?? (e.message || "This can't be posted"),
        category: d.category ?? null,
        guidelineAnchor: d.guidelineAnchor ?? null,
        support: d.support ?? null,
      };
      // The API's `message` is the person-facing body (safety §2.10); `details` carries the rest.
      setBlocked({ details, body: e.message && e.message !== details.title ? e.message : "", onEdit: opts?.onEdit });
      setBlockedOpen(true);
      return true;
    }
    if (isBuzzError(e, "muted") || isBuzzError(e, "suspended") || isBuzzError(e, "banned") || isBuzzError(e, "warning_unacknowledged") || isBuzzError(e, "too_new")) {
      // The composer's guard asks again and shows "Muted until … · Details".
      buzzState.setPosting(null);
      buzzState.toast(buzzErrorMessage(e), { tone: "error" });
      return true;
    }
    if (isBuzzError(e, "rate_limited")) {
      buzzState.toast("You're going fast. Take a breather and try again in a moment.", { tone: "error" });
      return true;
    }
    if (isBuzzError(e, "buzz_gate_required")) {
      buzzState.setGate("required");
      return true;
    }
    return false;
  }, []);

  /**
   * After a successful write: "Held for review" (a toast) and the support sheet. `onSupportClosed` runs once the support
   * sheet is gone (the composer closes then); with nothing to show it runs at once.
   */
  const showNotice = useCallback((n: AuthorNotice | undefined, opts?: { onSupportClosed?: () => void }) => {
    if (n?.status === "held") buzzState.toast(n.userMessage?.body ?? HELD_BODY, { title: n.userMessage?.title ?? "Held for review", duration: 7000 });
    if (n?.support) {
      afterSupport.current = opts?.onSupportClosed ?? null;
      setSupport(n.support);
      setSupportOpen(true);
      return;
    }
    opts?.onSupportClosed?.();
  }, []);

  const element: ReactNode = (
    <>
      {blocked ? (
        <BlockedSheet
          visible={blockedOpen}
          blocked={blocked}
          onClose={() => setBlockedOpen(false)}
          onDismiss={() => {
            const next = blocked.details.support;
            setBlocked(null);
            if (next) {
              setSupport(next);
              setSupportOpen(true);
            }
          }}
        />
      ) : null}
      {support ? (
        <SupportSheet
          visible={supportOpen}
          support={support}
          onClose={() => setSupportOpen(false)}
          onDismiss={() => {
            setSupport(null);
            const after = afterSupport.current;
            afterSupport.current = null;
            after?.();
          }}
        />
      ) : null}
    </>
  );

  return { handleWriteError, showNotice, element, open: blocked !== null || support !== null };
}

/** The 422 sheet: what the engine said, and the way back to the words. */
function BlockedSheet({ visible, blocked, onClose, onDismiss }: { visible: boolean; blocked: Blocked; onClose: () => void; onDismiss: () => void }) {
  const { details, body, onEdit } = blocked;
  const named = details.messageId === "M-NAMED";
  return (
    <BuzzSheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close">
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: P.warningSoft }]}>
          <MaterialCommunityIcons name="shield-alert-outline" size={28} color={P.warning} />
        </View>
        <Text style={[T.title2, styles.center, { color: P.ink }]} accessibilityRole="header">
          {details.title}
        </Text>
        {body ? <Text style={[T.body, styles.center, { color: P.ink2 }]}>{body}</Text> : null}
      </View>
      <View style={styles.actions}>
        <PButton
          title="Edit"
          icon="create-outline"
          size="lg"
          fullWidth
          onPress={() => {
            onClose();
            onEdit?.();
          }}
        />
        <PButton
          title="Read the guidelines"
          icon="book-outline"
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => {
            onClose();
            openGuidelines(details.guidelineAnchor);
          }}
        />
        {named ? (
          <PButton
            title="Get help reporting"
            icon="help-buoy-outline"
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => {
              onClose();
              openGuidelines("enforcement");
            }}
          />
        ) : null}
      </View>
    </BuzzSheet>
  );
}

function openLine(href: string) {
  if (/^https?:/i.test(href)) void WebBrowser.openBrowserAsync(href, { controlsColor: P.accent, toolbarColor: P.canvas, dismissButtonStyle: "close" }).catch(() => {});
  else void Linking.openURL(href).catch(() => {});
}

/** Support resources (self-harm): the first line as the main action, the rest behind "More options", and the way out. */
function SupportSheet({ visible, support, onClose, onDismiss }: { visible: boolean; support: SupportResources; onClose: () => void; onDismiss: () => void }) {
  const [more, setMore] = useState(false);
  const [first, ...rest] = support.lines;
  return (
    <BuzzSheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close">
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: P.infoSoft }]}>
          <MaterialCommunityIcons name="hand-heart-outline" size={28} color={P.info} />
        </View>
        <Text style={[T.title2, styles.center, { color: P.ink }]} accessibilityRole="header">
          {support.headline}
        </Text>
        <Text style={[T.body, styles.center, { color: P.ink2 }]}>{support.body}</Text>
      </View>
      <View style={styles.actions}>
        {first ? <PButton title={first.label} size="lg" fullWidth onPress={() => openLine(first.href)} accessibilityHint={first.detail} /> : null}
        {rest.length > 0 && !more ? <PButton title="More options" variant="secondary" size="lg" fullWidth onPress={() => setMore(true)} /> : null}
        {more ? rest.map((line) => <PButton key={line.href} title={`${line.label} · ${line.detail}`} variant="secondary" size="lg" fullWidth onPress={() => openLine(line.href)} />) : null}
        <PButton title="I'm OK, thanks" variant="ghost" size="lg" fullWidth onPress={onClose} />
        <View style={styles.note}>
          <Icon name="information-circle-outline" size={14} color={P.ink3} />
          <Text style={[T.caption, styles.flex, { color: P.ink3 }]}>{support.emergencyNote}</Text>
        </View>
      </View>
    </BuzzSheet>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 10, paddingTop: 16, paddingHorizontal: 8 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  actions: { gap: 8, paddingTop: 20, paddingBottom: 4 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingTop: 4, paddingHorizontal: 4 },
  flex: { flex: 1 },
});
