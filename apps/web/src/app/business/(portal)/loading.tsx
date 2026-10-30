import { Skeleton } from "@/components/business/ui";

/**
 * While a portal page loads: its shape, shimmering in the portal's greys. It stays invisible for the first 160 ms
 * (biz-loading in globals.css), so a page that is ready sooner, as a prefetched or a warm one is, never flashes a
 * skeleton; only a page that genuinely takes a moment shows one, and then without a jump.
 */
export default function PortalLoading() {
  return (
    <div className="biz-loading flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-[22px]" />
    </div>
  );
}
