"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { voteBuzzAction } from "@/lib/actions/buzz";
import { cn } from "@/lib/utils";

type Vote = -1 | 0 | 1;

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  return `${(n / 1000).toFixed(abs < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

/** Reddit-style votes: up, score, down. The same arrow again clears your vote. Updates right away, then settles on the server's numbers. */
export function BuzzVote({ postId, score: initialScore, myVote: initialVote, signedIn, direction = "column", className }: { postId: string; score: number; myVote: Vote; signedIn: boolean; direction?: "column" | "row"; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ score: number; vote: Vote }>({ score: initialScore, vote: initialVote });
  const [failed, setFailed] = useState(false);
  // Only the newest request may settle the numbers, so fast taps cannot flicker backwards.
  const latest = useRef(0);

  async function cast(arrow: 1 | -1) {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/buzz/${postId}`)}`);
      return;
    }
    const before = state;
    const next: Vote = before.vote === arrow ? 0 : arrow;
    setFailed(false);
    setState({ score: before.score - before.vote + next, vote: next });
    const ticket = ++latest.current;
    const result = await voteBuzzAction(postId, next).catch(() => ({ error: "failed" }) as const);
    if (ticket !== latest.current) return;
    if ("error" in result) {
      setState(before);
      setFailed(true);
      return;
    }
    setState({ score: result.score, vote: result.myVote });
  }

  const arrowClass = "flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100";

  return (
    <div className={cn("flex shrink-0 items-center", direction === "column" ? "flex-col" : "flex-row gap-0.5 rounded-full bg-gray-100", className)} data-testid="buzz-vote">
      <button type="button" onClick={() => cast(1)} aria-label="Upvote" aria-pressed={state.vote === 1} className={cn(arrowClass, "hover:text-brand-700", state.vote === 1 && "text-brand-600")}>
        <ArrowBigUp className={cn("h-6 w-6", state.vote === 1 && "fill-current")} />
      </button>
      <span
        aria-live="polite"
        aria-label={`Score ${state.score}`}
        title={failed ? "Could not save your vote. Try again." : undefined}
        className={cn("min-w-6 text-center text-sm font-bold tabular-nums", state.vote === 1 ? "text-brand-700" : state.vote === -1 ? "text-red-600" : "text-gray-800", failed && "text-gray-400")}
      >
        {compact(state.score)}
      </span>
      <button type="button" onClick={() => cast(-1)} aria-label="Downvote" aria-pressed={state.vote === -1} className={cn(arrowClass, "hover:text-red-600", state.vote === -1 && "text-red-600")}>
        <ArrowBigDown className={cn("h-6 w-6", state.vote === -1 && "fill-current")} />
      </button>
    </div>
  );
}
