import { test } from "node:test";
import assert from "node:assert/strict";

test("new messages and Snaps belong to Messages, everything else to Notifications", async () => {
  const { MESSAGE_NOTIFICATION_TYPES, isMessageNotification } = await import("../src/queries/notifications.ts");
  assert.deepEqual([...MESSAGE_NOTIFICATION_TYPES], ["message", "snap"]);
  for (const type of ["message", "snap"]) assert.equal(isMessageNotification(type), true, type);
  for (const type of ["like", "comment", "follow", "listing_saved", "nearby_listing", "system", "snap_activity", "call"]) assert.equal(isMessageNotification(type), false, type);
});
