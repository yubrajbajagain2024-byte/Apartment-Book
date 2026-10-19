"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { compactCount } from "@apartment-book/shared";
import { voteBuzzAction, voteBuzzCommentAction } from "@/lib/actions/buzz";
import { cn } from "@/lib/utils";

type Vote = -1 | 0 | 1;
type Tally = { score: number; vote: Vote };

/**
 * Reddit-style votes: up arrow, score, down arrow. The same arrow again clears your vote.
 * `pill` is the outlined pill under a thread (▲ score | ▼); `bare` is the quiet version at the end of a reply.
 * The number changes right away. Only one request is in the air at a time: taps made meanwhile are remembered and
 * the last one is sent when the answer comes back, so nothing is sent twice and the server's numbers always win.
 */
export function BuzzVote({
  postId,
  commentId,
  score: initialScore,
  myVote: initialVote,
  signedIn,
  variant = "pill",
  onSettled,
  className,
}: {
  postId: string;
  /** Vote on this reply instead of the thread. */
  commentId?: string;
  score: number;
  myVote: Vote;
  signedIn: boolean;
  variant?: "pill" | "bare";
  /** The server's numbers after a vote, so a parent can remember them. */
  onSettled?: (tally: { score: number; myVote: Vote }) => void;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<Tally>({ score: initialScore, vote: initialVote });
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const wanted = useRef<Vote>(initialVote);
  const settled = useRef<Tally>({ score: initialScore, vote: initialVote });

  async function cast(arrow: 1 | -1) {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/buzz/${postId}`)}`);
      return;
    }
    const next: Vote = state.vote === arrow ? 0 : arrow;
    wanted.current = next;
    setFailed(false);
    setState({ score: state.score - state.vote + next, vote: next });
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      for (;;) {
        const sending = wanted.current;
        const result = await (commentId ? voteBuzzCommentAction(commentId, sending) : voteBuzzAction(postId, sending)).catch(() => ({ error: "failed" }) as const);
        if ("error" in result) {
          wanted.current = settled.current.vote;
          setState(settled.current);
          setFailed(true);
          return;
        }
        settled.current = { score: result.score, vote: result.myVote };
        if (wanted.current === sending) {
          setState(settled.current);
          onSettled?.({ score: result.score, myVote: result.myVote });
          return;
        }
      }
    } finally {
      inFlight.current = false;
    }
  }

  const pill = variant === "pill";
  const arrowClass = cn("flex items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100", pill ? "h-8 w-8" : "h-8 w-7");
  const iconClass = pill ? "h-5 w-5" : "h-[22px] w-[22px]";

  return (
    <div className={cn("flex shrink-0 items-center", pill && "h-9 rounded-full border border-gray-300 bg-white px-0.5", className)} data-testid="buzz-vote">
      <button type="button" onClick={() => cast(1)} aria-label="Upvote" aria-pressed={state.vote === 1} className={cn(arrowClass, "hover:text-brand-700", state.vote === 1 && "text-brand-600")}>
        <ArrowBigUp className={cn(iconClass, state.vote === 1 && "fill-current")} strokeWidth={1.75} />
      </button>
      <span
        aria-live="polite"
        aria-label={`Score ${state.score}`}
        title={failed ? "Could not save your vote. Try again." : undefined}
        className={cn("min-w-5 text-center text-[13px] font-semibold tabular-nums", pill ? "pr-2" : "px-0.5", state.vote === 1 ? "text-brand-700" : state.vote === -1 ? "text-red-600" : "text-gray-800", failed && "text-gray-400")}
      >
        {compactCount(state.score)}
      </span>
      {pill ? <span aria-hidden="true" className="h-4 w-px bg-gray-300" /> : null}
      <button type="button" onClick={() => cast(-1)} aria-label="Downvote" aria-pressed={state.vote === -1} className={cn(arrowClass, "hover:text-red-600", state.vote === -1 && "text-red-600", pill && "ml-0.5")}>
        <ArrowBigDown className={cn(iconClass, state.vote === -1 && "fill-current")} strokeWidth={1.75} />
      </button>
    </div>
  );
}
