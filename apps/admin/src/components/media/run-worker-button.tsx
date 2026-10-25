"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { runMediaWorkerAction } from "@/lib/actions/media";
import type { WorkerSummary } from "@/lib/media-worker";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";

/** Run the worker from the page and show what it did. */
export function RunWorkerButton({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<WorkerSummary | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={!enabled}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await runMediaWorkerAction();
            if (result.error) setError(result.error);
            else {
              setSummary(result.summary ?? null);
              router.refresh();
            }
          })
        }
        className="self-start"
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        Run the worker now
      </Button>
      <FormMessage
        error={error}
        success={
          summary
            ? summary.claimed === 0
              ? "Nothing was due."
              : `${summary.claimed} claimed, ${summary.done} done, ${summary.failed} failed in ${(summary.ms / 1000).toFixed(1)}s.${summary.failed ? " Failed jobs keep their error below and come back later." : ""}`
            : null
        }
      />
    </div>
  );
}
