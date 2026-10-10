import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import type { ThemePreference } from "@/lib/palette";
import { supabase } from "@/lib/supabase";
import { useAppTheme } from "@/lib/theme-provider";

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Development only: apartmentbook://dev-login?email=…&password=… signs in and
 * jumps to the tabs, so simulator test runs can reach signed-in screens
 * without typing. `&theme=light|dark|system` sets Settings → Theme first; a
 * theme with no email or password only switches the theme and jumps (for
 * whoever is signed in already). Compiled out of production builds (__DEV__
 * is false there).
 */
export default function DevLoginScreen() {
  const { email, password, to, theme } = useLocalSearchParams<{ email?: string; password?: string; to?: string; theme?: string }>();
  const router = useRouter();
  const { colors, setPreference } = useAppTheme();
  const [status, setStatus] = useState("Signing in…");
  useEffect(() => {
    if (!__DEV__) {
      router.replace("/(tabs)");
      return;
    }
    const preference = isThemePreference(theme) ? theme : undefined;
    if (theme && !preference) return setStatus(`Unknown theme "${theme}": use light, dark or system`);
    // Before navigating, so the screen this opens is drawn in the new theme from its first frame.
    if (preference) setPreference(preference);
    if (!email || !password) {
      if (preference) return router.replace((to || "/(tabs)") as never);
      return setStatus("Missing email or password");
    }
    supabase.auth.signInWithPassword({ email, password }).then(({ error }) => {
      if (error) return setStatus(error.message);
      router.replace((to || "/(tabs)") as never);
    });
  }, [email, password, to, theme, router, setPreference]);
  return (
    <Screen>
      <Text style={{ color: colors.text }}>{status}</Text>
    </Screen>
  );
}
