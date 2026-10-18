import { cn } from "@/lib/utils";

/*
 * What a page looks like while the server renders it: shimmering blocks in the shape of the content that is coming,
 * rather than a spinner. The Explore list pages, the listing detail pages, a form page and a chat each have one.
 */

function Block({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ab-skeleton rounded-[6px]", className)} />;
}

/** The sticky Room | Roommate | Marketplace bar, so nothing jumps when the real one arrives. */
function TabsBar() {
  return (
    <div className="-mx-3 flex h-11 items-center justify-center gap-7 border-b border-gray-200 bg-white sm:mx-0 sm:w-full sm:max-w-[500px] sm:self-center sm:rounded-[14px] sm:border-b-0 sm:ring-1 sm:ring-gray-200">
      <Block className="h-3.5 w-14" />
      <Block className="h-3.5 w-20" />
      <Block className="h-3.5 w-24" />
    </div>
  );
}

function ListingCard({ aspect, lines = 3 }: { aspect: string; lines?: number }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-white ring-1 ring-gray-200">
      <Block className={cn("w-full rounded-none", aspect)} />
      <div className="flex flex-col gap-2.5 p-4">
        <Block className="h-5 w-1/3" />
        {lines > 1 ? <Block className="h-3.5 w-4/5" /> : null}
        {lines > 2 ? <Block className="h-3 w-1/2" /> : null}
      </div>
    </div>
  );
}

/** An Explore list page: tabs, a title, the filter bar, then cards in the section's own grid. */
export function ExploreListSkeleton({ layout }: { layout: "apartments" | "roommates" | "marketplace" }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <TabsBar />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2.5">
          <Block className="h-7 w-64 sm:h-8 sm:w-80" />
          <Block className="h-3.5 w-44" />
        </div>
        <Block className="h-11 w-36 rounded-[10px]" />
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] bg-white p-4 ring-1 ring-gray-200">
        <Block className="h-11 min-w-40 flex-1 rounded-[10px]" />
        <Block className="h-11 w-48 rounded-[10px]" />
        <Block className="h-11 w-28 rounded-[10px]" />
        <Block className="h-11 w-32 rounded-[10px]" />
        <Block className="h-11 w-28 rounded-[10px]" />
      </div>
      {layout === "apartments" ? (
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <ListingCard key={i} aspect="aspect-[4/3]" />
          ))}
        </div>
      ) : layout === "roommates" ? (
        <div className="mx-auto flex w-full max-w-[500px] flex-col gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-[14px] bg-white p-4 ring-1 ring-gray-200">
              <div className="flex items-center gap-3">
                <Block className="h-10 w-10 rounded-full" />
                <div className="flex flex-col gap-2">
                  <Block className="h-4 w-32" />
                  <Block className="h-3 w-24" />
                </div>
              </div>
              <Block className="h-5 w-24 rounded-full" />
              <Block className="h-4 w-4/5" />
              <Block className="h-3.5 w-full" />
              <Block className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <ListingCard key={i} aspect="aspect-square" lines={3} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A listing's page: the photo, the title card, and the owner card at the side. */
export function ListingDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <Block className="h-4 w-36" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Block className="aspect-[4/3] w-full rounded-[14px] md:aspect-[16/10]" />
          <div className="flex flex-col gap-5 rounded-[14px] bg-white p-5 ring-1 ring-gray-200 sm:p-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-1 flex-col gap-2.5">
                <Block className="h-8 w-3/4" />
                <Block className="h-3.5 w-1/2" />
              </div>
              <Block className="h-8 w-24" />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-gray-200 ring-1 ring-gray-200 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="bg-white px-3.5 py-3">
                  <Block className="h-3.5 w-24" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-gray-100 pt-5">
              <Block className="h-3 w-28" />
              <Block className="h-3.5 w-full" />
              <Block className="h-3.5 w-full" />
              <Block className="h-3.5 w-2/3" />
            </div>
          </div>
        </div>
        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-[14px] bg-white p-5 ring-1 ring-gray-200">
            <div className="flex items-center gap-3">
              <Block className="h-14 w-14 rounded-full" />
              <div className="flex flex-col gap-2">
                <Block className="h-4 w-32" />
                <Block className="h-3 w-20" />
              </div>
            </div>
            <Block className="h-11 w-full rounded-[10px]" />
            <Block className="h-11 w-full rounded-[10px]" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A form page: the title and two cards of fields. */
export function FormPageSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" role="status" aria-label="Loading">
      <div className="flex flex-col gap-2.5">
        <Block className="h-8 w-64" />
        <Block className="h-3.5 w-80" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="rounded-[14px] bg-white ring-1 ring-gray-200">
          <div className="border-b border-gray-100 px-5 py-4">
            <Block className="h-6 w-32" />
          </div>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className={cn("flex flex-col gap-1.5", j === 0 && "sm:col-span-2")}>
                <Block className="h-3 w-20" />
                <Block className="h-11 w-full rounded-[10px]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chat: the header, a few bubbles on both sides, and the composer. */
export function ChatSkeleton() {
  const bubbles: { mine: boolean; width: string }[] = [
    { mine: false, width: "w-48" },
    { mine: false, width: "w-32" },
    { mine: true, width: "w-56" },
    { mine: false, width: "w-40" },
    { mine: true, width: "w-24" },
  ];
  return (
    <div className="flex flex-1 flex-col" role="status" aria-label="Loading">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-2 sm:px-4">
        <Block className="h-8 w-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Block className="h-3.5 w-32" />
          <Block className="h-2.5 w-20" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-2 px-3 py-4 sm:px-6">
        {bubbles.map((b, i) => (
          <div key={i} className={cn("flex items-end gap-2", b.mine && "flex-row-reverse")}>
            {!b.mine ? <Block className="h-8 w-8 rounded-full" /> : null}
            <Block className={cn("h-9 rounded-[18px]", b.width)} />
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-gray-200 px-3 py-3 sm:px-4">
        <Block className="h-10 w-10 rounded-full" />
        <Block className="h-10 flex-1 rounded-[20px]" />
        <Block className="h-10 w-10 rounded-full" />
      </div>
    </div>
  );
}
