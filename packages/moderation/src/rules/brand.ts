/**
 * UniVerse → UniBuzz. The rule packs were written for UniVerse, so a few phrases name the product ("universe staff
 * here", "universe_support", "selling my universe account"). Each of those keeps its UniVerse form (harmless, and the
 * fixtures still test it) and gains a UniBuzz twin. SERVER-ONLY DATA (see rules/baseline.ts).
 */
const PRODUCT = /universe/g;
const BRAND = 'unibuzz';

/** `terms` plus a `unibuzz` twin of every term that names `universe` (order kept, no duplicates). */
export function withBrandVariants(terms: readonly string[]): string[] {
  const out = [...terms];
  const seen = new Set(out);
  for (const term of terms) {
    if (!term.includes('universe')) continue;
    const twin = term.replace(PRODUCT, BRAND);
    if (!seen.has(twin)) {
      seen.add(twin);
      out.push(twin);
    }
  }
  return out;
}
