"use server";

import { revalidatePath } from "next/cache";
import { retryMediaJob } from "@apartment-book/shared";
import { adminErrorMessage, requireStaffAction } from "@/lib/admin";
import { runMediaWorker, type WorkerSummary } from "@/lib/media-worker";
import { createClient } from "@/lib/supabase/server";

/** Make a pending job due now (moderator+, aal2; the RPC refuses a job a worker claimed in the last 15 minutes). */
export async function retryMediaJobAction(id: number): Promise<{ error?: string }> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error };
  if (!Number.isInteger(id) || id <= 0) return { error: "Unknown job." };
  try {
    await retryMediaJob(await createClient(), id);
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
  revalidatePath("/media");
  return {};
}

/**
 * Run the worker now (moderator+, aal2). The worker uses the service role, but it only
 * ever performs jobs the database queued and staff can already see, so any staff member
 * may trigger a sweep. Returns what happened for the page to show.
 */
export async function runMediaWorkerAction(): Promise<{ error?: string; summary?: WorkerSummary }> {
  const gate = await requireStaffAction();
  if (gate.error) return { error: gate.error };
  try {
    const summary = await runMediaWorker({ limit: 50, budgetMs: 40_000 });
    revalidatePath("/media");
    revalidatePath("/");
    return { summary };
  } catch (error) {
    return { error: adminErrorMessage(error) };
  }
}
