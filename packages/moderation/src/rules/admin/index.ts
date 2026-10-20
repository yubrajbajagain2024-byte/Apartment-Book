/**
 * The admin rule packs (UniVerse SPEC §5.11): `admin.<category>` upgrades over the `baseline` pack, ported from UniVerse
 * `server/src/services/admin/rules/*.ts`. Pure data; `registry.ts` registers them next to `baseline` at import time.
 * Staff switch packs on and off (`staff_set_rule_pack`); the engine reads the result from `ctx.enabledRulePacks`.
 * SERVER-ONLY DATA — never import from packages/shared, the website's client components or the app.
 */
import type { RulePack } from '../../types';
import { ACADEMIC_PACK } from './academic';
import { COMMERCE_PACK } from './commerce';
import { DRUGS_PACK } from './drugs';
import { HARASSMENT_PACK } from './harassment';
import { HATE_PACK } from './hate';
import { IMPERSONATION_PACK } from './impersonation';
import { PII_PACK } from './pii';
import { SELFHARM_PACK } from './selfharm';
import { SEXUAL_PACK } from './sexual';
import { SPAM_PACK } from './spam';
import { THREATS_PACK } from './threats';

export const ADMIN_RULE_PACKS: readonly RulePack[] = [
  THREATS_PACK, HARASSMENT_PACK, HATE_PACK, SEXUAL_PACK, DRUGS_PACK, SELFHARM_PACK, PII_PACK, IMPERSONATION_PACK, SPAM_PACK, ACADEMIC_PACK, COMMERCE_PACK,
];

export const ADMIN_RULE_PACK_IDS: readonly string[] = ADMIN_RULE_PACKS.map((p) => p.id);
