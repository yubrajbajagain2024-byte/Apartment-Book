import { Stack } from "expo-router";
import { useAppTheme } from "@/lib/theme-provider";

/**
 * The create flow, TikTok's: it rises over the app as one full-screen modal (see the root layout) and keeps its own
 * stack inside, camera → editor (a quick crossfade) → publish screen (pushed from the right, swiped back); a listing's
 * goes on from the editor to its details, its form and its preview. The camera and the editor are always dark, being all
 * picture; the screens after them follow the app's theme.
 */
export default function ComposeLayout() {
  const { colors } = useAppTheme();
  // The screens after the editor follow the app's theme, under a plain native bar.
  const themed = {
    headerShown: true,
    headerTintColor: colors.text,
    headerTitleStyle: { color: colors.text, fontWeight: "700" as const },
    headerStyle: { backgroundColor: colors.bg },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: colors.bg },
  };
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }}>
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      {/* No swipe back out of the editor: leaving it asks first (discard or save a draft), as TikTok's does. */}
      {/* The shot fades into the editor in place, quickly, as on TikTok, rather than sliding in from the side. */}
      <Stack.Screen name="edit" options={{ gestureEnabled: false, animation: "fade", animationDuration: 220 }} />
      <Stack.Screen name="publish" options={themed} />
      {/* A roommate post's or an item's own steps after the editor (or Skip): details, the listing's form, the preview. */}
      <Stack.Screen name="listing" options={themed} />
      <Stack.Screen name="listing-form" options={themed} />
      <Stack.Screen name="listing-preview" options={themed} />
    </Stack>
  );
}
