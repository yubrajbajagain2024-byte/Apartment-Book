/**
 * The content panels of a queue item: Buzz's blind thread context (migration 30's buzz_v2_staff_context: the root,
 * the parent chain and nearby replies, each with only its per-thread alias), and the media strip. Defensive about
 * shapes: the context belongs to the Buzz serializer, not to this console.
 */
import { ExternalLink, Film } from "lucide-react";
import { BUZZ_PHOSPHOR } from "@apartment-book/shared";
import { ExcerptBlock } from "./parts";

interface ContextEntry {
  id: string | null;
  text: string;
  title: string;
  alias: string | null;
  status: string | null;
}

function entryOf(x: unknown): ContextEntry | null {
  if (!x || typeof x !== "object") return null;
  const b = x as { id?: unknown; text?: unknown; title?: unknown; alias?: { emoji?: unknown; label?: unknown } | null; status?: unknown };
  if (typeof b.text !== "string") return null;
  const alias = b.alias && typeof b.alias === "object" && typeof b.alias.label === "string" ? `${typeof b.alias.emoji === "string" ? `${b.alias.emoji} ` : ""}${b.alias.label}` : null;
  return {
    id: typeof b.id === "string" ? b.id : null,
    text: b.text,
    title: typeof b.title === "string" ? b.title : "",
    alias,
    status: typeof b.status === "string" ? b.status : null,
  };
}

function Entry({ e, current }: { e: ContextEntry; current?: boolean }) {
  const text = e.title ? `${e.title}\n${e.text}` : e.text;
  const label = [e.alias, e.status && e.status !== "active" ? e.status : null, current ? "this item" : null].filter(Boolean).join(" · ");
  return (
    <div style={current ? { boxShadow: `0 0 0 2px ${BUZZ_PHOSPHOR.accentLine}`, borderRadius: 10 } : undefined}>
      <ExcerptBlock text={text} anon aliasLabel={label || null} />
    </div>
  );
}

export function BuzzContext({ context, entityId }: { context: unknown; entityId: string | null }) {
  if (!context || typeof context !== "object") return <p className="text-sm text-gray-500">No thread context.</p>;
  const c = context as { entityType?: unknown; root?: unknown; parents?: unknown; siblings?: unknown };
  const root = entryOf(c.root);
  const parents = Array.isArray(c.parents) ? c.parents.map(entryOf).filter((x): x is ContextEntry => x !== null) : [];
  const siblings = Array.isArray(c.siblings) ? c.siblings.map(entryOf).filter((x): x is ContextEntry => x !== null) : [];
  const isReply = c.entityType === "buzz_reply";
  if (!root && parents.length === 0 && siblings.length === 0) return <p className="text-sm text-gray-500">No thread context.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">Through the blind serializer: per-thread aliases only, never an account.</p>
      {root && isReply ? (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-gray-600">Thread root</div>
          <Entry e={root} />
        </div>
      ) : null}
      {parents.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-gray-600">Replying to</div>
          {parents.map((p, i) => (
            <Entry key={p.id ?? i} e={p} />
          ))}
        </div>
      ) : null}
      {siblings.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-gray-600">{isReply ? "Nearby replies" : "First replies"}</div>
          {siblings.map((s, i) => (
            <Entry key={s.id ?? i} e={s} current={s.id !== null && s.id === entityId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MUX = /^https:\/\/stream\.mux\.com\/([A-Za-z0-9]+)\.m3u8$/;

export function MediaStrip({ media }: { media: { url: string; kind: "image" | "video" }[] }) {
  if (media.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {media.map((m, i) => {
        if (m.kind === "image") {
          return (
            <a key={i} href={m.url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- staff review: any storage host, shown as uploaded */}
              <img src={m.url} alt={`Attachment ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
            </a>
          );
        }
        const mux = MUX.exec(m.url);
        return (
          <a key={i} href={m.url} target="_blank" rel="noreferrer noopener" className="relative block overflow-hidden rounded-lg bg-gray-900 ring-1 ring-gray-200" aria-label={`Video attachment ${i + 1}`}>
            {mux ? (
              // eslint-disable-next-line @next/next/no-img-element -- Mux poster frame
              <img src={`https://image.mux.com/${mux[1]}/thumbnail.jpg?time=1&width=320`} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover opacity-80" />
            ) : (
              <span className="flex aspect-square w-full items-center justify-center text-gray-300">
                <Film className="h-6 w-6" aria-hidden />
              </span>
            )}
            <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
              Video <ExternalLink className="h-3 w-3" aria-hidden />
            </span>
          </a>
        );
      })}
    </div>
  );
}
