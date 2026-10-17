import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/avatar";
import { FloatingTabBar } from "@/components/floating-tab-bar";
import { HeaderActions } from "@/components/header-actions";
import { useSession } from "@/lib/session";
import { useAppTheme } from "@/lib/theme-provider";
import { useUnreadCount } from "@/lib/use-unread";

/** Each tab's icon, outlined at rest and filled while it is the tab on screen. */
const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  index: { on: "home", off: "home-outline" },
  search: { on: "search", off: "search-outline" },
  housing: { on: "compass", off: "compass-outline" },
  messages: { on: "chatbubble", off: "chatbubble-outline" },
  profile: { on: "person-circle", off: "person-circle-outline" },
};

function icon(route: string) {
  const names = ICONS[route] ?? ICONS.index!;
  return function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? names.on : names.off} size={size} color={color} />;
  };
}

/**
 * The Profile tab's icon: your own photo in a circle, like Instagram's, with a thin ring in the tab's colour while the
 * tab is on screen; the person icon when you are signed out.
 */
function ProfileTabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
  const { profile } = useSession();
  if (!profile) return <Ionicons name={focused ? ICONS.profile!.on : ICONS.profile!.off} size={size} color={color} />;
  // The ring takes 2pt on each side, so the photo inside stays the size of the other icons' ink.
  const photo = size - 4;
  return (
    <View style={[styles.photoRing, { width: size, height: size, borderRadius: size / 2, borderColor: focused ? color : "transparent" }]}>
      <Avatar name={profile.full_name} url={profile.avatar_url} size={photo} online={false} transition={0} />
    </View>
  );
}

/**
 * Home | Search | Explore (Room | Roommate | Marketplace) | Messages | Profile; the Notifications bell sits in the top-right
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
      {/* Search draws its own top bar (the "Search" title) over the people search. */}
      <Tabs.Screen name="search" options={{ title: "Search", headerShown: false, tabBarIcon: icon("search") }} />
      {/* Explore (housing.tsx) draws its own top bar ("Find" with the magnifier that searches the page on screen, then Room | Roommate | Marketplace and the pills). */}
      <Tabs.Screen name="housing" options={{ title: "Explore", headerShown: false, tabBarIcon: icon("housing") }} />
      {/* Messages draws its own top bar: the new-message pencil, the "Messages" title, Chats | Requests and the search. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false, tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: icon("messages") }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, tabBarIcon: (p) => <ProfileTabIcon {...p} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  photoRing: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
