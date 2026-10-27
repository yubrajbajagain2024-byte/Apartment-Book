import type { SnapShot } from "./snap-capture";

/**
 * A Snap taken with the create flow's camera (app/compose, SNAP mode), on its way to the Snap screen (app/snap), which
 * then skips the system camera and shows it at once, with Send To. Taken once: the next visit opens the camera as usual.
 */
let pending: SnapShot | null = null;

export function handOffSnap(shot: SnapShot) {
  pending = shot;
}

export function takeHandedOffSnap(): SnapShot | null {
  const shot = pending;
  pending = null;
  return shot;
}
