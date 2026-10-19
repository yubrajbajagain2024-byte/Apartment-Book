import { createContext } from "react";
import type { DerivedValue } from "react-native-reanimated";

/**
 * How much of the viewer's chrome shows (0 to 1): the words, the rail, the dots and the controls over each page. The
 * viewer fades them in once a page has zoomed open to the full screen, out as it zooms closed, and away as a page is
 * pulled back with a swipe, so they never squeeze through the opening. Elsewhere (the Reels tab) there is none, and they
 * simply show.
 */
export const ViewerChromeContext = createContext<DerivedValue<number> | null>(null);

/**
 * Where each page's videos have got to, for the viewer to hand back to the feed as it closes (so the row's own player
 * goes on from there). A page's video registers how to read its position (`read`), and takes it back (null) as it goes.
 */
export type ViewerClocks = { set: (key: string, slide: number, read: (() => number) | null) => void };
export const ViewerClockContext = createContext<ViewerClocks | null>(null);
