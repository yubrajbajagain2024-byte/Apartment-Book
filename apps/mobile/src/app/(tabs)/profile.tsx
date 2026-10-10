import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfileView } from "@/components/profile/profile-view";
import { Button, EmptyState, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

/**
 * The Profile tab: your own profile, TikTok style, with its own top bar (Find friends, your name with the account sheet,
 * and the menu with Settings and privacy, Saved, the legal pages and Log out). Signed out, it asks you to join.
 */
export default function ProfileTab() {
  const { user, loading } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!loading && !user) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
        <EmptyState
          icon="person-circle-outline"
          title="Join Apartment Book"
          body="Sign in with your university email to post, save and message."
          action={
            <View style={{ gap: 8, width: 220 }}>
              <Button title="Log in" onPress={() => router.push("/(auth)/login")} />
              <Button title="Create account" variant="secondary" onPress={() => router.push("/(auth)/signup")} />
            </View>
          }
        />
      </View>
    );
  }
  if (!user) return <Loading />;
  return <ProfileView key={user.id} userId={user.id} topBar />;
}
