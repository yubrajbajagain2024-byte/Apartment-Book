import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@/components/action-sheet";
import { PresenceProvider } from "@/lib/presence";
import { SessionProvider } from "@/lib/session";
import { colors } from "@/lib/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <PresenceProvider>
            <ActionSheetProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerTintColor: colors.brand, headerTitleStyle: { color: colors.text, fontWeight: "700" }, headerStyle: { backgroundColor: colors.card }, headerBackButtonDisplayMode: "minimal", contentStyle: { backgroundColor: colors.bg } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="(auth)/login" options={{ title: "Log in", presentation: "modal" }} />
                <Stack.Screen name="(auth)/signup" options={{ title: "Create account", presentation: "modal" }} />
                <Stack.Screen name="apartments/[id]" options={{ title: "Apartment" }} />
                <Stack.Screen name="roommates/[id]" options={{ title: "Roommate post" }} />
                <Stack.Screen name="marketplace/[id]" options={{ title: "Item" }} />
                <Stack.Screen name="posts/[id]" options={{ title: "Post" }} />
                <Stack.Screen name="buzz/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="messages/index" options={{ title: "Messages" }} />
                <Stack.Screen name="messages/[id]" options={{ title: "Chat" }} />
                <Stack.Screen name="messages/new" options={{ title: "New message" }} />
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
            </ActionSheetProvider>
          </PresenceProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
