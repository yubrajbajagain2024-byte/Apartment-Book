import { Linking, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_NAME, BUSINESS_PORTAL_NAME } from "@apartment-book/shared";
import { SITE_URL } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "./icon";
import { Button } from "./ui";

/** Where the business portal lives: its own address when the build names one, else /business on the website. */
export const BUSINESS_PORTAL_URL = (process.env.EXPO_PUBLIC_BUSINESS_SITE_URL ?? `${SITE_URL}/business`).replace(/\/$/, "");

/**
 * What a business account sees in the student app: nothing of the student side (feeds, people, chats), only where its
 * work happens. Listings, deals and replies to students are all in the business portal on the web.
 */
export function BusinessAccountNotice() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.icon}>
        <Icon name="briefcase-outline" sf="briefcase" size={30} color={colors.brand} />
      </View>
      <Text style={styles.title}>This is a business account</Text>
      <Text style={styles.body}>
        {APP_NAME} is for students. Your listings, deals, team and students' messages are in {BUSINESS_PORTAL_NAME}, on the web.
      </Text>
      <View style={styles.actions}>
        <Button title={`Open ${BUSINESS_PORTAL_NAME}`} icon="open-outline" onPress={() => void Linking.openURL(BUSINESS_PORTAL_URL)} />
        <Button title="Log out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl, backgroundColor: colors.bg },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: "center", maxWidth: 340 },
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.md },
}));
