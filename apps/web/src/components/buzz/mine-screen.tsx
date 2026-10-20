"use client";

/**
 * /buzz/mine — "My buzzes" (UniVerse's `MinePage`): the private list of your own threads and replies, served only to
 * you, with your private karma. Linked from Settings → Privacy & safety, never from Home.
 */
import { useState } from "react";
import Link from "next/link";
import { VenetianMask } from "lucide-react";
import { BUZZ_MINE_COPY, type BuzzReply, type MyBuzzItem, type MyBuzzKind } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { BuzzCard, BuzzCardSkeleton } from "./buzz-card";
import { BuzzComposer } from "./composer";
import { useBuzzKarma, useMyBuzz } from "./data";
import { BuzzPageHeader, PAGE_FRAME, TabBarSpacer, useBuzzBack } from "./frame";
import { BuzzGatePanel, BuzzGateSkeleton, BuzzSignInPanel, useBuzzGate } from "./gate";
import { AliasLine, BuzzText, ContentStatusChip, VoteCluster } from "./parts";
import { buzzActions } from "./store";
import { BuzzSurface } from "./surface";
import { EmptyState, ErrorState, InfiniteSentinel, T, Tabs } from "./ui";

const SETTINGS = "/settings/profile";

export function BuzzMineScreen({ userId, fixtures }: { userId: string | null; fixtures?: string | null }) {
  return (
    <BuzzSurface userId={userId} fixtures={fixtures} className={PAGE_FRAME} fallback={<BuzzGateSkeleton className="mt-16" />}>
      <MineBody />
    </BuzzSurface>
  );
}

function MineBody() {
  const gate = useBuzzGate();
  const back = useBuzzBack(SETTINGS);
  if (gate.signedIn && gate.accepted) return <MineView onBack={back} />;
  return (
    <>
      <BuzzPageHeader title={BUZZ_MINE_COPY.title} onBack={back} />
      {!gate.signedIn ? (
        <BuzzSignInPanel next="/buzz/mine" className="pt-4" />
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

const TABS: readonly { value: MyBuzzKind; label: string }[] = [
  { value: "threads", label: "Threads" },
  { value: "replies", label: "Replies" },
];

function MineView({ onBack }: { onBack(): void }) {
  const [kind, setKind] = useState<MyBuzzKind>("threads");
  const list = useMyBuzz(kind, true);
  const karma = useBuzzKarma(true);
  return (
    <>
      <BuzzPageHeader
        title={BUZZ_MINE_COPY.title}
        subtitle={karma.data !== undefined ? BUZZ_MINE_COPY.karma(karma.data) : BUZZ_MINE_COPY.private}
        onBack={onBack}
        below={<Tabs<MyBuzzKind> aria-label={BUZZ_MINE_COPY.title} value={kind} onChange={setKind} tabs={TABS} className="-mx-4 -mb-3" />}
      />
      <div className="flex flex-1 flex-col" data-testid="buzz-mine">
        <p className={cn("px-4 pt-3 pb-2 text-incog-ink-3", T.caption)}>
          <VenetianMask size={12} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />
          {BUZZ_MINE_COPY.privateNote}
        </p>
        {list.isLoading ? (
          <div className="flex flex-col gap-3 px-4" aria-busy="true">
            <BuzzCardSkeleton />
            <BuzzCardSkeleton />
          </div>
        ) : list.isError ? (
          <ErrorState title="Buzz didn't load. That's on us." error={list.error} onRetry={() => void list.refetch()} className="px-4" />
        ) : list.items.length === 0 ? (
          <EmptyState icon={VenetianMask} title={BUZZ_MINE_COPY.emptyTitle} description={BUZZ_MINE_COPY.private} action={{ label: BUZZ_MINE_COPY.emptyAction, onClick: () => buzzActions.openComposer() }} compact className="pt-4" />
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {list.items.map((m: MyBuzzItem) => (m.item.kind === "buzz" ? <BuzzCard key={m.item.id} buzz={m.item} /> : <MyReplyCard key={m.item.id} reply={m.item} snippet={m.threadSnippet} />))}
            <InfiniteSentinel
              onReach={list.fetchNextPage}
              hasMore={list.hasNextPage}
              isFetching={list.isFetchingNextPage}
              error={list.nextError}
              onRetry={list.fetchNextPage}
              skeleton={<BuzzCardSkeleton />}
              endLabel={BUZZ_MINE_COPY.end}
            />
          </div>
        )}
      </div>
      <BuzzComposer />
      <TabBarSpacer />
    </>
  );
}

function MyReplyCard({ reply, snippet }: { reply: BuzzReply; snippet: string }) {
  return (
    <article className="flex flex-col gap-3 rounded-[20px] border border-incog-line bg-incog-surface-1 p-4" aria-label="Your reply" data-testid="buzz-my-reply">
      <Link href={`/buzz/${reply.threadId}`} className="flex flex-col gap-1 rounded-[6px] text-left">
        <span className={cn("text-incog-ink-3", T.caption)}>{BUZZ_MINE_COPY.replyingIn}</span>
        <span className={cn("line-clamp-2 text-incog-ink-2", T.footnote)}>{snippet || BUZZ_MINE_COPY.threadUnavailable}</span>
      </Link>
      <AliasLine alias={reply.alias} isMine={reply.isMine} isOp={reply.isOp} createdAt={reply.createdAt} trailing={<ContentStatusChip status={reply.status} />} />
      <BuzzText text={reply.text} status={reply.status} clamp />
      <footer className="flex items-center">
        <VoteCluster item={reply} />
      </footer>
    </article>
  );
}
