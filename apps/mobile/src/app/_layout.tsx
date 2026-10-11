import { Stack } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@/components/action-sheet";
import { ShareSheetProvider } from "@/components/share-sheet";
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
                  <ThemedStack />
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
        <Stack.Screen name="buzz/[id]" options={{ headerShown: false, contentStyle: content }} />
        <Stack.Screen name="messages/[id]" options={{ title: "Chat" }} />
        <Stack.Screen name="messages/new" options={{ title: "New message" }} />
        <Stack.Screen name="messages/info/[id]" options={{ title: "Chat info" }} />
        <Stack.Screen name="messages/search/[id]" options={{ title: "Search" }} />
        <Stack.Screen name="search" options={{ title: "Search" }} />
        <Stack.Screen name="profile/[id]" options={{ title: "Profile" }} />
        <Stack.Screen name="follows/[id]" options={{ title: "Followers" }} />
        <Stack.Screen name="saved" options={{ title: "Saved" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="create/apartment" options={{ title: "List an apartment" }} />
        <Stack.Screen name="create/roommate" options={{ title: "Roommate post" }} />
        <Stack.Screen name="create/item" options={{ title: "Sell an item" }} />
        <Stack.Screen name="create/post" options={{ title: "New post" }} />
        <Stack.Screen name="create/reel" options={{ title: "New reel" }} />
        <Stack.Screen name="create/buzz" options={{ title: "New Buzz post" }} />
      </Stack>
    </>
  );
}
