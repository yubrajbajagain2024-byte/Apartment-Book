import { Alert, type AlertButton, type AlertOptions } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * The little physical confirmations Instagram gives: a light tap when you like or vote, a firmer "success" when
 * something was posted. Haptics are best effort: the simulator, the web and some Android phones have none.
 */
export function hapticTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticLike() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** The soft tick of a picker wheel: the bookmark filling or emptying when you save a post, a reel or a listing. */
export function hapticSelect() {
  Haptics.selectionAsync().catch(() => {});
}

/** The softest impact: a primary button committing (Log in, Post, Send), a refresh starting. */
export function hapticSoft() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Before something that cannot be undone: a delete, a leave, a block asking to be confirmed. */
export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** It did not work: a send or a save that failed. */
export function hapticError() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

/**
 * Alert.alert with the haptic that belongs to it: a warning as a destructive choice is asked for ("Delete this post?"),
 * an error as a failure is reported ("Could not delete"). Same arguments as Alert.alert after the kind.
 */
export function alertWithHaptic(kind: "warning" | "error", title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
  if (kind === "warning") hapticWarning();
  else hapticError();
  Alert.alert(title, message, buttons, options);
}

/** A list's pull-to-refresh handler that answers with the softest impact as the spinner appears. */
export function refreshWithHaptic(run: () => unknown): () => void {
  return () => {
    hapticSoft();
    void run();
  };
}
