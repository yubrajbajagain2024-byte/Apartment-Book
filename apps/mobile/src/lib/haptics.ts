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

/** The soft tick of a picker wheel: Home plays it when the section under the finger changes (For you | Buzz | Posts | Reels). */
export function hapticSelect() {
  Haptics.selectionAsync().catch(() => {});
}
