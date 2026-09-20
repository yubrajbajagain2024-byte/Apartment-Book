import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Avatar } from "./avatar";

/** Header button that opens the Profile screen: your avatar, or a person icon when signed out. */
export function HeaderAvatar({ color = colors.text, inHeader = false }: { color?: string; inHeader?: boolean }) {
  const { user, profile } = useSession();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/(tabs)/profile")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Profile" style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginRight: inHeader ? 12 : 0 }}>
      {user ? <Avatar name={profile?.full_name} url={profile?.avatar_url} size="sm" online={false} /> : <Ionicons name="person-circle-outline" size={32} color={color} />}
    </Pressable>
  );
}
