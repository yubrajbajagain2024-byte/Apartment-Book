/**
 * @apartment-book/moderation — UniBuzz's text-moderation engine, ported from UniVerse (`server/src/lib/moderation/**`
 * + the admin slice's rule packs; safety.md §2 and SPEC §4.2.6 are binding).
 *
 * SERVER-ONLY. The rule data (term lists, guards, combos, name lists) must never reach a browser or the app: never import
 * this package from client components, from `packages/shared`, or from `apps/mobile`. The `server-only` import below
 * turns a client import into a build error on the website.
 *
 * Layout: `normalize.ts` (views) · `pii.ts` (PII detectors) · `rules/baseline.ts` + `rules/admin/*` (rule packs) ·
 * `registry.ts` (pack registry) · `policy.ts` (outcome matrix) · `copy.ts` (author copy + support resources) ·
 * `engine.ts` (pure evaluation) · `moderate.ts` (per write: fields → merged result, author notice, 422 details) ·
 * `record.ts` (`p_moderation` for the database) · `queue.ts` (queue entry + merge rules) · `secondPass.ts` (optional AI
 * escalator, inert without MODERATION_AI_API_KEY) · `logger.ts` (injected error log).
 *
 * Typical write (see apps/web/src/lib/buzz-server):
 *   const mod = moderateWrite([{ text: title, field: 'title' }, { text: body }], ctx);   // ctx from ts_writer_context
 *   if (mod.merged.action === 'block') { record via ts_record_blocked(toModerationRecord(mod)); 422 contentBlocked(...) }
 *   else { create(status = mod.merged.persistStatus, support = !!mod.merged.support, p_moderation = toModerationRecord(mod)) ;
 *          201 { ...item, moderation: toAuthorNotice(mod.merged) } }
 */
import 'server-only';

export type {
  AuthorNotice, ContentBlockedDetails, ModerationAction, ModerationCategory, ModerationContext, ModerationField, ModerationMatch,
  ModerationPriority, ModerationResult, ModerationRule, ModerationSeverity, ModerationSignals, ModerationSurface, ModerationSurfaceGroup,
  ModerationUserMessage, PersistStatus, RecipientBanner, RuleKind, RulePack, SecondPassClassifier, SecondPassInput, SecondPassVerdict,
  SupportResources, TextView,
} from './types';
export { CATEGORY_LABELS, GUIDELINE_ANCHORS, SURFACE_GROUP } from './types';

export { ENGINE_VERSION } from './engine';
export {
  contentBlocked, mergeResults, moderate, moderateText, moderateWrite, NO_NOTICE, textHash, toAuthorNotice,
  type FieldModeration, type WriteField, type WriteModeration,
} from './moderate';
export { queueEntryFor, toModerationRecord, type ModerationEventRecord, type ModerationRecord } from './record';
export { mergeQueueEntries, type QueueAiVerdict, type QueueEntry, type QueueSource } from './queue';
export { listRulePacks, packsFor, registerRulePack, RULE_PACK_IDS, setRulePackEnabled, type RulePackInfo } from './registry';
export { ADMIN_RULE_PACK_IDS } from './rules/admin/index';
export { BANNER_COPY, supportResources, toCountryCode, userMessage, type MessageId } from './copy';
export { DAY_MS, PRIORITY_RANK, SEVERITY_RANK } from './policy';
export { normalize } from './normalize';
export { setModerationLogger, type ModerationLogger } from './logger';
export {
  configureSecondPass, DEFAULT_SECOND_PASS_MODEL, enqueueSecondPass, flushSecondPass, getSecondPassClassifier, resetSecondPass,
  secondPassEligible, secondPassMetrics, setSecondPassClassifier,
  type SecondPassEnv, type SecondPassEscalation, type SecondPassJob, type SecondPassSink, type SecondPassTarget,
} from './secondPass';

import { supportResources } from './copy';
import type { SupportResources } from './types';

/** S-HEAD / S-BODY + crisis lines for the country (safety §2.10). */
export function supportResourcesFor(countryCode: string | null | undefined): SupportResources {
  return supportResources(countryCode, 'ideation');
}
