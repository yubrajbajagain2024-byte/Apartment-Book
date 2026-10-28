"use client";

/**
 * /buzz/[id] (UniVerse's `ThreadPage`): header "Thread" + the root's overflow menu; the root large, without card
 * chrome; replies on two visual levels (depth 2 under a 2px rail; deeper ones arrive flattened with "↳ replying to"),
 * folds for collapsed / hidden-anon replies, placeholders, more replies as you scroll; the bottom reply bar with the
 * inline "You're anonymous" pill, the "replying to {alias} ×" chip, a 500-character box and send; locked / closed
 * footers. No realtime on Buzz (publication is jittered): the thread polls every 30 s and refreshes on focus.
 */
import { useMemo, useRef, useState } from "react";
import { CornerDownRight, Lock, MessageCircle, SearchX, SendHorizontal, X } from "lucide-react";
import {
  BUZZ_LIMITS,
  BUZZ_REPLY_COPY,
  buildBuzzReplyTree,
  buzzErrorMessage,
  isBuzzError,
  type BuzzReply,
} from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { buzzApi } from "./api";
import { BuzzContent, BuzzMediaView } from "./body";
import { ComposerGuard, ComposerModeBanner } from "./composer";
import { loadMoreReplies, refreshThread, useBuzzThread, useMoreRepliesState } from "./data";
import { BuzzPageFooter, BuzzPageHeader, PAGE_FRAME, TabBarSpacer, useBuzzBack } from "./frame";
import { BuzzGatePanel, BuzzGateSkeleton, BuzzSignInPanel, useBuzzGate } from "./gate";
import { handleBuzzWriteError, showModerationNotice } from "./moderation";
import { AliasLine, BuzzText, CategoryTag, CollapsedFold, ContentStatusChip, ItemMenu, PollView, ShareButton, SupportLink, VoteCluster } from "./parts";
import { buzzKeys, invalidateQueries, patchBuzzItem, setQueryData, type ThreadData } from "./query";
import { buzzActions, useBuzzUi } from "./store";
import { BuzzSurface } from "./surface";
import { toast } from "./toast";
import { AutoTextarea, Badge, ButtonLink, EmptyState, ErrorState, IconButton, InfiniteSentinel, Skeleton, SkeletonText, T } from "./ui";

const FEED = "/?tab=buzz";

export function BuzzThreadScreen({ threadId, userId, fixtures }: { threadId: string; userId: string | null; fixtures?: string | null }) {
  return (
    <BuzzSurface userId={userId} fixtures={fixtures} className={PAGE_FRAME} fallback={<BuzzGateSkeleton className="mt-16" />}>
      <ThreadBody threadId={threadId} />
    </BuzzSurface>
  );
}

function ThreadBody({ threadId }: { threadId: string }) {
  const gate = useBuzzGate();
  const back = useBuzzBack(FEED);
  if (gate.signedIn && gate.accepted) return <ThreadView threadId={threadId} onBack={back} />;
  return (
    <>
      <BuzzPageHeader title="Thread" onBack={back} />
      {!gate.signedIn ? (
        <BuzzSignInPanel next={`/buzz/${threadId}`} className="pt-4" />
      ) : gate.isLoading ? (
        <BuzzGateSkeleton className="mt-4" />
      ) : gate.isError ? (
        <ErrorState title="Buzz didn't load. That's on us." error={gate.error} onRetry={() => void gate.retry()} />
      ) : (
        <BuzzGatePanel variant="page" onDismiss={back} className="pt-4" />
      )}
      <TabBarSpacer />
    </>
  );
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack(): void }) {
  const thread = useBuzzThread(threadId, true);
  const more = useMoreRepliesState(threadId);
  const draft = useBuzzUi((s) => s.replyDrafts[threadId]) ?? { text: "", parentId: null };
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);

  const root = thread.data?.root;
  const replies = useMemo(() => thread.data?.replies ?? [], [thread.data]);
  const tree = useMemo(() => buildBuzzReplyTree(threadId, replies), [threadId, replies]);
  const replyingTo = draft.parentId ? (replies.find((r) => r.id === draft.parentId) ?? null) : null;
  const locked = root?.locked === true || (root !== undefined && root.status !== "active");

  const focusComposer = (parentId: string | null) => {
    buzzActions.setReplyDraft(threadId, { text: draft.text, parentId });
    textRef.current?.focus();
  };

  const send = async () => {
    const text = draft.text.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await buzzApi.reply(threadId, { text, ...(draft.parentId ? { parentId: draft.parentId } : {}) });
      showModerationNotice(res.moderation);
      buzzActions.setReplyDraft(threadId, null);
      if (res.moderation.status !== "held") toast.success(BUZZ_REPLY_COPY.replied(res.alias.label));
      // Yours shows straight away (authors always see their own rows); the refresh puts it in its place.
      setQueryData<ThreadData>(buzzKeys.thread(threadId), (t) => (t && !t.replies.some((r) => r.id === res.id) ? { ...t, replies: [...t.replies, res] } : t));
      patchBuzzItem(threadId, (it) => (it.kind === "buzz" ? { ...it, replyCount: it.replyCount + 1 } : it));
      void refreshThread(threadId);
      invalidateQueries(buzzKeys.mine);
    } catch (e) {
      if (isBuzzError(e, "locked")) toast.error(BUZZ_REPLY_COPY.locked);
      else if (!handleBuzzWriteError(e, { onEdit: () => textRef.current?.focus() })) toast.error(buzzErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <BuzzPageHeader title="Thread" onBack={onBack} actions={root ? <ItemMenu item={root} onHidden={onBack} onDeleted={onBack} /> : undefined} />
      <div className="flex flex-1 flex-col" data-testid="buzz-thread">
        {thread.isLoading ? (
          <div className="flex flex-col gap-4 px-4 pt-3" aria-busy="true">
            <div className="flex items-center gap-2">
              <Skeleton w={36} h={36} circle />
              <Skeleton w={120} h={14} />
            </div>
            <SkeletonText lines={4} />
            <Skeleton w={104} h={36} className="rounded-full" />
          </div>
        ) : thread.isError ? (
          isBuzzError(thread.error, "not_found") ? (
            <EmptyState icon={SearchX} title="That buzz isn't available." description="It may have been deleted, or it's no longer there for you." compact className="pt-10" />
          ) : (
            <ErrorState title="Buzz didn't load. That's on us." error={thread.error} onRetry={() => void thread.refetch()} className="px-4 pt-6" />
          )
        ) : root ? (
          <>
            <article className="flex flex-col gap-3 px-4 pt-3 pb-4" aria-label="Buzz" data-testid="buzz-thread-root">
              <AliasLine
                alias={root.alias}
                isMine={root.isMine}
                createdAt={root.createdAt}
                size="md"
                trailing={root.isMine ? <ContentStatusChip status={root.status} /> : root.campusShortName ? <Badge>{root.campusShortName}</Badge> : null}
              />
              <CategoryTag category={root.category} />
              {root.collapsed && !root.isMine ? (
                <CollapsedFold id={root.id} reason="community">
                  <BuzzContent buzz={root} large />
                  <BuzzMediaView media={root.media} className="mt-3" />
                </CollapsedFold>
              ) : (
                <>
                  <BuzzContent buzz={root} large />
                  <BuzzMediaView media={root.media} />
                </>
              )}
              {root.poll ? <PollView threadId={root.id} poll={root.poll} isMine={root.isMine} disabled={root.status !== "active"} /> : null}
              {root.supportLink ? <SupportLink /> : null}
              <footer className="flex items-center gap-1">
                <VoteCluster item={root} size="md" />
                <span className={cn("ml-2 inline-flex items-center gap-1 text-incog-ink-3", T.footnote)}>
                  <MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="tabular-nums">{root.replyCount}</span>
                  <span className="sr-only">{root.replyCount === 1 ? "reply" : "replies"}</span>
                </span>
                <span className="flex-1" />
                <ShareButton item={root} />
              </footer>
            </article>
            <div className="h-px bg-incog-line-subtle" aria-hidden="true" />
            {tree.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title={BUZZ_REPLY_COPY.emptyTitle}
                description={BUZZ_REPLY_COPY.emptyBody}
                action={!locked ? { label: BUZZ_REPLY_COPY.emptyAction, onClick: () => focusComposer(null) } : undefined}
                compact
                className="pt-6"
              />
            ) : (
              <ol className="flex flex-col px-4 pt-2 pb-2" aria-label="Replies">
                {tree.map((node) => (
                  <li key={node.reply.id} className="py-2">
                    <ReplyItem reply={node.reply} onReply={locked ? undefined : () => focusComposer(node.reply.id)} />
                    {node.children.length > 0 ? (
                      <ol className="mt-2 ml-4 flex flex-col border-l-2 border-incog-line pl-3" aria-label="Replies to this reply">
                        {node.children.map((child) => (
                          <li key={child.id} className="py-2">
                            <ReplyItem reply={child} onReply={locked ? undefined : () => focusComposer(child.id)} />
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                ))}
                <InfiniteSentinel
                  onReach={() => loadMoreReplies(threadId)}
                  hasMore={thread.data?.nextOffset != null}
                  isFetching={more.loading}
                  error={more.error ?? undefined}
                  onRetry={() => loadMoreReplies(threadId)}
                  endLabel={null}
                  skeleton={<SkeletonText lines={2} className="py-2" />}
                />
              </ol>
            )}
          </>
        ) : null}
      </div>

      {root && !locked ? (
        <BuzzPageFooter>
          <ComposerGuard className="mx-4 my-2">
            <div className="flex flex-col gap-2 px-4 py-2" data-testid="buzz-reply-bar">
              <div className="flex min-w-0 items-center gap-2">
                <ComposerModeBanner inline />
                {replyingTo ? (
                  <span className={cn("flex min-w-0 items-center gap-1 rounded-full bg-incog-surface-2 px-2 py-1 text-incog-ink-2", T.caption)} data-testid="buzz-replying-to">
                    <CornerDownRight size={12} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{replyingTo.alias.label}</span>
                    <button
                      type="button"
                      aria-label="Reply to the buzz instead"
                      onClick={() => buzzActions.setReplyDraft(threadId, { text: draft.text, parentId: null })}
                      className="relative ml-0.5 shrink-0 text-incog-ink-3 before:absolute before:-inset-2 hover:text-incog-ink"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 rounded-[20px] bg-incog-surface-2 px-3 py-2">
                  <AutoTextarea
                    ref={textRef}
                    aria-label="Reply anonymously"
                    placeholder={BUZZ_REPLY_COPY.placeholder}
                    value={draft.text}
                    minRows={1}
                    maxRows={5}
                    maxLength={BUZZ_LIMITS.replyText}
                    showCount={draft.text.length > BUZZ_LIMITS.replyText - 60}
                    onChange={(e) => buzzActions.setReplyDraft(threadId, { text: e.target.value, parentId: draft.parentId })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                    }}
                    className={T.bodyLg}
                    data-testid="buzz-reply-input"
                  />
                </div>
                <IconButton icon={SendHorizontal} aria-label="Send reply" variant="accent" disabled={!draft.text.trim() || sending} onClick={() => void send()} data-testid="buzz-reply-send" />
              </div>
            </div>
          </ComposerGuard>
        </BuzzPageFooter>
      ) : root && locked ? (
        <BuzzPageFooter>
          <div className={cn("flex min-h-12 items-center gap-2 px-4 text-incog-ink-3", T.footnote)}>
            <Lock size={14} aria-hidden="true" />
            {root.locked ? BUZZ_REPLY_COPY.locked : BUZZ_REPLY_COPY.closed}
          </div>
        </BuzzPageFooter>
      ) : thread.isError ? (
        <div className="px-4 pb-6">
          <ButtonLink href={FEED} variant="secondary" fullWidth>
            Back to Buzz
          </ButtonLink>
        </div>
      ) : null}
      <TabBarSpacer />
    </>
  );
}

function ReplyItem({ reply, onReply }: { reply: BuzzReply; onReply?(): void }) {
  const body = (
    <div className="flex flex-col gap-2" data-testid="buzz-reply">
      <AliasLine
        alias={reply.alias}
        isMine={reply.isMine}
        isOp={reply.isOp}
        createdAt={reply.createdAt}
        trailing={
          <div className="flex shrink-0 items-center">
            {reply.isMine ? <ContentStatusChip status={reply.status} className="mr-1" /> : null}
            <ItemMenu item={reply} className="-mr-2" />
          </div>
        }
      />
      {reply.replyingTo ? (
        <span className={cn("inline-flex items-center gap-1 text-incog-ink-3", T.caption)}>
          <CornerDownRight size={12} aria-hidden="true" />
          replying to {reply.replyingTo.emoji} {reply.replyingTo.label}
        </span>
      ) : null}
      <BuzzText text={reply.text} status={reply.status} />
      {reply.supportLink ? <SupportLink /> : null}
      <div className="flex items-center gap-1">
        <VoteCluster item={reply} />
        {onReply && reply.status === "active" ? (
          <button type="button" onClick={onReply} className={cn("ml-1 inline-flex min-h-9 items-center rounded-full px-2 text-incog-ink-2 transition-colors hover:bg-incog-surface-2", T.labelSm)} data-testid="buzz-reply-to">
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
  if (reply.collapsed && !reply.isMine) {
    return (
      <CollapsedFold id={reply.id} reason={reply.score <= -5 ? "community" : "anon"}>
        {body}
      </CollapsedFold>
    );
  }
  return <div className={cn(reply.status === "deleted" && "opacity-70")}>{body}</div>;
}
