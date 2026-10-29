"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Two-pane Messenger layout: list on the left, chat on the right (one pane at a time on phones). It fills the window
 * under the site's header and keeps clear of the phone's tab bar; `className` moves its edges (the business portal's
 * sidebar), and `bottomBar={false}` drops the room for a tab bar where there is none.
 */
export function MessagesShell({ list, children, className, bottomBar = true }: { list: ReactNode; children: ReactNode; className?: string; bottomBar?: boolean }) {
  const segment = useSelectedLayoutSegment();
  const paneOpen = segment !== null;
  const inChat = paneOpen && segment !== "new";

  return (
    <div className={cn("fixed inset-x-0 bottom-0 top-14 flex bg-white md:top-14", bottomBar && !inChat && "pb-[calc(3.25rem+env(safe-area-inset-bottom))] md:pb-0", className)}>
      <aside className={cn("w-full shrink-0 border-r border-gray-200 md:block md:w-80 lg:w-96", paneOpen && "hidden")}>{list}</aside>
      <section className={cn("min-w-0 flex-1 flex-col md:flex", paneOpen ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
