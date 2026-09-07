import type { ReactNode } from "react";
import { MobileFilters } from "./mobile-filters";
import { RightRail } from "./right-rail";

/**
 * Facebook-style three-column page: filters on the left, posts in the centre,
 * notifications and chats on the right. Phones get one column with a
 * "Filters" button; tablets get filters + feed; wide screens get all three.
 */
export function FeedLayout({ filters, children, header }: { filters: ReactNode; children: ReactNode; header?: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <aside className="hidden md:block">
        <div className="sticky top-[4.5rem] flex max-h-[calc(100vh-5rem)] flex-col gap-3 overflow-y-auto pb-4">{filters}</div>
      </aside>
      <div className="flex min-w-0 flex-col gap-4">
        {header}
        <div className="md:hidden">
          <MobileFilters>{filters}</MobileFilters>
        </div>
        <div className="mx-auto w-full max-w-[760px]">{children}</div>
      </div>
      <aside className="hidden xl:block">
        <div className="sticky top-[4.5rem] flex max-h-[calc(100vh-5rem)] flex-col gap-3 overflow-y-auto pb-4">
          <RightRail />
        </div>
      </aside>
    </div>
  );
}
