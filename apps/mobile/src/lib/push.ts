import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "@apartment-book/shared";
import { supabase } from "./supabase";

/** What a push from the database carries (migration 36): the notification's kind and link, or a call ringing this phone. */
type PushData = { type?: string; link?: string; call_id?: string; conversation_id?: string };

const dataOf = (n: Notifications.Notification): PushData => (n.request.content.data ?? {}) as PushData;

Notifications.setNotificationHandler({
  // A call ringing while the app is open rings through the app itself (CallProvider): no banner or sound over it.
  handleNotification: async (n) => {
    const ring = dataOf(n).type === "call_ring";
    return { shouldShowBanner: !ring, shouldShowList: !ring, shouldPlaySound: !ring, shouldSetBadge: !ring };
  },
});

/**
 * What happens when a push is tapped: a ring opens the call (if it is still ringing), anything else opens its link.
 * Also answers the tap that opened the app from cold. Returns the function that stops watching.
 */
export function watchNotificationTaps(handlers: { onRing: (callId: string, conversationId: string | null) => void; onOpen: (link: string) => void }): () => void {
  if (Platform.OS === "web") return () => {};
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const data = dataOf(response.notification);
    if (data.type === "call_ring" && typeof data.call_id === "string") handlers.onRing(data.call_id, typeof data.conversation_id === "string" ? data.conversation_id : null);
    else if (typeof data.link === "string" && data.link.startsWith("/")) handlers.onOpen(data.link);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => {});
  return () => sub.remove();
}

/** Ask for permission and store this device's Expo push token. Silently does nothing on web, simulators or when declined. */
export async function registerForPush(userId: string): Promise<void> {
  if (Platform.OS === "web" || !Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Messages and updates", importance: Notifications.AndroidImportance.DEFAULT });
    // Calls: heads-up, with the ring (bundled by the expo-notifications plugin, app.json) and the phone buzzing.
    await Notifications.setNotificationChannelAsync("calls", {
      name: "Calls",
      importance: Notifications.AndroidImportance.MAX,
      sound: "ring.wav",
      vibrationPattern: [0, 700, 500, 700],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await registerPushToken(supabase, { userId, token, platform: Platform.OS === "ios" ? "ios" : "android" });
}
