import "server-only";

import type { SecondPassSink } from "@apartment-book/moderation";
import type { RpcClient } from "./types";

/**
 * Where the optional AI second pass (inert unless MODERATION_AI_API_KEY is set) stores an escalation: the `ai_flag`
 * queue entry through `ts_apply_moderation` (no event rows), and — only for a confident, severe verdict on an `active`
 * item — `buzz_v2_set_status(…, 'hidden')` pending review. It can never approve, restore or remove anything.
 * Both functions are internal to the database; the service role must be allowed to execute them.
 */
export function secondPassSink(db: RpcClient): SecondPassSink {
  return async (target, escalation) => {
    const applied = await db.rpc("ts_apply_moderation", {
      p_entity_type: target.entityType,
      p_entity_id: target.entityId,
      p_surface: target.surface,
      p_author: target.authorId,
      p_university: target.universityId,
      p_moderation: { events: [], queue: escalation.queue },
    });
    if (applied.error) throw new Error("ts_apply_moderation failed");
    if (escalation.hide) {
      const hidden = await db.rpc("buzz_v2_set_status", { p_entity_type: target.entityType, p_id: target.entityId, p_status: "hidden" });
      if (hidden.error) throw new Error("buzz_v2_set_status failed");
    }
  };
}
