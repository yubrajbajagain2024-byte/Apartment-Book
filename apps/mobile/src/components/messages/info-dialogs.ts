import { Alert, Platform } from "react-native";

/**
 * Asks before Block, Unblock or Leave group. The phone shows its own alert; the web build uses the browser's confirm box,
 * because react-native-web's Alert shows nothing (an unanswered question would leave the button doing nothing).
 */
export function confirmAction({ title, message, confirm, destructive = true }: { title: string; message: string; confirm: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === "web") {
    const ask = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(typeof ask === "function" ? ask.call(globalThis, `${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirm, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      // Android: tapping outside the alert counts as Cancel.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** A short message with an OK button: the phone's alert, or the browser's on the web build. */
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    const say = (globalThis as { alert?: (text: string) => void }).alert;
    if (typeof say === "function") say.call(globalThis, message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
