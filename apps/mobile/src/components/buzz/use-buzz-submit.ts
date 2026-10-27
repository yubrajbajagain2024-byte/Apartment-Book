import { useState } from "react";
import { BUZZ_COMPOSER_COPY, BUZZ_LIMITS, buzzErrorMessage, createBuzzPost, type Buzz, type BuzzPostingStatus, type CreateBuzzRequest } from "@apartment-book/shared";
import { buzzWriteTarget } from "@/lib/buzz-actions";
import { buzzState, emitBuzzEvent, getBuzzState, putBuzzItems, type BuzzDraft } from "@/lib/buzz-store";
import { hapticSuccess } from "@/lib/haptics";
import { useBuzzModeration } from "./moderation";

/**
 * Whether a draft can be posted: words or a title within their limits, a complete poll (2–4 different options) and no
 * poll while polls are still locked for a new account. Shared by the Buzz page's composer and the camera's BUZZ mode.
 */
export function buzzDraftCheck(draft: BuzzDraft, posting: BuzzPostingStatus | null): { ready: boolean; pollsLocked: boolean } {
  const text = draft.text.trim();
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
    const d = getBuzzState().draft;
    const text = d.text.trim();
    const title = d.title.trim();
    const options = d.options.map((o) => o.trim());
    setSending(true);
    const body: CreateBuzzRequest = {
      text,
      scope: d.scope,
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

  return { submit, sending, moderation };
}
