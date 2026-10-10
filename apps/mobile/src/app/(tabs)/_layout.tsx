import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HeaderActions } from "@/components/header-actions";
import { useSession } from "@/lib/session";
import { useAppTheme } from "@/lib/theme-provider";
import { useUnreadCount } from "@/lib/use-unread";

/** Home | Housing (Apartments | Roommates) | Messages | Marketplace | Profile; the Search magnifier sits in the top-right corner of every tab, like TikTok. */
export default function TabsLayout() {
  const { user } = useSession();
  const unread = useUnreadCount(user?.id ?? null);
  const { colors, isDark } = useAppTheme();
  // The header's own shadow barely shows on black, so in dark a hairline marks its edge, like the tab bar's. Light keeps its shadow.
  const headerStyle = isDark ? { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : { backgroundColor: colors.bar };
  return (
    <Tabs backBehavior="history" screenOptions={{ tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.muted, headerStyle, headerTitleStyle: { fontWeight: "700", color: colors.text }, tabBarStyle: { backgroundColor: colors.bar, borderTopColor: colors.border }, sceneStyle: { backgroundColor: colors.bg }, headerRight: () => <HeaderActions inHeader /> }}>
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="housing" options={{ title: "Housing", tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="marketplace" options={{ title: "Marketplace", tabBarIcon: ({ color, size }) => <Ionicons name="bag-handle-outline" size={size} color={color} /> }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
