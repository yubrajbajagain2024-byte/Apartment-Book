import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import type { Database } from "@apartment-book/shared";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (see apps/mobile/.env)");

/** The project's API address and public key, for the few requests supabase-js does not make (a Snap's upload with progress). */
export const SUPABASE_URL = url.replace(/\/$/, "");
export const SUPABASE_ANON_KEY = anonKey;

/** The website the app talks to for video uploads, legal pages and email links. */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "https://apartment-book-vyass.vercel.app").replace(/\/$/, "");

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Development only: EXPO_PUBLIC_BUZZ_FIXTURES=<variant> in apps/mobile/.env.local answers Buzz from sample data (see
// lib/buzz-fixtures). `__DEV__` is false in release builds, so this require and the sample data are left out of them.
if (__DEV__ && process.env.EXPO_PUBLIC_BUZZ_FIXTURES) {
  (require("./buzz-fixtures") as typeof import("./buzz-fixtures")).installBuzzFixtures(supabase, process.env.EXPO_PUBLIC_BUZZ_FIXTURES);
}

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
