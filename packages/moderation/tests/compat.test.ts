/**
 * The engine ↔ shared-layer seam:
 *  - the author-facing types (`AuthorNotice`, `SupportResources`, `ContentBlockedDetails`, `ModerationUserMessage`,
 *    `ModerationCategory`) are structurally the same as `packages/shared/src/buzz/types.ts` (checked by the compiler:
 *    `npx tsc --noEmit -p packages/moderation/tsconfig.json`);
 *  - the guideline anchors equal the shared `GUIDELINE_ANCHORS` (the `/guidelines` page's section ids);
 *  - SERVER-ONLY: nothing outside the website's Buzz write API imports this package (no client component, no shared
 *    code, no app code), and the package itself carries the `server-only` guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as Engine from '../src/types';
import type * as Shared from '../../shared/src/buzz/types';
import { loadEngine } from './helpers/load.ts';

const m = await loadEngine();
const shared = await import('../../shared/src/buzz/constants');

/* ───────────── compile-time: mutual assignability (a mismatch fails the typecheck) ───────────── */

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const typeChecks: [
  Same<Engine.AuthorNotice, Shared.AuthorNotice>,
  Same<Engine.SupportResources, Shared.SupportResources>,
  Same<Engine.ContentBlockedDetails, Shared.ContentBlockedDetails>,
  Same<Engine.ModerationUserMessage, Shared.ModerationUserMessage>,
  Same<Engine.ModerationCategory, Shared.ModerationCategory>,
] = [true, true, true, true, true];

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** An import / re-export / require / dynamic import of the engine package (by name or by path). */
const IMPORTS_ENGINE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](?:@apartment-book\/moderation|[^'"]*packages\/moderation)(?:\/[^'"]*)?['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe('engine ↔ shared layer', () => {
  it('author-facing types are the shared ones (compile-time check above)', () => {
    assert.deepEqual(typeChecks, [true, true, true, true, true]);
  });

  it('guideline anchors are the shared GUIDELINE_ANCHORS (bare section ids of /guidelines)', () => {
    assert.deepEqual(m.GUIDELINE_ANCHORS, shared.GUIDELINE_ANCHORS);
    assert.deepEqual(Object.keys(m.CATEGORY_LABELS).sort(), Object.keys(shared.MODERATION_CATEGORY_LABELS).sort());
    for (const anchor of Object.values(m.GUIDELINE_ANCHORS)) assert.match(anchor, /^[a-z-]+$/);
  });

  it('a content_blocked body built by the engine is what the shared client parses', () => {
    const blocked = m.contentBlocked(m.moderate('kys loser', { surface: 'buzz', accountAgeMs: 1e12, activeStrikePoints: 0 }));
    const details: Shared.ContentBlockedDetails = blocked.details;
    assert.equal(details.messageId, 'M-KYS');
    assert.equal(details.guidelineAnchor, 'harassment');
  });
});

describe('server-only guard', () => {
  it('the import detector sees every import form (and ignores mere mentions)', () => {
    for (const src of [
      "import { moderate } from '@apartment-book/moderation';",
      'import type { ModerationResult } from "@apartment-book/moderation";',
      "export { moderate } from '@apartment-book/moderation';",
      "const m = await import('@apartment-book/moderation');",
      "import '../../../packages/moderation/src/index';",
      "const x = require('@apartment-book/moderation/src/engine');",
    ]) assert.ok(IMPORTS_ENGINE.test(src), src);
    assert.ok(!IMPORTS_ENGINE.test('// text is moderated server-side by @apartment-book/moderation'));
  });

  it('the package entry imports `server-only`', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    assert.match(index, /^import 'server-only';$/m);
  });

  it('only the website’s Buzz write API (route handlers + lib/buzz-server) imports the engine', () => {
    const allowed = [/^apps\/web\/src\/app\/api\/buzz\//, /^apps\/web\/src\/lib\/buzz-server\//];
    const offenders: string[] = [];
    for (const root of ['apps/web/src', 'apps/mobile', 'packages/shared/src']) {
      let files: string[] = [];
      try {
        files = walk(`${REPO}${root}`);
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = file.slice(REPO.length);
        const src = readFileSync(file, 'utf8');
        if (!IMPORTS_ENGINE.test(src)) continue;
        if (!allowed.some((re) => re.test(rel))) offenders.push(rel);
        else if (/^\s*['"]use client['"]/m.test(src)) offenders.push(`${rel} (client component)`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
