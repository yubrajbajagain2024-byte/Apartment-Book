import Link from "next/link";
import { ExternalLink, EyeOff, Lock, User } from "lucide-react";
import { formatDate, formatPrice, muxPosterUrl, muxPlaybackUrl, videosFor, type ContentSnapshot } from "@apartment-book/shared";
import { reviewImageUrls } from "@/lib/quarantine";
import { siteUrlFor } from "@/lib/site-links";
import { safeHttpUrl, safePlaybackId } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Time } from "@/components/common/time";
import { targetTypeLabel } from "@/components/reports/report-badges";

const EXTRA_LABELS: Record<string, string> = {
  price: "Price",
  currency: "Currency",
  address: "Address",
  city: "City",
  status: "Status",
  category: "Category",
  condition: "Condition",
  post_type: "Post type",
  budget_min: "Budget from",
  budget_max: "Budget to",
  location: "Location",
  kind: "Kind",
  topic: "Topic",
  score: "Score",
  alias: "Shown as",
  is_op: "By the thread author",
  conversation_id: "Conversation",
  post_id: "Thread",
  parent_id: "In reply to",
  target_type: "On",
  target_id: "On id",
};

function extraValue(key: string, value: unknown, extra: Record<string, unknown>): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (key === "university_id") return null;
  if (key === "price" || key === "budget_min" || key === "budget_max") return formatPrice(Number(value), typeof extra.currency === "string" ? extra.currency : "USD");
  if (key === "currency") return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** The content behind a report or a lookup, one shape for every kind. Server component: it signs quarantined photos. */
export async function ContentView({ snapshot }: { snapshot: ContentSnapshot }) {
  const hidden = Boolean(snapshot.hiddenAt);
  const isBuzz = snapshot.targetType === "buzz" || snapshot.targetType === "buzz_comment";
  // User-written columns: only http(s) URLs are shown, and only well-formed playback ids are put into Mux URLs.
  const images = (await reviewImageUrls(snapshot.images, hidden)).map(safeHttpUrl);
  const skipped = images.filter((u) => u === null).length;
  const videos = videosFor(snapshot.videos).filter((v) => safePlaybackId(v.playback_id));
  const siteUrl = siteUrlFor(snapshot.targetType, snapshot.targetId);
  const extras = Object.entries(snapshot.extra)
    .map(([key, value]) => [EXTRA_LABELS[key] ?? key, extraValue(key, value, snapshot.extra)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{targetTypeLabel(snapshot.targetType)}</Badge>
        {hidden ? (
          <Badge tone="amber">
            <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
            Hidden
          </Badge>
        ) : (
          <Badge tone="green">Visible</Badge>
        )}
        <span className="text-xs text-gray-500">
          posted <Time iso={snapshot.createdAt} />
        </span>
        {siteUrl && !hidden ? (
          <a href={siteUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            Open on site
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {hidden ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-semibold">Hidden {snapshot.hiddenAt ? formatDate(snapshot.hiddenAt) : ""}.</span> Reason shown to the owner: “{snapshot.hiddenReason}”. Everyone else no longer sees it.
          </div>
        ) : null}

        <div className="flex items-start gap-3 rounded-lg bg-gray-50 px-3 py-2.5 ring-1 ring-gray-200">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 ring-1 ring-gray-200">
            {isBuzz ? <Lock className="h-4 w-4" aria-hidden="true" /> : <User className="h-4 w-4" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            {snapshot.authorId ? (
              <p>
                <Link href={`/users/${snapshot.authorId}`} className="font-semibold text-gray-900 hover:underline">
                  {snapshot.authorName || "Unnamed"}
                </Link>
                {snapshot.authorEmail ? <span className="text-gray-600"> · {snapshot.authorEmail}</span> : null}
              </p>
            ) : (
              <p className="font-semibold text-gray-900">Author account deleted</p>
            )}
            {isBuzz ? (
              <p className="mt-0.5 text-xs text-amber-800">
                Buzz is anonymous: readers see “{typeof snapshot.extra.alias === "string" ? snapshot.extra.alias : "a student alias"}”. The author is revealed to you for moderation only, and this view
                was written to the audit log.
              </p>
            ) : null}
          </div>
        </div>

        {snapshot.title ? <h2 className="text-lg font-semibold text-gray-900">{snapshot.title}</h2> : null}
        {snapshot.body ? <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{snapshot.body}</p> : <p className="text-sm italic text-gray-500">No text.</p>}

        {images.some((u) => u !== null) ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((url, i) =>
              url ? (
                <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
                  <img src={url} alt={`Photo ${i + 1}`} className="aspect-square h-full w-full object-cover" loading="lazy" />
                </a>
              ) : null,
            )}
          </div>
        ) : null}
        {skipped > 0 ? <p className="text-xs text-red-700">{skipped} image {skipped === 1 ? "entry is" : "entries are"} not a web address and {skipped === 1 ? "was" : "were"} not rendered. The row is worth a closer look.</p> : null}

        {videos.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {videos.map((video) => (
              <li key={video.media_id || video.playback_id} className="flex items-center gap-3 rounded-lg ring-1 ring-gray-200">
                <img src={safeHttpUrl(video.poster_url) ?? muxPosterUrl(video.playback_id, 1, 320)} alt="" className="h-20 w-14 shrink-0 rounded-l-lg bg-gray-900 object-cover" loading="lazy" />
                <div className="min-w-0 flex-1 py-2 text-sm">
                  <p className="font-medium text-gray-900">Video{video.duration_seconds ? ` · ${Math.round(video.duration_seconds)}s` : ""}</p>
                  <p className="truncate text-xs text-gray-500">playback {video.playback_id}</p>
                  <a href={muxPlaybackUrl(video.playback_id)} target="_blank" rel="noreferrer noopener" className="text-xs font-medium text-brand-600 hover:underline">
                    Open stream {hidden ? "(disabled while hidden)" : ""}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {extras.length > 0 ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {extras.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-gray-500">{label}</dt>
                <dd className="truncate text-gray-900" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="text-xs text-gray-400">
          {snapshot.targetType}:{snapshot.targetId}
        </p>
      </CardBody>
    </Card>
  );
}
