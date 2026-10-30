"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Coming back to a portal tab that sat in the background for a while re-reads the page from the server, quietly (the
 * page stays as it is until the fresh one is in; nothing typed is lost). The numbers and lists are then as the
 * database has them, without anyone pressing reload. Short absences change nothing.
 */
export function RefreshOnReturn({ afterMs = 60_000 }: { afterMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > afterMs) router.refresh();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [afterMs, router]);
  return null;
}
