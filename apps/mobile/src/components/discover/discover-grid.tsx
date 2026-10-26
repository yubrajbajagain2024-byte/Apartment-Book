import { memo } from "react";
import { StyleSheet, View } from "react-native";
import type { DiscoverBlock, ProfileTile } from "@apartment-book/shared";
import { ProfileGridTile, TILE_ASPECT } from "@/components/profile/profile-tile";
import type { ViewerOrigin } from "@/lib/reel-viewer";

/** Between tiles, across and down, and the grid's side margins: the profile grid's. */
export const DISCOVER_GAP = 6;
export const DISCOVER_INSET = 8;

/** A square's width in a grid `width` wide: three across. */
export function discoverTileWidth(width: number): number {
  return (width - DISCOVER_INSET * 2 - DISCOVER_GAP * 2) / 3;
}

/** Tiles in rows of three, for grids without feature blocks (search results, a topic page). */
export function rowsOf(tiles: readonly ProfileTile[]): DiscoverBlock[] {
  const rows: DiscoverBlock[] = [];
  for (let i = 0; i < tiles.length; i += 3) rows.push({ kind: "row", key: `r:${tiles[i]!.key}`, tiles: tiles.slice(i, i + 3) });
  return rows;
}

/**
 * One block of Discover's grid (discoverMosaic): a feature block's tall tile is as high as two squares and the gap
 * between them, beside a 2x2 of squares; a row is three squares, starting at the left when it is the last, short one.
 * The squares are the profile grid's own, so a tap opens the viewer the same way.
 */
export const DiscoverBlockView = memo(function DiscoverBlockView({ block, tileWidth, onOpen }: { block: DiscoverBlock; tileWidth: number; onOpen: (tile: ProfileTile, origin?: ViewerOrigin) => void }) {
  const square = (t: ProfileTile) => <ProfileGridTile key={t.key} tile={t} width={tileWidth} aspect={TILE_ASPECT} onOpen={onOpen} />;
  if (block.kind === "row") return <View style={styles.row}>{block.tiles.map(square)}</View>;
  const tallAspect = (tileWidth * TILE_ASPECT * 2 + DISCOVER_GAP) / tileWidth;
  const tall = <ProfileGridTile key={block.tall.key} tile={block.tall} width={tileWidth} aspect={tallAspect} onOpen={onOpen} />;
  const quad = (
    <View key="quad" style={[styles.quad, { width: tileWidth * 2 + DISCOVER_GAP }]}>
      {block.squares.map(square)}
    </View>
  );
  return <View style={styles.row}>{block.side === "left" ? [tall, quad] : [quad, tall]}</View>;
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: DISCOVER_GAP, paddingHorizontal: DISCOVER_INSET },
  quad: { flexDirection: "row", flexWrap: "wrap", gap: DISCOVER_GAP },
});
