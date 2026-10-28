"use client";

/**
 * BuzzCard — the feed card (UniVerse design §7.2): a Phosphor surface-1 card, the alias header, its category, title + text
 * (6-line clamp), media, poll, support link, then the vote pill, the reply count and share. Community-collapsed
 * cards fold to one line. Own held / hidden / removed cards carry their status chip. Never an avatar, never a handle.
 */
import type { Buzz } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { BuzzContent, BuzzMediaView } from "./body";
import { AliasLine, CategoryTag, CollapsedFold, ContentStatusChip, ItemMenu, PollView, ReplyCountLink, ShareButton, SupportLink, VoteCluster } from "./parts";
import { removeBuzzItem } from "./query";
import { Badge, Skeleton, SkeletonText } from "./ui";

export function BuzzCard({ buzz, linkToThread = true, className }: { buzz: Buzz; linkToThread?: boolean; className?: string }) {
  const body = (
    <article className={cn("flex flex-col gap-3 rounded-[20px] border border-incog-line bg-incog-surface-1 p-4", className)} aria-label="Buzz" data-testid="buzz-card">
      <AliasLine
        alias={buzz.alias}
        isMine={buzz.isMine}
        createdAt={buzz.createdAt}
        trailing={
          <div className="flex shrink-0 items-center gap-1">
            {buzz.campusShortName ? <Badge>{buzz.campusShortName}</Badge> : null}
            {buzz.isMine ? <ContentStatusChip status={buzz.status} /> : null}
            <ItemMenu item={buzz} onHidden={() => removeBuzzItem(buzz.id)} className="-mr-2" />
          </div>
        }
      />
      <CategoryTag category={buzz.category} />
      <BuzzContent buzz={buzz} clamp={linkToThread} href={linkToThread ? `/buzz/${buzz.threadId}` : undefined} />
      <BuzzMediaView media={buzz.media} />
      {buzz.poll ? <PollView threadId={buzz.threadId} poll={buzz.poll} isMine={buzz.isMine} disabled={buzz.status !== "active"} /> : null}
      {buzz.supportLink ? <SupportLink /> : null}
      <footer className="flex items-center gap-1">
        <VoteCluster item={buzz} />
        <ReplyCountLink threadId={buzz.threadId} count={buzz.replyCount} />
        <span className="flex-1" />
        <ShareButton item={buzz} />
      </footer>
    </article>
  );
  if (buzz.collapsed && !buzz.isMine) {
    return (
      <div className={cn("rounded-[20px] border border-incog-line bg-incog-surface-1 p-2", className)} data-testid="buzz-card-folded">
        <CollapsedFold id={buzz.id} reason="community">
          {body}
        </CollapsedFold>
      </div>
    );
  }
  return body;
}

export function BuzzCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-[20px] border border-incog-line bg-incog-surface-1 p-4", className)} aria-hidden="true">
      <div className="flex items-center gap-2">
        <Skeleton w={28} h={28} circle />
        <Skeleton w={110} h={14} />
        <Skeleton w={28} h={12} />
      </div>
      <SkeletonText lines={3} />
      <div className="flex items-center gap-2">
        <Skeleton w={104} h={36} className="rounded-full" />
        <Skeleton w={64} h={20} />
      </div>
    </div>
  );
}
