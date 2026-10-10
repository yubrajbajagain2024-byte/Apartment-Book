import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { qrMatrix } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { SITE_URL } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";

/** Blank modules around the code: scanners need four. */
const QUIET_ZONE = 4;
const QR_SIZE = 216;

/** The website link a profile's QR code and Share open. */
export function profileUrl(profileId: string): string {
  return `${SITE_URL}/profile/${profileId}`;
}

/** The browser's share sheet and clipboard, on the web build only (the phone uses the system share sheet). */
function webNavigator(): Navigator | null {
  return Platform.OS === "web" && typeof navigator !== "undefined" ? navigator : null;
}

/**
 * "Share profile": the profile's QR code (scan it to open the profile on the website, which offers the app), the name and
 * @username, Share (the system share sheet, or the browser's where it has one) and, on the web, Copy link. Opened from
 * Share profile and from the QR icon beside the @username.
 */
export function ShareProfileSheet({ visible, onClose, profileId, name, username, avatarUrl, own }: { visible: boolean; onClose: () => void; profileId: string; name: string; username: string | null; avatarUrl: string | null; own: boolean }) {
  const insets = useSafeAreaInsets();
  const url = profileUrl(profileId);
  const matrix = useMemo(() => qrMatrix(url), [url]);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (copiedTimer.current && clearTimeout(copiedTimer.current)), []);
  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  const web = webNavigator();
  const canShare = Platform.OS !== "web" || typeof web?.share === "function";
  const first = name.trim().split(/\s+/)[0] || name;
  const label = own ? "QR code for your profile" : `QR code for ${first}'s profile`;
  const words = `${name}${username ? ` (@${username})` : ""} on Apartment Book`;

  async function share() {
    try {
      // iOS shares the link as a link (with its preview) next to the words; Android and the web take one text.
      await Share.share(Platform.OS === "ios" ? { message: words, url } : { message: `${words}: ${url}`, url, title: words });
    } catch {
      // Closed, or no share sheet here: nothing to do.
    }
  }

  async function copy() {
    try {
      if (!web?.clipboard) {
        // No clipboard API (a page served over plain http): the browser's own box lets the link be copied by hand.
        globalThis.prompt?.("Copy this link", url);
        return;
      }
      await web.clipboard.writeText(url);
      hapticSuccess();
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close share profile" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
          <View style={styles.header}>
            <View style={styles.grabber} />
            <Text style={styles.title} accessibilityRole="header">
              Share profile
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.body}>
            <View style={styles.card}>
              <QrCode matrix={matrix} size={QR_SIZE} label={label} />
              <View style={styles.who}>
                <Avatar name={name} url={avatarUrl} size="sm" online={false} />
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                  {username ? (
                    <Text style={styles.handle} numberOfLines={1}>
                      @{username}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
            <Text style={styles.hint}>Scan with a phone camera to open {own ? "your" : `${first}'s`} profile.</Text>
            <View style={styles.actions}>
              {canShare ? <Button title="Share" icon="share-outline" onPress={() => void share()} style={{ flex: 1 }} /> : null}
              {web ? <Button title={copied ? "Link copied" : "Copy link"} variant="secondary" icon={copied ? "checkmark" : "link-outline"} onPress={() => void copy()} style={{ flex: 1 }} /> : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Light and dark runs of one row, so a row is a handful of Views instead of one per module. */
function runsOf(row: boolean[]): { dark: boolean; length: number }[] {
  const runs: { dark: boolean; length: number }[] = [];
  for (const dark of row) {
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.length += 1;
    else runs.push({ dark, length: 1 });
  }
  return runs;
}

/**
 * The code drawn with plain Views: a white square with the quiet zone around it, then each row of modules as black and
 * white runs. Modules are whole points, so rows meet without hairline seams.
 */
function QrCode({ matrix, size, label }: { matrix: boolean[][]; size: number; label: string }) {
  const n = matrix.length;
  const cell = Math.max(2, Math.floor(size / (n + QUIET_ZONE * 2)));
  const rows = useMemo(() => matrix.map(runsOf), [matrix]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.qr, { padding: cell * QUIET_ZONE }]}>
      {rows.map((runs, y) => (
        <View key={y} style={{ flexDirection: "row", height: cell }}>
          {runs.map((r, x) => (
            <View key={x} style={{ width: r.length * cell, height: cell, backgroundColor: r.dark ? "#000" : "#fff" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, overflow: "hidden" },
  header: { alignItems: "center", paddingTop: space.sm, paddingBottom: 10, paddingHorizontal: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  close: { position: "absolute", right: 12, top: 16, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  body: { alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  card: { alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  qr: { backgroundColor: "#fff" },
  who: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 },
  name: { fontSize: 16, fontWeight: "800", color: colors.text },
  handle: { fontSize: 14, color: colors.muted },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  actions: { flexDirection: "row", gap: space.sm, alignSelf: "stretch" },
});
