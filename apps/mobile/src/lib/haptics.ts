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

/**
 * A clear knock (a medium impact, noticeably firmer than the selection tick) when Home moves to another section
 * (For you | Buzz | Posts | Reels): once when the page under the finger changes halfway through a swipe, or once for a
 * tap on another label. Never for a move nobody made (opening Home on Reels after posting a reel).
 */
export function hapticSwipe() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
