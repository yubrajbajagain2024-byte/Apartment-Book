import { useState } from "react";
import {
  BUZZ_COMPOSER_COPY,
  BUZZ_LIMITS,
  BUZZ_PROMPT_COPY,
  buzzErrorMessage,
  createBuzzPost,
  createBuzzReply,
  deleteImageByUrl,
  getBuzzPromptThread,
  isBuzzError,
  type Buzz,
  type BuzzPostingStatus,
  type CreateBuzzRequest,
} from "@apartment-book/shared";
import { buzzWriteTarget } from "@/lib/buzz-actions";
import { buzzState, emitBuzzEvent, getBuzzState, putBuzzItems, type BuzzDraft } from "@/lib/buzz-store";
import { hapticSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useBuzzModeration } from "./moderation";

/**
 * Whether a draft can be posted: words or a title within their limits, a complete poll (2–4 different options) and no
 * poll while polls are still locked for a new account. An answer in the prompt's thread is a reply: words only. Shared
 * by the Buzz page's composer and the camera's BUZZ mode.
 */
export function buzzDraftCheck(draft: BuzzDraft, posting: BuzzPostingStatus | null, opts?: { inPromptThread?: boolean }): { ready: boolean; pollsLocked: boolean } {
  const text = draft.text.trim();
  if (opts?.inPromptThread) return { ready: text.length > 0 && text.length <= BUZZ_LIMITS.replyText, pollsLocked: false };
  const title = draft.title.trim();
  const options = draft.options.map((o) => o.trim());
  const filled = options.filter(Boolean);
  const pollValid = !draft.pollOn || (filled.length >= BUZZ_LIMITS.pollMinOptions && filled.length === options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length);
  const pollsLocked = posting?.pollsUnlockAt != null && posting.pollsUnlockAt > Date.now();
  const ready = (text.length > 0 || title.length > 0) && text.length <= BUZZ_LIMITS.text && title.length <= BUZZ_LIMITS.title && pollValid && (!draft.pollOn || !pollsLocked);
  return { ready, pollsLocked };
}

/**
 * Posting the draft in the Buzz store through the website's moderated write API, as every Buzz composer does: on
 * success the buzz joins the store, the draft is cleared, the feed it went to is shown and refreshed, "Buzzed to …"
 * (or "Held for review") is toasted, and `onDone` runs once any support sheet is closed; a refusal shows the
 * moderation sheet (`moderation.element` must be rendered by the caller) or a toast.
 */
export function useBuzzSubmit({ onPosted, onDone, onEdit }: { onPosted?: (buzz: Buzz) => void; onDone?: () => void; onEdit?: () => void } = {}) {
  const moderation = useBuzzModeration();
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    const state = getBuzzState();
    const d = state.draft;
    const text = d.text.trim();
    // An answer to the prompt is titled with the prompt (the database makes sure of it too, where it can).
    const promptText = d.promptId ? Object.values(state.meta).find((m) => m?.value.prompt?.id === d.promptId)?.value.prompt?.text : undefined;
    const title = promptText ? promptText.slice(0, BUZZ_LIMITS.title) : d.title.trim();
    const options = d.options.map((o) => o.trim());
    setSending(true);
    const body: CreateBuzzRequest = {
      text,
      scope: d.scope,
      ...(d.category ? { category: d.category } : {}),
      ...(title ? { title } : {}),
      ...(d.video ? { video: d.video } : d.images.length > 0 ? { images: d.images.map((p) => p.url), imageMeta: d.images } : {}),
      ...(d.pollOn ? { poll: { options, durationDays: d.durationDays } } : {}),
      ...(d.promptId ? { promptId: d.promptId } : {}),
    };
    try {
      const res = await createBuzzPost(await buzzWriteTarget(), body);
      const { moderation: notice, ...buzz } = res;
      putBuzzItems([buzz]);
      hapticSuccess();
      buzzState.clearDraft();
      // Show the feed the buzz went to, so it is right there.
      buzzState.setScope(buzz.scope);
      buzzState.dropFeeds();
      emitBuzzEvent({ type: "refresh", scope: buzz.scope });
      onPosted?.(buzz);
      if (notice.status !== "held") buzzState.toast(BUZZ_COMPOSER_COPY.posted(buzz.scope, buzz.alias.label), { tone: "success", duration: 4500 });
      moderation.showNotice(notice, { onSupportClosed: onDone });
    } catch (e) {
      if (!moderation.handleWriteError(e, { onEdit })) buzzState.toast(buzzErrorMessage(e), { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  /**
   * The draft as an answer in the prompt's thread on its feed (made by the first answer): a reply through the same
   * moderated API. `onAnswered` then opens the thread at it, once any support sheet is closed. A prompt that has
   * ended (the day moved on) asks for today's.
   */
  const answerInPromptThread = async (onAnswered?: (threadId: string, replyId: string) => void) => {
    if (sending) return;
    const d = getBuzzState().draft;
    const text = d.text.trim();
    if (!d.promptId || !text) return;
    setSending(true);
    try {
      const threadId = await getBuzzPromptThread(supabase, d.promptId, d.scope);
      const res = await createBuzzReply(await buzzWriteTarget(), threadId, { text });
      const { moderation: notice, ...reply } = res;
      putBuzzItems([{ ...reply, treeParentId: threadId }]);
      hapticSuccess();
      // Photos picked for a buzz of its own, then left for the thread: not left on the server.
      for (const p of d.images) void deleteImageByUrl(supabase, p.url).catch(() => {});
      buzzState.clearDraft();
      buzzState.setScope(d.scope);
      // The prompt card's thread and count, and the thread itself, from the server again.
      buzzState.dropMeta(d.scope);
      emitBuzzEvent({ type: "thread", threadId });
      emitBuzzEvent({ type: "refresh", scope: d.scope });
      if (notice.status !== "held") buzzState.toast(BUZZ_PROMPT_COPY.answered, { tone: "success" });
      moderation.showNotice(notice, {
        onSupportClosed: () => {
          onDone?.();
          onAnswered?.(threadId, reply.id);
        },
      });
    } catch (e) {
      if (isBuzzError(e, "prompt_ended")) {
        buzzState.dropMeta(d.scope);
        buzzState.toast(BUZZ_PROMPT_COPY.ended, { tone: "error" });
      } else if (!moderation.handleWriteError(e, { onEdit })) buzzState.toast(buzzErrorMessage(e), { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  return { submit, answerInPromptThread, sending, moderation };
}
