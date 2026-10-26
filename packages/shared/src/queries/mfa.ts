import type { Client, MfaFactorSummary, MfaStatus, TotpEnrollment } from "../types/models";

/**
 * Two-factor authentication for staff: thin, platform-agnostic wrappers over
 * Supabase Auth TOTP (`supabase.auth.mfa`). The website calls them from Server
 * Actions, the mobile app from its screens. After a code is verified Supabase
 * re-issues the session with the claim aal = 'aal2', which the admin RPCs check
 * in SQL; nothing here grants anything by itself.
 */

/** Which authenticators the user has and whether this session already passed one. */
export async function getMfaStatus(supabase: Client): Promise<MfaStatus> {
  const factorsResult = await supabase.auth.mfa.listFactors();
  if (factorsResult.error) throw factorsResult.error;
  const levelResult = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelResult.error) throw levelResult.error;

  const all = factorsResult.data.all ?? factorsResult.data.totp ?? [];
  const factors: MfaFactorSummary[] = all
    .filter((f) => f.factor_type === "totp")
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      status: f.status === "verified" ? "verified" : "unverified",
      createdAt: f.created_at,
    }));
  const currentLevel = levelResult.data.currentLevel === "aal2" ? "aal2" : "aal1";
  const nextLevel = levelResult.data.nextLevel === "aal2" ? "aal2" : "aal1";
  const enrolled = factors.some((f) => f.status === "verified");
  // Same rule as staff_mfa_verified() in SQL: the aal2 claim only counts while a verified factor
  // still exists (unenrolling does not re-issue the token, so the claim outlives the factor).
  return { currentLevel, nextLevel, verified: currentLevel === "aal2" && enrolled, enrolled, factors };
}

/**
 * Start adding an authenticator app. Returns what to show the user: the QR code
 * (an SVG data URL), the secret to type by hand and the otpauth URI. Finish with
 * `confirmTotpEnrollment` using the first code the app shows.
 */
export async function startTotpEnrollment(supabase: Client, friendlyName = "Authenticator app"): Promise<TotpEnrollment> {
  // Friendly names must be unique per user, so a half-finished enrolment would block this one. Best effort.
  const existing = await supabase.auth.mfa.listFactors().catch(() => null);
  for (const factor of existing?.data?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => null);
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error) throw error;
  // Supabase returns a ready data URL; older servers return the bare SVG.
  const qrCode = data.totp.qr_code.startsWith("data:") ? data.totp.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return { factorId: data.id, qrCode, secret: data.totp.secret, uri: data.totp.uri };
}

/** Step an existing session up to aal2 with a code from an enrolled authenticator. */
export async function verifyTotp(supabase: Client, factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

/** Finish enrolment with the first code from the app. The factor becomes verified and the session moves to aal2. */
export async function confirmTotpEnrollment(supabase: Client, factorId: string, code: string): Promise<void> {
  await verifyTotp(supabase, factorId, code);
}

/** Remove an authenticator. Removing a verified one needs an aal2 session (Supabase rule). */
export async function removeMfaFactor(supabase: Client, factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
