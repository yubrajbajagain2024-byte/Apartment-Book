"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Building2, Copy, Eye, Pin, Play, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { compactCount, listProfileLiked, listProfilePostTiles, listProfileSaved, type ProfileTile, type ProfileTileType } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { TileImage } from "./tile-image";

/** Which list a grid pages through: someone's posts or reels (numbered pages), or what they saved or liked (a cursor). */
export type ProfileGridKind = "post" | "reel" | "saved" | "liked";

const TYPE_NAME: Record<ProfileTileType, string> = { post: "Post", reel: "Reel", apartment: "Apartment", roommate: "Roommate post", item: "Marketplace item" };
/** Saved and liked listings say what they are where a post shows its views. */
const LISTING_BADGE: Partial<Record<ProfileTileType, { icon: LucideIcon; label: string }>> = {
  apartment: { icon: Building2, label: "Apartment" },
  roommate: { icon: Users, label: "Roommate" },
  item: { icon: ShoppingBag, label: "For sale" },
};
/** Three columns: a third of the 672px column on wide screens, a third of the screen on phones. */
const TILE_SIZES = "(min-width: 672px) 224px, 33vw";

type GridState = { signature: string; tiles: ProfileTile[]; page: number; next: string | null; hasMore: boolean };

/** Changes when the server sends a different first page (a pin, a new post), so the grid starts over from it. */
function signatureOf(kind: ProfileGridKind, tiles: ProfileTile[]): string {
  return `${kind}|${tiles.map((t) => (t.pinned ? `${t.key}*` : t.key)).join(",")}`;
}

function merge(existing: ProfileTile[], more: ProfileTile[]): ProfileTile[] {
  const seen = new Set(existing.map((t) => t.key));
  return [...existing, ...more.filter((t) => !seen.has(t.key))];
}

/**
 * A profile's TikTok-style grid: three columns of 3:4 squares with hairline gaps. The first page comes from the server;
 * "Load more" fetches the next ones in the browser. Each square opens the post, reel or listing.
 */
export function ProfileGrid({
  userId,
  kind,
  initialTiles,
  initialHasMore,
  initialNext = null,
  emptyText,
}: {
  userId: string;
  kind: ProfileGridKind;
  initialTiles: ProfileTile[];
  initialHasMore: boolean;
  /** Saved and Liked: where the next page starts. */
  initialNext?: string | null;
  /** Shown when every page turned out to hold nothing the reader can see. */
  emptyText?: string;
}) {
  const signature = signatureOf(kind, initialTiles);
  const [state, setState] = useState<GridState>(() => ({ signature, tiles: initialTiles, page: 1, next: initialNext, hasMore: initialHasMore }));
  if (state.signature !== signature) {
    setState({ signature, tiles: initialTiles, page: 1, next: initialNext, hasMore: initialHasMore });
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function loadMore() {
    if (busy.current || !state.hasMore) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const from = state;
    try {
      const supabase = createClient();
      if (kind === "post" || kind === "reel") {
        const result = await listProfilePostTiles(supabase, userId, kind, from.page + 1);
        setState((s) => (s.signature !== from.signature ? s : { ...s, tiles: merge(s.tiles, result.tiles), page: from.page + 1, hasMore: result.hasMore }));
      } else {
        const list = kind === "saved" ? listProfileSaved : listProfileLiked;
        let result = await list(supabase, userId, { before: from.next });
        // Items the reader can no longer see (rented places, blocked people) can fill whole pages: skip a few, like the app.
        for (let hops = 0; hops < 3 && result.tiles.length === 0 && result.next; hops++) result = await list(supabase, userId, { before: result.next });
        setState((s) => (s.signature !== from.signature ? s : { ...s, tiles: merge(s.tiles, result.tiles), next: result.next, hasMore: result.next !== null }));
      }
    } catch (e) {
      setError(errorMessage(e, "Could not load more."));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return (
    <div>
      <ul className="grid grid-cols-3 gap-0.5" data-testid="profile-grid">
        {state.tiles.map((tile, i) => (
          <li key={tile.key}>
            <GridTile tile={tile} eager={i < 3} />
          </li>
        ))}
      </ul>
      {state.tiles.length === 0 && !state.hasMore && !error && emptyText ? (
        <p className="px-6 py-14 text-center text-base font-semibold text-gray-900" data-testid="profile-empty">
          {emptyText}
        </p>
      ) : null}
      {state.hasMore || error ? (
        <div className="flex flex-col items-center gap-2 px-4 py-5">
          {error ? (
            <p role="alert" className="text-center text-sm text-red-600">
              {error}
            </p>
          ) : null}
          {state.hasMore ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              // Not disabled while loading: a focused button that turns disabled drops the focus. loadMore ignores the extra presses.
              aria-disabled={loading || undefined}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-gray-100 px-5 text-sm font-semibold text-gray-900 hover:bg-gray-200 aria-disabled:opacity-60"
              data-testid="profile-grid-more"
            >
              {loading ? <Spinner className="h-4 w-4" /> : null}
              {loading ? "Loading…" : error ? "Try again" : "Load more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function tileLabel(tile: ProfileTile): string {
  const text = tile.text ? (tile.text.length > 80 ? `${tile.text.slice(0, 80).trimEnd()}…` : tile.text) : null;
  const parts = [text ? `${TYPE_NAME[tile.type]}: ${text}` : TYPE_NAME[tile.type]];
  if (tile.pinned) parts.push("pinned");
  if (tile.views !== null) parts.push(`${compactCount(tile.views)} ${tile.views === 1 ? "view" : "views"}`);
  return parts.join(", ");
}

/** One square: the cover (or the words of a text post), views bottom-left, a pin or the several-photos mark top-right. */
export function GridTile({ tile, eager }: { tile: ProfileTile; eager?: boolean }) {
  const picture = Boolean(tile.imageUrl);
  // White with a soft shadow over pictures; dark grey on the pale card behind a text post.
  const ink = picture ? "text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.65)]" : "text-gray-600";
  const badge = LISTING_BADGE[tile.type];
  const BadgeIcon = badge?.icon;
  const CountIcon = tile.isVideo ? Play : Eye;
  return (
    <Link
      href={tile.href}
      aria-label={tileLabel(tile)}
      className="group relative block aspect-[3/4] overflow-hidden bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      data-testid="profile-tile"
    >
      {tile.imageUrl ? (
        <TileImage src={tile.imageUrl} sizes={TILE_SIZES} eager={eager} className="transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand-100 via-brand-50 to-gray-100 px-3 pb-7 pt-3">
          <span className="line-clamp-6 whitespace-pre-line break-words text-center text-[13px] font-medium leading-snug text-gray-800">{tile.text ?? ""}</span>
        </span>
      )}
      {picture ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" /> : null}

      {tile.pinned ? (
        <Pin aria-hidden="true" className={cn("absolute right-1.5 top-1.5 h-4 w-4 rotate-45 fill-current", ink)} data-testid="profile-tile-pinned" />
      ) : tile.multiPhoto ? (
        <Copy aria-hidden="true" className={cn("absolute right-1.5 top-1.5 h-4 w-4", ink)} />
      ) : null}

      <span aria-hidden="true" className={cn("absolute bottom-1.5 left-1.5 flex items-center gap-1 text-xs font-bold tabular-nums", ink)}>
        {badge && BadgeIcon ? (
          <>
            <BadgeIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
            {badge.label}
          </>
        ) : tile.views !== null ? (
          <>
            <CountIcon className={cn("h-3.5 w-3.5", tile.isVideo && "fill-current")} strokeWidth={2.5} />
            {compactCount(tile.views)}
          </>
        ) : tile.isVideo ? (
          <Play className="h-3.5 w-3.5 fill-current" strokeWidth={2.5} />
        ) : null}
      </span>
    </Link>
  );
}
