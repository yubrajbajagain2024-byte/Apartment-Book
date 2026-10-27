import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";
import { MaskedView } from "@/components/masked-view";
import type { SFSymbol } from "expo-symbols";
import { Avatar } from "@/components/avatar";
import { FloatingTabBar, type TabBarAction } from "@/components/floating-tab-bar";
import { HeaderActions } from "@/components/header-actions";
import { useHomeRestingOnBuzz } from "@/components/home/buzz-top-bar";
import { useCreateMenu } from "@/components/home/create-menu";
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
 * The ring round the "+": as tall as a tab's icon and label together, and thin. Its top lines up with the tabs' symbols
 * and its foot with their labels: their ink sits RING_NUDGE below the bar's middle, where the slot centres the ring.
 */
const RING_SIZE = 36;
const RING_STROKE = 1.5;
const RING_NUDGE = 1.5;

/**
 * The "+" in the middle of the bar: the plain plus inside a thin Aurora ring (cyan, blue, violet, corner to corner, the
 * glow the app keeps for rings, like your photo's on Home) and nothing filled, so the bar's glass shows through. The ring
 * is the gradient seen through a ring-shaped mask. A component of its own: the bar calls the icon during its render.
 */
function CreateIcon() {
  const { colors } = useAppTheme();
  return (
    <View style={styles.createRing}>
      <MaskedView style={StyleSheet.absoluteFill} maskElement={<View style={styles.ringMask} />}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand, experimental_backgroundImage: auroraGradient(colors.auroraGlow, 135) }]} />
      </MaskedView>
      <Icon name="add" sf="plus" size={18} color={colors.text} weight="regular" />
    </View>
  );
}

function createIcon() {
  return <CreateIcon />;
}

/**
 * Home | Explore (Housing | Roommate | Marketplace) | + | Messages | Profile. Search is the magnifying glass in Home's
 * top-right corner, before the Notifications bell (see HeaderActions). The "+" in the middle (CreateIcon: a thin Aurora
 * ring round the plain plus, no label; screen readers hear "Create") opens the live camera
 * (POST | REEL | SNAP, see app/compose), as the "+" on your photo on Home does; signed out, the login screen. No haptic, like the
 * tabs. The bar is FloatingTabBar: a rounded glass pill floating over the tabs' content (see lib/tab-bar.ts for its size
 * and the room each tab keeps clear under it) with a capsule that slides to the tab on screen.
 */
export default function TabsLayout() {
  const { user, profile } = useSession();
  const unread = useUnreadCount(user?.id ?? null);
  const { colors, isDark } = useAppTheme();
  const create = useCreateMenu();
  // A business account stays out of the student side: it is pointed to the business portal instead (after every hook).
  if (profile && isBusinessRole(profile.role)) return <BusinessAccountNotice />;
  const action: TabBarAction = { label: "Create", hint: "Opens the camera for a post, a reel or a Snap", icon: createIcon, onPress: create };
  // The header's own shadow barely shows on black, so in dark a hairline marks its edge. Light keeps its shadow.
  const headerStyle = isDark ? { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : { backgroundColor: colors.bar };
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} action={action} />}
      screenOptions={{
        headerStyle,
        headerTitleStyle: { fontWeight: "700", color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
        headerRight: () => <HeaderActions inHeader />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("index") }} />
      {/* Explore (housing.tsx) draws its own top bar ("Find", then Housing | Roommate | Marketplace, the search box for the page on screen and the pills). */}
      <Tabs.Screen name="housing" options={{ title: "Explore", headerShown: false, tabBarIcon: icon("housing") }} />
      {/* Messages draws its own top bar: the new-message pencil, the "Messages" title, Chats | Requests and the search. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", headerShown: false, tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined, tabBarIcon: icon("messages") }} />
      {/* Profile draws its own top bar (Find friends, your name, the menu), like TikTok. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", headerShown: false, tabBarIcon: (p) => <ProfileTabIcon {...p} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  photoRing: { padding: 2, alignItems: "center", justifyContent: "center" },
  createRing: { width: RING_SIZE, height: RING_SIZE, alignItems: "center", justifyContent: "center", transform: [{ translateY: RING_NUDGE }] },
  // Only the mask's outline is solid, so only the ring shows the gradient.
  ringMask: { flex: 1, borderRadius: RING_SIZE / 2, borderWidth: RING_STROKE, borderColor: "#000" },
});
