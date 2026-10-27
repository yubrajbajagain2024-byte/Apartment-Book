import { Stack } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@/components/action-sheet";
import { CallProvider } from "@/components/calls/call-provider";
import { ShareSheetProvider } from "@/components/share-sheet";
import { phosphor } from "@/lib/palette";
import { PresenceProvider } from "@/lib/presence";
import { SessionProvider } from "@/lib/session";
import { AppThemeProvider, useAppTheme } from "@/lib/theme-provider";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Around all of the app's own providers, so the session, presence and sheet providers and every screen can read the theme. */}
        <AppThemeProvider>
          <SessionProvider>
            <PresenceProvider>
              <ActionSheetProvider>
                <ShareSheetProvider>
                  {/* Calls ring over whatever is on screen, so their provider sits around the whole stack. */}
                  <CallProvider>
                    <ThemedStack />
                  </CallProvider>
                </ShareSheetProvider>
              </ActionSheetProvider>
            </PresenceProvider>
          </SessionProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** The status bar and every pushed screen's header and background in the current theme; rendered under AppThemeProvider so it can read it. */
function ThemedStack() {
  const { colors, isDark } = useAppTheme();
  const content = { backgroundColor: colors.bg };
  // Android's header edge is an elevation shadow, which cannot show between a black bar and a black screen, so in dark mode
  // the content of a screen with a header starts with a hairline instead (iOS draws its own separator line).
  const contentUnderHeader = Platform.OS === "android" && isDark ? { ...content, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : content;
  // Buzz's screens draw their own Phosphor header; behind them (a push, a swipe back) the screen is Phosphor too, in both themes.
  const buzzContent = { backgroundColor: phosphor.canvas };
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerTintColor: colors.brand, headerTitleStyle: { color: colors.text, fontWeight: "700" }, headerStyle: { backgroundColor: colors.bar }, headerBackButtonDisplayMode: "minimal", contentStyle: contentUnderHeader }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: content }} />
        <Stack.Screen name="(auth)/login" options={{ title: "Log in", presentation: "modal" }} />
        <Stack.Screen name="(auth)/signup" options={{ title: "Create account", presentation: "modal" }} />
        <Stack.Screen name="apartments/[id]" options={{ title: "Apartment" }} />
        <Stack.Screen name="roommates/[id]" options={{ title: "Roommate post" }} />
        <Stack.Screen name="marketplace/[id]" options={{ title: "Item" }} />
        <Stack.Screen name="posts/[id]" options={{ title: "Post" }} />
        {/* The full-screen viewer zooms open out of the picture that was tapped and back into it on the way out (see
            app/reels/[id].tsx), so it is a see-through screen with no slide of its own: the screen behind stays in view
            while the page grows over it and the backdrop darkens. It draws its own Back and closes on a swipe from the
            left edge. */}
        <Stack.Screen name="reels/[id]" options={{ headerShown: false, presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
        {/* Snaps, the same way: the phone's camera opens over whatever is on screen and the Snap then fills it, with Send
            To (snap/index); a Snap in a chat opens once, full screen (snap/[id]). Both fade in and out on their own. */}
        <Stack.Screen name="snap/index" options={{ headerShown: false, presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
        <Stack.Screen name="snap/[id]" options={{ headerShown: false, presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
        <Stack.Screen name="buzz/[id]" options={{ headerShown: false, contentStyle: buzzContent }} />
        <Stack.Screen name="buzz/search" options={{ headerShown: false, contentStyle: buzzContent }} />
        <Stack.Screen name="buzz/mine" options={{ headerShown: false, contentStyle: buzzContent }} />
        {/* A chat draws its own floating bar (Back, the person's photo and name, Search and Info on glass), so the messages scroll under it. */}
        <Stack.Screen name="messages/[id]" options={{ headerShown: false, contentStyle: content }} />
        {/* A call fills the screen on its own dark stage, as FaceTime's does, and is left only by hanging up. */}
        <Stack.Screen name="call/[id]" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade", gestureEnabled: false, contentStyle: { backgroundColor: "#0b0b14" } }} />
        <Stack.Screen name="messages/new" options={{ title: "New message" }} />
        <Stack.Screen name="messages/info/[id]" options={{ title: "Chat info" }} />
        <Stack.Screen name="messages/search/[id]" options={{ title: "Search" }} />
        <Stack.Screen name="find-people" options={{ title: "Search" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        {/* A profile draws its own floating bar (Back over the cover, the menu or More), so the cover can run under the status bar. */}
        <Stack.Screen name="profile/[id]" options={{ headerShown: false, contentStyle: content }} />
        <Stack.Screen name="follows/[id]" options={{ title: "Followers" }} />
        <Stack.Screen name="saved" options={{ title: "Saved" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="settings/account-status" options={{ title: "Account status" }} />
        <Stack.Screen name="settings/buzz-anonymity" options={{ title: "How Buzz anonymity works" }} />
        <Stack.Screen name="create/apartment" options={{ title: "List an apartment" }} />
        <Stack.Screen name="create/roommate" options={{ title: "Roommate post" }} />
        <Stack.Screen name="create/item" options={{ title: "Sell an item" }} />
        {/* Posts and reels are made in the create flow (app/compose): TikTok's camera, editor and publish screen, rising
            over the app as one full-screen modal with its own stack inside. The old addresses hand over to it. */}
        <Stack.Screen name="compose" options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false, contentStyle: { backgroundColor: "#000" } }} />
        <Stack.Screen name="create/post" options={{ headerShown: false, animation: "none" }} />
        <Stack.Screen name="create/reel" options={{ headerShown: false, animation: "none" }} />
        {/* Kept for links: it hands over at once to the composer sheet on Home's Buzz page (see app/create/buzz.tsx). */}
        <Stack.Screen name="create/buzz" options={{ headerShown: false, animation: "none", contentStyle: buzzContent }} />
      </Stack>
    </>
  );
}
