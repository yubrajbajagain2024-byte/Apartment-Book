import { Skeleton } from "@/components/business/ui";

/**
 * While a chat opens: the shape of its header and composer in the chat pane, the list beside it untouched. Invisible
 * for the first 160 ms (biz-loading), so a chat that opens at once shows no skeleton. With this boundary a chat's link
 * is prefetched up to here as it comes into view, and tapping it changes the pane at once.
 */
export default function InquiryLoading() {
  return (
    <div className="biz-loading flex flex-1 flex-col" aria-busy="true" aria-label="Loading">
      <div className="flex h-14 items-center gap-3 border-b border-biz-line px-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
      <div className="flex-1" />
      <div className="border-t border-biz-line px-4 py-3">
        <Skeleton className="h-10 w-full rounded-2xl" />
      </div>
    </div>
  );
}
