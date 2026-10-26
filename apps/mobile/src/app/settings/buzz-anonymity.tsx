import { ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { BUZZ_ANONYMITY_ANCHOR } from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { phosphor } from "@/lib/palette";
import { SITE_URL } from "@/lib/supabase";
import { textStyle } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/** One heading and its words (or points). */
type Section = { title: string; body?: string; points?: string[] };

/**
 * UniVerse's BuzzAnonymityPage, in this app's words (Search and Orbit for Discover and Orbit, "hide an anon" as the
 * menu says it) plus the one rule this app adds: posts publish after a short random delay.
 */
const SECTIONS: Section[] = [
  {
    title: "What other students see",
    body: "Every buzz and reply shows an alias like “Anon Comet” instead of your profile. The alias is derived from the thread and your account, so it stays the same inside one thread and cannot be matched across threads. Nothing in Buzz links to your name, handle, avatar or campus profile. Buzzes and replies appear after a short random delay, so the time they show cannot pin down when you wrote them.",
  },
  {
    title: "Where Buzz never appears",
    points: [
      "Your public profile, Search and Orbit never show anything you posted in Buzz.",
      "Buzz notifications never carry a name — only “Someone replied to your buzz”.",
      "Following or blocking someone has no effect inside Buzz, in either direction.",
    ],
  },
  {
    title: "What the developers can see",
    body: "Buzz is monitored under the Community Guidelines. Moderators act on content without seeing who wrote it. Only an admin can connect a buzz to an account, only through a written-reason request that is recorded in a permanent audit log, and only for serious safety cases such as threats, harassment campaigns or content involving minors.",
  },
  {
    title: "What you control",
    points: [
      "Delete any of your buzzes from My buzzes at any time.",
      "Hide a thread, or hide an anon inside a thread, when you do not want to see it.",
      "Report anything that breaks the guidelines — reports are reviewed within a day.",
    ],
  },
];

/** Settings → How Buzz anonymity works: what students see, what moderators and admins can, and what you control. */
export default function BuzzAnonymityScreen() {
  const router = useRouter();
  const styles = useStyles();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: "How Buzz anonymity works" }} />
      <View style={styles.hero} accessible accessibilityLabel="Anonymous to students. Monitored by the developers.">
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="domino-mask" size={22} color={phosphor.accent} />
        </View>
        <Text style={styles.heroText}>Anonymous to students. Monitored by the developers.</Text>
      </View>
      {SECTIONS.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={styles.h2} accessibilityRole="header">
            {s.title}
          </Text>
          {s.body ? <Text style={styles.p}>{s.body}</Text> : null}
          {s.points?.map((p) => (
            <View key={p} style={styles.point}>
              <Text style={styles.bullet}>•</Text>
              <Text style={[styles.p, { flex: 1 }]}>{p}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.actions}>
        <Button title="Read it in the guidelines" variant="secondary" icon="book-outline" onPress={() => void WebBrowser.openBrowserAsync(`${SITE_URL}/guidelines#${BUZZ_ANONYMITY_ANCHOR}`, { dismissButtonStyle: "close" }).catch(() => {})} />
        <Button title="My buzzes" variant="ghost" onPress={() => router.push("/buzz/mine" as never)} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  page: { padding: 16, gap: 22, paddingBottom: 48 },
  // The one Phosphor piece on this page: Buzz's own world, the same in both themes.
  hero: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 20, borderCurve: "continuous", backgroundColor: phosphor.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: phosphor.accentLine },
  heroIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: phosphor.surface3, alignItems: "center", justifyContent: "center" },
  heroText: { flex: 1, ...textStyle.headline, color: phosphor.ink },
  section: { gap: 8 },
  h2: { ...textStyle.title3, color: colors.text },
  p: { ...textStyle.callout, lineHeight: 23, color: colors.muted },
  point: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  bullet: { ...textStyle.callout, lineHeight: 23, color: colors.muted },
  actions: { gap: 8 },
}));
