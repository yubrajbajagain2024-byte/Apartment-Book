import { Tabs } from "expo-router";
import { StyleSheet, type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FloatingTabBar } from "@/components/floating-tab-bar";
import { HeaderActions } from "@/components/header-actions";
import { useSession } from "@/lib/session";
import { useAppTheme } from "@/lib/theme-provider";
import { useUnreadCount } from "@/lib/use-unread";

/** Each tab's icon, outlined at rest and filled while it is the tab on screen. */
const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: "home", off: "home-outline" },
  housing: { on: "business", off: "business-outline" },
  messages: { on: "chatbubble", off: "chatbubble-outline" },
  marketplace: { on: "bag-handle", off: "bag-handle-outline" },
  profile: { on: "person-circle", off: "person-circle-outline" },
};

function icon(route: string) {
  const names = ICONS[route] ?? ICONS.index!;
  return function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? names.on : names.off} size={size} color={color} />;
  };
}

/**
 * Home | Housing (Apartments | Roommates) | Messages | Marketplace | Profile; the Search magnifier sits in the top-right
 * corner of every tab, like TikTok. The bar is FloatingTabBar: a rounded glass pill floating over the tabs' content (see
 * lib/tab-bar.ts for its size and the room each tab keeps clear under it) with a capsule that slides to the tab on
 * screen. The tabs, their icons and where they go are as before.
 */
export default function TabsLayout() {
  const { user } = useSession();
  const unread = useUnreadCount(user?.id ?? null);
  const { colors, isDark } = useAppTheme();
  // The header's own shadow barely shows on black, so in dark a hairline marks its edge. Light keeps its shadow.
  const headerStyle = isDark ? { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : { backgroundColor: colors.bar };
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle,
        headerTitleStyle: { fontWeight: "700", color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        headerRight: () => <HeaderActions inHeader />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("index") }} />
      <Tabs.Screen name="housing" options={{ title: "Housing", tabBarIcon: icon("housing") }} />
      {/* Messages draws its own top bar: the new-message pencil, the "Messages" title, Chats | Requests and the search. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false, tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: icon("messages") }} />
      {/* Marketplace draws its own top bar ("+" to sell, "<campus> marketplace" with the campus menu, and a magnifier that searches items). */}
      <Tabs.Screen name="marketplace" options={{ title: "Marketplace", headerShown: false, tabBarIcon: icon("marketplace") }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, tabBarIcon: icon("profile") }} />
    </Tabs>
  );
}
