import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { HeaderActions } from "@/components/header-actions";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { UnreadProvider } from "@/lib/use-unread";

/** Home | Housing (Apartments | Roommates) | Marketplace | Profile; Messages and Search sit in the top-right corner of every tab, like TikTok. */
export default function TabsLayout() {
  const { user } = useSession();
  return (
    <UnreadProvider userId={user?.id ?? null}>
    <Tabs backBehavior="history" screenOptions={{ tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.muted, headerStyle: { backgroundColor: colors.card }, headerTitleStyle: { fontWeight: "700", color: colors.text }, tabBarStyle: { backgroundColor: colors.card }, sceneStyle: { backgroundColor: colors.bg }, headerRight: () => <HeaderActions inHeader /> }}>
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="housing" options={{ title: "Housing", tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="marketplace" options={{ title: "Marketplace", tabBarIcon: ({ color, size }) => <Ionicons name="bag-handle-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tabs>
    </UnreadProvider>
  );
}
