import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { Avatar } from "@/components/avatar";
import { FloatingTabBar } from "@/components/floating-tab-bar";
import { HeaderActions } from "@/components/header-actions";
import { useHomeRestingOnBuzz } from "@/components/home/buzz-top-bar";
import { isBusinessRole } from "@apartment-book/shared";
import { BusinessAccountNotice } from "@/components/business-account-notice";
import { useSession } from "@/lib/session";
import { auroraGradient } from "@/lib/theme";
import { useAppTheme } from "@/lib/theme-provider";
import { useUnreadCount } from "@/lib/use-unread";
import { Icon, useBounceOn, type IconName } from "@/components/icon";

/**
 * Each tab's icon, outlined at rest and filled while it is the tab on screen: on iOS the system's own tab glyphs (the
 * SF Symbols Apple's apps use for the same places), elsewhere the Ionicons.
 */
const ICONS: Record<string, { on: IconName; off: IconName; sfOn: SFSymbol; sfOff: SFSymbol }> = {
  index: { on: "home", off: "home-outline", sfOn: "house.fill", sfOff: "house" },
  housing: { on: "compass", off: "compass-outline", sfOn: "safari.fill", sfOff: "safari" },
  // The calendar has no filled form: on screen it is drawn heavier, as the system's Calendar is in its own bars.
  events: { on: "calendar", off: "calendar-outline", sfOn: "calendar", sfOff: "calendar" },
  messages: { on: "chatbubble", off: "chatbubble-outline", sfOn: "message.fill", sfOff: "message" },
  profile: { on: "person-circle", off: "person-circle-outline", sfOn: "person.crop.circle.fill", sfOff: "person.crop.circle" },
};

/** A tab's icon as a component of its own (the bar calls tabBarIcon during its render: hooks must not run there). It bounces when the tab is picked. */
function TabIcon({ route, focused, color, size }: { route: string; focused: boolean; color: ColorValue; size: number }) {
  const names = ICONS[route] ?? ICONS.index!;
  const bounce = useBounceOn(focused);
  return <Icon name={focused ? names.on : names.off} sf={focused ? names.sfOn : names.sfOff} size={size} color={color} weight={focused ? "semibold" : "regular"} bounce={bounce} />;
}

function icon(route: string) {
  return function renderTabIcon(p: { focused: boolean; color: ColorValue; size: number }) {
    return <TabIcon route={route} {...p} />;
  };
}

/**
 * The Profile tab's icon: your own photo in a circle, like Instagram's, with a thin aurora ring while the tab is on
 * screen; the person icon when you are signed out, and while Home rests on its anonymous Buzz page (nothing on screen
 * there may show who is looking).
 */
function ProfileTabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
  const { profile } = useSession();
  const { colors } = useAppTheme();
  const bounce = useBounceOn(focused);
  const restingOnBuzz = useHomeRestingOnBuzz();
  if (!profile || restingOnBuzz) return <Icon name={focused ? ICONS.profile!.on : ICONS.profile!.off} sf={focused ? ICONS.profile!.sfOn : ICONS.profile!.sfOff} size={size} color={color} weight={focused ? "semibold" : "regular"} bounce={bounce} />;
  // The ring takes 2pt on each side, so the photo inside stays the size of the other icons' ink; on screen it is the aurora.
  const photo = size - 4;
  return (
    <View style={[styles.photoRing, { width: size, height: size, borderRadius: size / 2 }, focused && { backgroundColor: color, experimental_backgroundImage: auroraGradient(colors.auroraGlow, 135) }]}>
      <Avatar name={profile.full_name} url={profile.avatar_url} size={photo} online={false} transition={0} />
    </View>
  );
}

/**
 * Home | Explore (Housing | Roommate | Marketplace) | Messages | Events | Profile: the campus's tools second, its calendar
 * fourth. Search is not a tab: the magnifier beside the bell in Home's top bar opens app/search.tsx (people, topics,
 * posts and what is popular on every campus). Creating starts from Home: Orbit's floating "+", Upload in the
 * menu under your photo, and the "+" over Reels open the live camera (SNAP | POST | REEL | BUZZ, see app/compose). The
 * bar is FloatingTabBar: a rounded glass pill floating over the tabs' content (see lib/tab-bar.ts for its size and the
 * room each tab keeps clear under it) with a capsule that slides to the tab on screen.
 */
export default function TabsLayout() {
  const { user, profile } = useSession();
  const unread = useUnreadCount(user?.id ?? null);
  const { colors, isDark } = useAppTheme();
  // A business account stays out of the student side: it is pointed to the business portal instead (after every hook).
  if (profile && isBusinessRole(profile.role)) return <BusinessAccountNotice />;
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
      {/* Explore (housing.tsx, the route name old links use) draws its own top bar ("Find", then Housing | Roommate | Marketplace, the search box for the page on screen and the pills). */}
      <Tabs.Screen name="housing" options={{ title: "Explore", headerShown: false, tabBarIcon: icon("housing") }} />
      {/* Messages draws its own top bar: the new-message pencil, the "Messages" title, Chats | Requests and the search. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false, tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: icon("messages") }} />
      {/* Events draws its own top bar ("Events", then For you | All events, the search box and the date and category pills). */}
      <Tabs.Screen name="events" options={{ title: "Events", headerShown: false, tabBarIcon: icon("events") }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, tabBarIcon: (p) => <ProfileTabIcon {...p} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  photoRing: { padding: 2, alignItems: "center", justifyContent: "center" },
});
