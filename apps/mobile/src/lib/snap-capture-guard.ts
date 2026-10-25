import { useEffect } from "react";
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { SnapDetection } from "@apartment-book/shared";

/**
 * What this phone can do about captures while a Snap is open, through expo-screen-capture (in Expo Go and every build
 * made since it was added; an older installed build has none of it and says so, see SNAP_DETECTION). Loaded only when
 * the module is there, so a build without it never touches it.
 */
type ScreenCapture = typeof import("expo-screen-capture");

const CAPTURE: ScreenCapture | null = (() => {
  try {
    if (Platform.OS === "web" || !requireOptionalNativeModule("ExpoScreenCapture")) return null;
    return require("expo-screen-capture") as ScreenCapture;
  } catch {
    return null;
  }
})();

/**
 * What the sender can be told about this device, logged with the one view (never more than the device can do):
 * an iPhone reports screenshots (the system tells apps about them) and blacks out the screen while it is recorded or
 * mirrored; an Android phone blocks screenshots and recordings outright (FLAG_SECURE) while the Snap is open; a build
 * without the module can do neither.
 */
export const SNAP_DETECTION: SnapDetection = CAPTURE ? (Platform.OS === "ios" ? "ios" : "android") : "none";

/** The key the Snap viewer holds the protection under, so nothing else in the app lifts it by mistake. */
const KEY = "snap-view";

/**
 * While `active`, keeps the screen protected and reports screenshots: on iOS the content is covered the moment the
 * screen is recorded or mirrored and `onScreenshot` fires for every screenshot; on Android screenshots and recordings
 * are blocked by the system, and any screenshot the system still reports (Android 14 and up) is passed on too. Lifted,
 * always, when `active` ends or the screen goes.
 */
export function useSnapCaptureGuard(active: boolean, onScreenshot: () => void) {
  useEffect(() => {
    if (!active || !CAPTURE) return;
    const capture = CAPTURE;
    let lifted = false;
    capture.preventScreenCaptureAsync(KEY).catch(() => {});
    const sub = capture.addScreenshotListener(() => {
      if (!lifted) onScreenshot();
    });
    return () => {
      lifted = true;
      sub.remove();
      capture.allowScreenCaptureAsync(KEY).catch(() => {});
    };
  }, [active, onScreenshot]);
}
