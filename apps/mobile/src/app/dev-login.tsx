import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/**
 * Development only: apartmentbook://dev-login?email=…&password=… signs in and
 * jumps to the tabs, so simulator test runs can reach signed-in screens
 * without typing. Compiled out of production builds (__DEV__ is false there).
 */
export default function DevLoginScreen() {
  const { email, password, to } = useLocalSearchParams<{ email?: string; password?: string; to?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState("Signing in…");
  useEffect(() => {
    if (!__DEV__) {
      router.replace("/(tabs)");
      return;
    }
    if (!email || !password) return setStatus("Missing email or password");
    supabase.auth.signInWithPassword({ email, password }).then(({ error }) => {
      if (error) return setStatus(error.message);
      router.replace((to || "/(tabs)") as never);
    });
  }, [email, password, to, router]);
  return (
    <Screen>
      <Text>{status}</Text>
    </Screen>
  );
}
