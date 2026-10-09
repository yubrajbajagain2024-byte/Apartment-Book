import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getTotalUnread } from "@apartment-book/shared";
import { HeaderAvatar } from "@/components/header-avatar";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { colors } from "@/lib/theme";

function useUnreadCount(userId: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    const refresh = () => getTotalUnread(supabase).then(setCount).catch(() => {});
    refresh();
    const channel = supabase
      .channel(`unread:${userId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
  return count;
}

/** The bottom bar: Home | Housing (Apartments | Roommates) | Marketplace | Messages. Profile is reached from the header avatar. */
export default function TabsLayout() {
  const { user } = useSession();
  const router = useRouter();
  const unread = useUnreadCount(user?.id ?? null);
  return (
    <Tabs backBehavior="history" screenOptions={{ tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.muted, headerStyle: { backgroundColor: colors.card }, headerTitleStyle: { fontWeight: "700", color: colors.text }, tabBarStyle: { backgroundColor: colors.card }, sceneStyle: { backgroundColor: colors.bg }, headerRight: () => <HeaderAvatar inHeader /> }}>
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="housing" options={{ title: "Housing", tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="marketplace" options={{ title: "Marketplace", tabBarIcon: ({ color, size }) => <Ionicons name="bag-handle-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-outline" size={size} color={color} /> }} />
      {/* Profile stays a route (opened from the header avatar) but is not in the bar. */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          href: null,
          headerRight: undefined,
          headerLeft: () => (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={{ paddingHorizontal: 12 }}>
              <Ionicons name="chevron-back" size={26} color={colors.brand} />
            </Pressable>
          ),
        }}
      />
    </Tabs>
  );
}
