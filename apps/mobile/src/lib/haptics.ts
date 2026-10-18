import { Alert, type AlertButton, type AlertOptions } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * The app's haptic vocabulary, after Apple's: a selection tick when a choice changes, light and soft impacts when
 * something is committed, a firm knock when a whole page changes, and the three notifications for success, warning and
 * error. Used where the state really changes, never for every tap. Best effort: the simulator, the web and some Android
 * phones have no haptics.
 */

/** A light tap: a reply opened, a menu raised, a small thing done. */
export function hapticTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** The softest impact: a primary button committing (Log in, Post, Send), a refresh starting. */
export function hapticSoft() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** A like: a little firmer, so it is felt under the heart. */
export function hapticLike() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Something was posted, sent or saved for good. */
export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Before something that cannot be undone: a delete, a leave, a block asking to be confirmed. */
export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** It did not work: a send or a save that failed. */
export function hapticError() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

/** The soft tick of a picker wheel: a tab, a chip, a segment, a switch, the bookmark filling or emptying. */
export function hapticSelect() {
  Haptics.selectionAsync().catch(() => {});
}

/**
 * A clear knock (a medium impact, noticeably firmer than the selection tick) when Home (For you | Buzz | Reels) or
 * Explore (Room | Roommate | Marketplace) moves to another section: once when the page under the finger changes
 * halfway through a swipe, or once for a tap on another label. Never for a move nobody made.
 */
export function hapticSwipe() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
