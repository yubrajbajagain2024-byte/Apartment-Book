import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { qrMatrix } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { SITE_URL } from "@/lib/supabase";
import { radius, space, sheetShape, textStyle } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";
import { Sheet, SheetHeader } from "@/components/sheet";

/** Blank modules around the code: scanners need four. */
const QUIET_ZONE = 4;
const QR_SIZE = 216;
/**
 * The code stays black modules on a white square in both themes, never theme colours: cameras and scanners read dark
 * on light, and many cannot read a code drawn light on dark.
 */
const QR_DARK = "#000";
const QR_LIGHT = "#fff";

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
  const styles = useStyles();
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
  const words = `${name}${username ? ` (@${username})` : ""} on CampConnect`;

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
    // Nothing in it scrolls, so a drag anywhere on the sheet pulls it down.
    <Sheet visible={visible} onClose={onClose} closeLabel="Close share profile" draggable="sheet" style={{ paddingBottom: Math.max(insets.bottom - sheetShape.marginBottom, space.lg) + space.sm }}>
      <SheetHeader title="Share profile" onClose={onClose} />
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
          {canShare ? <Button title="Share" size="large" icon="share-outline" onPress={() => void share()} style={{ flex: 1 }} /> : null}
          {web ? <Button title={copied ? "Link copied" : "Copy link"} size="large" variant="secondary" icon={copied ? "checkmark" : "link-outline"} onPress={() => void copy()} style={{ flex: 1 }} /> : null}
        </View>
      </View>
    </Sheet>
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
  const styles = useStyles();
  const n = matrix.length;
  const cell = Math.max(2, Math.floor(size / (n + QUIET_ZONE * 2)));
  const rows = useMemo(() => matrix.map(runsOf), [matrix]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.qr, { padding: cell * QUIET_ZONE }]}>
      {rows.map((runs, y) => (
        <View key={y} style={{ flexDirection: "row", height: cell }}>
          {runs.map((r, x) => (
            <View key={x} style={{ width: r.length * cell, height: cell, backgroundColor: r.dark ? QR_DARK : QR_LIGHT }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  // The hairline outline keeps the card apart from the sheet in dark mode, where the shadow does not show.
  card: { alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  qr: { backgroundColor: QR_LIGHT },
  who: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 },
  name: { ...textStyle.headline, color: colors.text },
  handle: { fontSize: 14, color: colors.muted },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  actions: { flexDirection: "row", gap: space.sm, alignSelf: "stretch" },
}));
