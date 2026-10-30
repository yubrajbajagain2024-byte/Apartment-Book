import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimMediaJobs, completeMediaJob, failMediaJob, muxPosterUrl, type Client, type MediaJob } from "@apartment-book/shared";
import { mediaWorkerEnabled } from "@/lib/env";
import { createPlaybackId, deleteAsset, deletePlaybackId, getAsset, muxConfigured, MuxError } from "@/lib/mux";
import { createServiceClient } from "@/lib/supabase/service";
import { errorMessage } from "@/lib/utils";

/**
 * The media clean-up worker. Supabase does not allow touching Storage from SQL and Mux
 * lives outside the database, so migration 15 queues the work in `media_jobs` and this
 * code performs it with the service role and the Mux credentials:
 *
 *   quarantine    move uploads/<ref> -> quarantine/<ref>   (already moved = done)
 *   release       move it back                             (already back = done)
 *   delete_object remove <ref> from both buckets           (not found = done)
 *   delete_prefix list + remove everything under <ref> in both buckets
 *   mux_disable   delete every playback id of asset <ref>
 *   mux_enable    create a public playback id (if none), write it to public.media
 *                 and refresh the `videos` snapshot of (target_type, target_id)
 *   mux_delete    delete the asset, then the media rows, then mark the job done
 *
 * Claiming (media_jobs_claim) bumps `attempts` and books the next try, so a job this
 * process never reports on comes back later; a failure stores the error and is retried
 * with back-off. Staff see all of it on the Media page and can retry a job at once.
 * It runs after every hide/restore/delete (apps/admin/src/lib/actions/moderation.ts),
 * from the Media page, and from GET /api/media/worker (Vercel cron) as the retry sweep.
 */

const UPLOADS = "uploads";
const QUARANTINE = "quarantine";
const VIDEO_TABLES: Record<string, string> = { apartment: "apartments", roommate: "roommate_posts", post: "feed_posts", buzz: "buzz_posts" };

export type WorkerResult = { id: number; kind: MediaJob["kind"]; ref: string; status: "done" | "failed"; error?: string };
export type WorkerSummary = {
  /** False unless MEDIA_WORKER_ENABLED=true and SUPABASE_SERVICE_ROLE_KEY are both set: nothing was attempted. */
  configured: boolean;
  claimed: number;
  done: number;
  failed: number;
  results: WorkerResult[];
  ms: number;
};

export async function runMediaWorker(opts: { limit?: number; budgetMs?: number } = {}): Promise<WorkerSummary> {
  const started = Date.now();
  const summary: WorkerSummary = { configured: false, claimed: 0, done: 0, failed: 0, results: [], ms: 0 };
  // The single gate for every caller (after a hide, the Media page, the cron sweep): off unless switched on explicitly.
  if (!mediaWorkerEnabled()) return summary;
  const admin = createServiceClient();
  if (!admin) return summary;
  summary.configured = true;
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const budget = opts.budgetMs ?? 25_000;

  while (summary.claimed < limit && Date.now() - started < budget) {
    const jobs = await claimMediaJobs(admin, Math.min(10, limit - summary.claimed));
    if (jobs.length === 0) break;
    for (const job of jobs) {
      summary.claimed++;
      try {
        await perform(admin, job);
        await completeMediaJob(admin, job.id);
        summary.done++;
        summary.results.push({ id: job.id, kind: job.kind, ref: job.ref, status: "done" });
      } catch (error) {
        const message = errorMessage(error, "Unknown error");
        await failMediaJob(admin, job.id, message).catch(() => undefined);
        summary.failed++;
        summary.results.push({ id: job.id, kind: job.kind, ref: job.ref, status: "failed", error: message });
      }
    }
  }
  summary.ms = Date.now() - started;
  return summary;
}

async function perform(admin: Client, job: MediaJob): Promise<void> {
  switch (job.kind) {
    case "quarantine":
      return moveObject(admin, UPLOADS, QUARANTINE, job.ref);
    case "release":
      return moveObject(admin, QUARANTINE, UPLOADS, job.ref);
    case "delete_object":
      await removeObjects(admin, UPLOADS, [job.ref]);
      await removeObjects(admin, QUARANTINE, [job.ref]);
      return;
    case "delete_prefix":
      await removePrefix(admin, UPLOADS, job.ref);
      await removePrefix(admin, QUARANTINE, job.ref);
      return;
    case "mux_disable":
      return muxDisable(job.ref);
    case "mux_enable":
      return muxEnable(admin, job);
    case "mux_delete":
      return muxDelete(admin, job.ref);
    default:
      throw new Error(`Unknown job kind ${String(job.kind)}`);
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Move one object between buckets under the same path. Idempotent: a repeat of a finished move is a no-op. */
async function moveObject(admin: Client, from: string, to: string, path: string): Promise<void> {
  const { error } = await admin.storage.from(from).move(path, path, { destinationBucket: to });
  if (!error) return;
  const message = error.message || "move failed";
  if (/not found/i.test(message)) {
    // Moved by an earlier attempt, or the file never existed: either way there is nothing left to move.
    return;
  }
  if (/already exists/i.test(message)) {
    // The destination already has it (a retried half-move): drop the source copy.
    await removeObjects(admin, from, [path]);
    return;
  }
  throw new Error(`${from} -> ${to} ${path}: ${message}`);
}

async function removeObjects(admin: Client, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error && !/not found/i.test(error.message)) throw new Error(`${bucket}: ${error.message}`);
  }
}

/** Everything under `prefix` ("avatars/<uid>/"), a few folder levels deep. */
async function removePrefix(admin: Client, bucket: string, prefix: string): Promise<void> {
  const folder = prefix.replace(/\/+$/, "");
  if (!folder || folder.split("/").length < 2) throw new Error(`Refusing to clear a top-level prefix: ${prefix}`);
  const files: string[] = [];
  await collect(admin, bucket, folder, files, 0);
  await removeObjects(admin, bucket, files);
}

async function collect(admin: Client, bucket: string, folder: string, out: string[], depth: number): Promise<void> {
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${folder}: ${error.message}`);
    if (!data || data.length === 0) return;
    for (const entry of data) {
      if (!entry.name || entry.name === ".emptyFolderPlaceholder") continue;
      const path = `${folder}/${entry.name}`;
      const isFolder = (entry.id as string | null) === null;
      if (isFolder) {
        if (depth < 3) await collect(admin, bucket, path, out, depth + 1);
      } else {
        out.push(path);
      }
    }
    if (data.length < 1000) return;
    offset += data.length;
  }
}

// ---------------------------------------------------------------------------
// Mux
// ---------------------------------------------------------------------------

function requireMux(): void {
  if (!muxConfigured()) throw new Error("Mux is not configured on the admin app (MUX_TOKEN_ID, MUX_TOKEN_SECRET)");
}

async function assetOrNull(assetId: string) {
  try {
    return await getAsset(assetId);
  } catch (error) {
    if (error instanceof MuxError && error.status === 404) return null;
    throw error;
  }
}

async function muxDisable(assetId: string): Promise<void> {
  requireMux();
  const asset = await assetOrNull(assetId);
  if (!asset) return; // already deleted: nothing can play
  for (const playback of asset.playback_ids ?? []) await deletePlaybackId(assetId, playback.id);
}

async function muxEnable(admin: Client, job: MediaJob): Promise<void> {
  requireMux();
  const asset = await assetOrNull(job.ref);
  if (!asset) throw new Error("The video no longer exists on Mux");
  const playback = asset.playback_ids?.find((p) => p.policy === "public")?.id ?? (await createPlaybackId(job.ref, "public")).id;

  // The media rows that point at this asset: their old playback ids identify the
  // snapshot entries to refresh (Buzz stores no media id).
  const { data: mediaRows, error: mediaError } = await admin.from("media").select("id, playback_id").eq("provider_asset_id", job.ref);
  if (mediaError) throw new Error(mediaError.message);
  const mediaIds = new Set((mediaRows ?? []).map((m) => m.id));
  const oldPlaybackIds = new Set((mediaRows ?? []).map((m) => m.playback_id).filter((p): p is string => Boolean(p)));
  const { error: updateError } = await admin.from("media").update({ playback_id: playback, poster_url: muxPosterUrl(playback) }).eq("provider_asset_id", job.ref);
  if (updateError) throw new Error(updateError.message);

  const table = VIDEO_TABLES[job.targetType ?? ""];
  if (!table || !job.targetId) return;
  const raw = admin as unknown as SupabaseClient;
  const { data: row, error: rowError } = await raw.from(table).select("id, videos").eq("id", job.targetId).maybeSingle();
  if (rowError) throw new Error(rowError.message);
  const videos: unknown = row?.videos;
  if (!Array.isArray(videos)) return;
  let changed = false;
  const next = videos.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return entry;
    const v = entry as Record<string, unknown>;
    const matches = (typeof v.media_id === "string" && mediaIds.has(v.media_id)) || (typeof v.playback_id === "string" && oldPlaybackIds.has(v.playback_id));
    if (!matches || v.playback_id === playback) return entry;
    changed = true;
    return { ...v, playback_id: playback, poster_url: muxPosterUrl(playback) };
  });
  if (!changed) return;
  // The service role bypasses row-level security; the moderation columns are pinned by a trigger either way.
  const { error: snapshotError } = await raw.from(table).update({ videos: next }).eq("id", job.targetId);
  if (snapshotError) throw new Error(snapshotError.message);
}

async function muxDelete(admin: Client, assetId: string): Promise<void> {
  requireMux();
  try {
    await deleteAsset(assetId);
  } catch (error) {
    if (!(error instanceof MuxError && error.status === 404)) throw error;
  }
  // Deleting the media rows queues another mux_delete for the same asset; the pending
  // unique index collapses it into this job, which is marked done right after.
  const { error } = await admin.from("media").delete().eq("provider_asset_id", assetId);
  if (error) throw new Error(error.message);
}
