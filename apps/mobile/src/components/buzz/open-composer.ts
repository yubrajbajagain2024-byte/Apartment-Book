import type { useRouter } from "expo-router";
import { buzzState } from "@/lib/buzz-store";
import { openHomeSection } from "@/lib/home-section";

type Router = ReturnType<typeof useRouter>;

/**
 * Opens the Buzz composer from outside Buzz (the create menu's "Buzz (anonymous)", an old /create/buzz link): Home
 * moves to its Buzz page and the composer rises over the feed there, after the guidelines gate if it still has to be
 * accepted, as on UniVerse, where the composer lives in the Buzz pane. `fromStack`: called from a screen pushed over the
 * tabs, which goes back to them first.
 */
export function openBuzzComposerFromAnywhere(router: Router, opts: { promptId?: string | null; fromStack?: boolean } = {}) {
  buzzState.requestComposer({ promptId: opts.promptId ?? null });
  openHomeSection("buzz");
  if (opts.fromStack) {
    router.dismissTo("/");
    setTimeout(() => router.navigate("/"), 0);
  } else router.navigate("/");
}
