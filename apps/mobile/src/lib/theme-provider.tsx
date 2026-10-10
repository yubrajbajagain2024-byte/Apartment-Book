import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";
import { palettes, type ColorScheme, type ThemeColors, type ThemePreference } from "./palette";

/** Where the choice from Settings → Theme is kept, so it survives a restart. */
const STORAGE_KEY = "campconnect.theme";
/** Never keep the app behind the splash screen longer than this, even if storage does not answer. */
const LOAD_TIMEOUT_MS = 1500;

// Keep the splash screen up until the saved theme is known, so a dark-mode user never sees a white flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

type ThemeValue = {
  /** What is on screen now. */
  scheme: ColorScheme;
  isDark: boolean;
  /** What the person chose in Settings → Theme. */
  preference: ThemePreference;
  colors: ThemeColors;
  /** Switches at once (no restart) and remembers the choice. */
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Light or dark for the whole app: the saved choice, or the phone's appearance for System Default. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  // With no override in place this is the phone's own setting, and it updates the moment the phone switches.
  const phone = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let settled = false;
    const settle = (value: ThemePreference) => {
      if (settled) return;
      settled = true;
      // Native pieces (alerts, action sheets, keyboards, pickers) follow an explicit choice as well.
      Appearance.setColorScheme(value === "system" ? "unspecified" : value);
      setPreferenceState(value);
    };
    const timer = setTimeout(() => settle("system"), LOAD_TIMEOUT_MS);
    AsyncStorage.getItem(STORAGE_KEY).then(
      (stored) => settle(isPreference(stored) ? stored : "system"),
      () => settle("system"),
    );
    return () => clearTimeout(timer);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    // The override goes first, so the very next render already sees the phone's real setting for System Default.
    Appearance.setColorScheme(next === "system" ? "unspecified" : next);
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorScheme = preference === "light" || preference === "dark" ? preference : phone === "dark" ? "dark" : "light";

  // The root view behind every screen (seen during transitions and behind the keyboard) matches too.
  useEffect(() => {
    if (preference) SystemUI.setBackgroundColorAsync(palettes[scheme].bg).catch(() => {});
  }, [scheme, preference]);
  useEffect(() => {
    if (preference) SplashScreen.hideAsync().catch(() => {});
  }, [preference]);

  const value = useMemo<ThemeValue>(
    () => ({ scheme, isDark: scheme === "dark", preference: preference ?? "system", colors: palettes[scheme], setPreference }),
    [scheme, preference, setPreference],
  );
  // Headers, tab bars and screen backgrounds drawn by the navigator.
  const navigationTheme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    const c = palettes[scheme];
    return { ...base, dark: scheme === "dark", colors: { ...base.colors, primary: c.brand, background: c.bg, card: c.card, text: c.text, border: c.border, notification: c.red } };
  }, [scheme]);

  // The splash screen is still showing while the saved choice loads.
  if (!preference) return null;
  return (
    <ThemeContext.Provider value={value}>
      <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useAppTheme must be used inside AppThemeProvider");
  return value;
}

/** The palette for the current theme. */
export function useColors(): ThemeColors {
  return useAppTheme().colors;
}

/**
 * Styles that follow the theme. Declare once per file, next to where StyleSheet.create used to be:
 *   const useStyles = makeStyles((colors) => ({ row: { backgroundColor: colors.card } }));
 * and call `const styles = useStyles();` in each component. Each theme's sheet is built once and reused.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors, scheme: ColorScheme) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const sheets: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const { scheme } = useAppTheme();
    const existing = sheets[scheme];
    if (existing) return existing;
    const created = StyleSheet.create(factory(palettes[scheme], scheme)) as T;
    sheets[scheme] = created;
    return created;
  };
}
