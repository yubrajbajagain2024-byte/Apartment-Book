"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pause, Pencil, Play, Send, Square, Trash2, Undo2 } from "lucide-react";
import { adDisplayStatus, teamRoleAllows, type Ad, type BusinessTeamRole } from "@apartment-book/shared";
import { adCommandAction, type AdCommand } from "@/lib/actions/business";
import { cn } from "@/lib/utils";
import { PortalLink } from "./portal-base";
import { bizButton, Notice } from "./ui";

/**
 * What can be done with an ad now, by this person: anyone who publishes edits drafts, takes a submitted ad back,
 * pauses and copies; the owner and admins also submit, resume and end (the database checks the same). Ending and
 * deleting ask once more.
 */
export function AdActions({ ad, role, ready }: { ad: Pick<Ad, "id" | "status" | "starts_at" | "ends_at" | "paused_by">; role: BusinessTeamRole; ready: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdCommand | null>(null);
  const status = adDisplayStatus(ad);
  const publish = teamRoleAllows(role, "publish");
  const spend = teamRoleAllows(role, "manage_ads");
  const run = (command: AdCommand) => {
    if ((command === "end" || command === "delete") && confirming !== command) {
      setConfirming(command);
      return;
    }
    setConfirming(null);
    setError(null);
    start(async () => {
      const result = await adCommandAction(ad.id, command);
      if (result?.error) setError(result.error);
      router.refresh();
    });
  };
  if (!publish) return null;
  const editable = status === "draft" || status === "rejected";
  return (
    <div className="flex flex-col gap-3">
      {error ? <Notice tone="danger" title={error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {editable && spend ? (
          <button type="button" disabled={pending || !ready} onClick={() => run("submit")} className={bizButton({ variant: "primary" })} data-testid="ad-submit" title={ready ? undefined : "Fix what is listed first"}>
            <Send className="h-4 w-4" /> Submit for review
          </button>
        ) : null}
        {editable ? (
          <PortalLink href={`/ads/${ad.id}/edit`} className={bizButton({ variant: spend ? "secondary" : "primary" })}>
            <Pencil className="h-4 w-4" /> Edit
          </PortalLink>
        ) : null}
        {status === "pending_review" ? (
          <button type="button" disabled={pending} onClick={() => run("withdraw")} className={bizButton({ variant: "secondary" })}>
            <Undo2 className="h-4 w-4" /> Back to draft
          </button>
        ) : null}
        {status === "scheduled" || status === "active" ? (
          <button type="button" disabled={pending} onClick={() => run("pause")} className={bizButton({ variant: "secondary" })}>
            <Pause className="h-4 w-4" /> Pause
          </button>
        ) : null}
        {status === "paused" && ad.paused_by !== "admin" && spend ? (
          <button type="button" disabled={pending} onClick={() => run("resume")} className={bizButton({ variant: "primary" })}>
            <Play className="h-4 w-4" /> Resume
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => run("duplicate")} className={bizButton({ variant: "ghost" })}>
          <Copy className="h-4 w-4" /> Copy into a new draft
        </button>
        {(status === "scheduled" || status === "active" || status === "paused") && spend ? (
          <button type="button" disabled={pending} onClick={() => run("end")} className={cn(bizButton({ variant: confirming === "end" ? "danger" : "ghost" }))}>
            <Square className="h-4 w-4" /> {confirming === "end" ? "End it now? It cannot restart" : "End now"}
          </button>
        ) : null}
        {editable ? (
          <button type="button" disabled={pending} onClick={() => run("delete")} className={bizButton({ variant: confirming === "delete" ? "danger" : "ghost" })}>
            <Trash2 className="h-4 w-4" /> {confirming === "delete" ? "Delete this draft?" : "Delete"}
          </button>
        ) : null}
      </div>
      {editable && !spend ? <p className="text-[13px] text-biz-ink-3">An owner or admin of your business submits ads: it commits the budget.</p> : null}
    </div>
  );
}
