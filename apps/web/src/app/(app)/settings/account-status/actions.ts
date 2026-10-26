"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeSanction, submitAppeal, TrustSafetyError } from "@apartment-book/shared";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

function failure(e: unknown): Result {
  if (e instanceof TrustSafetyError) return { ok: false, error: e.message };
  return { ok: false, error: "Something went wrong. Try again." };
}

/** "Got it" on a notice: a warning stops holding your posts once acknowledged. */
export async function acknowledgeAction(sanctionId: string): Promise<Result> {
  if (!(await getCurrentUser())) return { ok: false, error: "Log in first." };
  try {
    await acknowledgeSanction(await createClient(), String(sanctionId).slice(0, 64));
    revalidatePath("/settings/account-status");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** One appeal per notice, within 14 days, 10 to 1,000 characters (the database checks all of it). */
export async function appealAction(sanctionId: string, text: string): Promise<Result> {
  if (!(await getCurrentUser())) return { ok: false, error: "Log in first." };
  try {
    await submitAppeal(await createClient(), String(sanctionId).slice(0, 64), String(text).slice(0, 1000));
    revalidatePath("/settings/account-status");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
