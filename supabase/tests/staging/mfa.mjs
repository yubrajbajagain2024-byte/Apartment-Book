// Two-factor sign-in for the staging scripts, the way Supabase Auth does it: a TOTP authenticator (RFC 6238, base32
// secret, 30-second steps, HMAC-SHA-1, 6 digits) enrolled through the Auth API and passed on every sign-in, so an
// admin's session is aal2 as the staff console, CampConnect Admin and the business portal's admin tools require.
// The secret is the account's authenticator key; the scripts keep it next to the account's password in their
// git-ignored state file, never in the repository.
import { createHmac } from "node:crypto";

/** The code an authenticator app would show now for `secret`. */
export function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); value &= (1 << bits) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A code with at least 5 seconds of its step left, so one verification never straddles two steps. */
async function freshCode(secret) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 5) await wait(left * 1000 + 300);
  return totp(secret);
}

async function verify(client, factorId, secret) {
  for (let attempt = 0; ; attempt++) {
    const ch = await client.auth.mfa.challenge({ factorId });
    if (ch.error) throw new Error(`challenge: ${ch.error.message}`);
    const v = await client.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: await freshCode(secret) });
    if (!v.error) return;
    if (attempt >= 1) throw new Error(`verify: ${v.error.message}`);
    await wait(31000 - (Date.now() % 30000));
  }
}

/** Enrols an authenticator on the signed-in client's account and verifies it: the session becomes aal2. Returns the base32 secret. */
export async function enrolAuthenticator(client, friendlyName = "Authenticator app") {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error) throw new Error(`enroll: ${error.message}`);
  await verify(client, data.id, data.totp.secret);
  return data.totp.secret;
}

/** Passes the second factor on a signed-in client with the account's authenticator key: the session becomes aal2. */
export async function passSecondFactor(client, secret) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error(`factors: ${error.message}`);
  const factor = data.totp.find((f) => f.status === "verified") ?? data.totp[0];
  if (!factor) throw new Error("no authenticator on this account");
  await verify(client, factor.id, secret);
}

/** The session's assurance level as the client sees it: "aal1" or "aal2". */
export async function assuranceLevel(client) {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(`assurance level: ${error.message}`);
  return data.currentLevel;
}
