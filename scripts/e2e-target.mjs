// Which Supabase project an end-to-end script talks to. Production, as these scripts always did, unless
// STAGING_SUPABASE_REF names another project: that one must not be production and must be named as a staging project
// (the guard supabase/tests/staging/business-portal.mjs has), so a mistyped ref never sends test data to the live site.
export const PRODUCTION_REF = "dskbzoqreandwwpxiplh";

export async function e2eRef(token) {
  const staging = process.env.STAGING_SUPABASE_REF;
  if (!staging) return PRODUCTION_REF;
  if (staging === PRODUCTION_REF) throw new Error("STAGING_SUPABASE_REF is production's ref: refusing.");
  const res = await fetch(`https://api.supabase.com/v1/projects/${staging}`, { headers: { Authorization: `Bearer ${token}` } });
  const project = await res.json().catch(() => ({}));
  if (!res.ok || !/staging/i.test(project.name ?? "")) throw new Error(`Refusing: project ${staging} is not named as a staging project.`);
  return staging;
}
