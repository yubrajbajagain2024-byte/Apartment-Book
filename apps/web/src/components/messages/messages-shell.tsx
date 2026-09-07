"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

/** Two-pane Messenger layout: list on the left, chat on the right (one pane at a time on phones). */
export function MessagesShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const paneOpen = segment !== null;
  const inChat = paneOpen && segment !== "new";

  return (
    <div className={cn("fixed inset-x-0 bottom-0 top-14 flex bg-white md:top-14", !inChat && "pb-[calc(3.25rem+env(safe-area-inset-bottom))] md:pb-0")}>
      <aside className={cn("w-full shrink-0 border-r border-gray-200 md:block md:w-80 lg:w-96", paneOpen && "hidden")}>{list}</aside>
      <section className={cn("min-w-0 flex-1 flex-col md:flex", paneOpen ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
