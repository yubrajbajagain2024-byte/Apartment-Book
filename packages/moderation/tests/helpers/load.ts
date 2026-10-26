/**
 * Test loader for `npm run test:moderation` (plain `node --test`, Node ≥ 22.18 strips the types).
 *
 * `src/**` (and the website's `lib/buzz-server/**`) use extensionless relative imports, so that the website's
 * TypeScript — which has no `allowImportingTsExtensions` — can type-check the engine it imports. Node's ESM loader needs
 * exact paths, so this registers a resolve hook (`module.registerHooks`, Node ≥ 22.15) that
 *   - tries `<specifier>.ts` and `<specifier>/index.ts` for an extensionless relative import,
 *   - maps `server-only` (a Next.js build-time guard) to an empty module, and
 *   - marks the website's `.ts` files as ES modules (apps/web/package.json has no "type").
 * Test files import ONLY this helper statically and load the code under test with the dynamic imports below.
 */
import nodeModule from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: NextResolve) => ResolveResult;

const registerHooks = (nodeModule as unknown as { registerHooks?: (hooks: { resolve: ResolveHook }) => unknown }).registerHooks;
if (typeof registerHooks !== 'function') {
  throw new Error('These tests need Node 22.15+ (module.registerHooks). Run them with the Node at ~/.local/bin.');
}

const EMPTY_MODULE = 'data:text/javascript,export%20%7B%7D%3B';

function isFile(url: URL): boolean {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

let installed = (globalThis as { __moderationTestHooks?: boolean }).__moderationTestHooks === true;
if (!installed) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'server-only') return { url: EMPTY_MODULE, format: 'module', shortCircuit: true };
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      let resolved: ResolveResult | null = null;
      if (relative && context.parentURL && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
        for (const suffix of ['.ts', '/index.ts']) {
          const candidate = new URL(specifier + suffix, context.parentURL);
          if (isFile(candidate)) {
            resolved = nextResolve(candidate.href, context);
            break;
          }
        }
      }
      resolved ??= nextResolve(specifier, context);
      // apps/web's package.json has no "type": its .ts files are ES modules (Next compiles them); say so up front
      if (resolved.url.includes('/apps/web/src/') && resolved.url.endsWith('.ts')) return { ...resolved, format: 'module-typescript' };
      return resolved;
    },
  });
  installed = true;
  (globalThis as { __moderationTestHooks?: boolean }).__moderationTestHooks = true;
}

/** The engine's public API (`@apartment-book/moderation`). */
export function loadEngine(): Promise<typeof import('../../src/index')> {
  return import('../../src/index');
}

/** The website's Buzz write API core (route handlers with injected dependencies). */
export function loadBuzzServer(): Promise<typeof import('../../../../apps/web/src/lib/buzz-server/handlers')> {
  return import('../../../../apps/web/src/lib/buzz-server/handlers');
}

/** The rule data itself (for structural checks of the packs). */
export async function loadRuleData(): Promise<{ baseline: typeof import('../../src/rules/baseline'); admin: typeof import('../../src/rules/admin/index') }> {
  const [baseline, admin] = await Promise.all([import('../../src/rules/baseline'), import('../../src/rules/admin/index')]);
  return { baseline, admin };
}
