import { compactCount } from "./format";
import type { ProfileTile } from "./types/models";

/**
 * Discover's page sizes. The grid's tiles come in pairs of blocks (a feature block of five, then a row of three: see
 * discoverMosaic), so a page of 24 is three whole pairs and the blocks already on screen never reflow when the next
 * page arrives.
 */
export const DISCOVER_PAGE = { tiles: 24, accounts: 12, topics: 12, searchTopics: 10, searchPeople: 30 } as const;

/** The longest tag the apps colour (captionParts) and the database stores (extract_hashtags, migration 44). */
export const TOPIC_MAX_LENGTH = 60;

/**
 * A topic as the database stores it: what was typed or tapped, without its "#" and lowercased, or null when that
 * leaves no tag (letters, digits and "_" only, at most 60, as captionParts reads a caption).
 */
export function normalizeTopic(input: string): string | null {
  const tag = input.trim().replace(/^#+/, "").toLowerCase();
  return new RegExp(`^[\\p{L}\\p{M}\\p{N}_]{1,${TOPIC_MAX_LENGTH}}$`, "u").test(tag) ? tag : null;
}

/** "#finals". */
export function topicLabel(tag: string): string {
  return `#${tag}`;
}

/** "1 post", "1.2k posts". */
export function topicCount(posts: number): string {
  return posts === 1 ? "1 post" : `${compactCount(posts)} posts`;
}

/**
 * One block of Discover's grid, as Instagram's Explore lays it out: a feature block is one tall tile (two rows high,
 * the first video among its five, else its first tile) beside four squares, the tall side alternating left and right
 * down the grid; a row is three squares (the last row may be shorter).
 */
export type DiscoverBlock =
  | { kind: "feature"; key: string; side: "left" | "right"; tall: ProfileTile; squares: ProfileTile[] }
  | { kind: "row"; key: string; tiles: ProfileTile[] };

/**
 * Lays ranked tiles out in blocks, keeping their order as far as the shape allows: feature block, row, feature block
 * (tall on the other side), row, and so on; once fewer than five tiles are left they go in rows. The same tiles always
 * give the same blocks, so appending a page only adds blocks at the end.
 */
export function discoverMosaic(tiles: readonly ProfileTile[]): DiscoverBlock[] {
  const blocks: DiscoverBlock[] = [];
  let i = 0;
  let features = 0;
  while (i < tiles.length) {
    const featureTurn = blocks.length % 2 === 0;
    if (featureTurn && tiles.length - i >= 5) {
      const five = tiles.slice(i, i + 5);
      const tallAt = Math.max(0, five.findIndex((t) => t.isVideo));
      const tall = five[tallAt]!;
      blocks.push({ kind: "feature", key: `f:${tall.key}`, side: features % 2 === 0 ? "left" : "right", tall, squares: five.filter((_, k) => k !== tallAt) });
      features += 1;
      i += 5;
    } else {
      const row = tiles.slice(i, i + 3);
      blocks.push({ kind: "row", key: `r:${row[0]!.key}`, tiles: row });
      i += row.length;
    }
  }
  return blocks;
}
