"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Once the list is on screen, its notifications count as seen: the action marks them, the bell clears. */
export function MarkSeen({ action }: { action: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    void action().then(() => router.refresh());
  }, [action, router]);
  return null;
}
