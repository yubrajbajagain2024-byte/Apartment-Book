"use client";

import { useState } from "react";
import { Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, ImageOff, Play, Presentation, VideoOff } from "lucide-react";
import { formatFileSize, type MessageAttachment } from "@apartment-book/shared";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { MediaViewer } from "./media-viewer";
import { useSignedMedia, useStableSource, type SignedFile, type SignedFiles } from "./signed-media";

/**
 * The photos, videos and files sent with one message (from the app): photos and videos as a rounded grid that opens a
 * full-screen viewer, files as cards that open in a new tab. The bucket is private, so everything loads from signed
 * addresses, asked for in one request with the rest of the chat's.
 */
export function MessageAttachments({
  attachments,
  mine,
  senderName,
  sentAt,
}: {
  attachments: MessageAttachment[];
  mine: boolean;
  /** Who sent them and when, for the viewer's title bar. */
  senderName: string;
  sentAt: string;
}) {
  const signed = useSignedMedia(attachments.map((a) => a.path));
  const [viewing, setViewing] = useState<number | null>(null);
  const media = attachments.filter((a) => a.kind !== "file");
  const files = attachments.filter((a) => a.kind === "file");

  return (
    <div data-testid="message-attachments" className={cn("mb-1 flex max-w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
      {media.length > 0 ? <MediaGrid items={media} signed={signed} onOpen={setViewing} /> : null}
      {files.map((a, i) => (
        <FileCard key={`${i}:${a.path}`} attachment={a} file={signed[a.path]} mine={mine} />
      ))}
      {viewing !== null ? (
        <MediaViewer items={media} index={viewing} signed={signed} senderName={senderName} sentAt={sentAt} onIndexChange={setViewing} onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}

/** One picture fills the bubble in its own shape (within reason); two or four go in pairs of squares, the rest in rows of three. */
function MediaGrid({ items, signed, onOpen }: { items: MessageAttachment[]; signed: SignedFiles; onOpen: (index: number) => void }) {
  const n = items.length;
  const columns = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
  return (
    <div
      role="group"
      aria-label={mediaSummary(items)}
      data-testid="attachment-media"
      className={cn("grid max-w-full gap-0.5 overflow-hidden rounded-2xl", columns === 1 ? "w-60 grid-cols-1" : columns === 2 ? "w-60 grid-cols-2" : "w-72 grid-cols-3")}
    >
      {items.map((a, i) => (
        <MediaTile key={`${i}:${a.path}`} attachment={a} file={signed[a.path]} label={tileLabel(a, i, n)} single={n === 1} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}

function MediaTile({ attachment, file, label, single, onOpen }: { attachment: MessageAttachment; file: SignedFile | undefined; label: string; single: boolean; onOpen: () => void }) {
  const source = useStableSource(attachment.path, file);
  const video = attachment.kind === "video";
  // A picture that has loaded stays up even if signing it again fails later.
  const unavailable = !source.loaded && (source.broken || Boolean(file && !file.url));
  const show = Boolean(source.src) && !source.waiting && !unavailable;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      style={single ? { aspectRatio: aspectRatioOf(attachment) } : undefined}
      className={cn(
        "group relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
        !single && "aspect-square",
        video ? "bg-gray-900" : "bg-gray-200",
      )}
    >
      {!video && !source.loaded && !unavailable ? <span className="ab-skeleton absolute inset-0" aria-hidden="true" /> : null}
      {show && source.src ? (
        video ? (
          // The frame at 0.1 s stands in for a poster (Safari shows none for preload="metadata" without it).
          <video
            src={`${source.src}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden="true"
            onLoadedMetadata={source.onLoad}
            onError={source.onError}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a private file behind a short-lived signed URL: next/image would cache it past its expiry
          <img
            src={source.src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={source.onLoad}
            onError={source.onError}
            className="absolute inset-0 h-full w-full object-cover transition group-hover:brightness-95"
          />
        )
      ) : null}
      {unavailable ? (
        <span className={cn("absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center", video ? "text-gray-400" : "text-gray-500")} aria-hidden="true">
          {video ? <VideoOff className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />}
          {/* Only a tile on its own has room for words; the viewer explains either way. */}
          {single ? <span className="text-xs font-medium">{source.broken ? "Can't preview here" : "Couldn't load"}</span> : null}
        </span>
      ) : null}
      {video && !unavailable ? (
        <>
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/25 transition group-hover:bg-black/70">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </span>
          </span>
          {attachment.duration ? (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white" aria-hidden="true">
              {formatDuration(attachment.duration)}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

/** A document, sheet, slides or archive: its name, size and type. Opens in a new tab (PDFs show there, the rest download). */
function FileCard({ attachment, file, mine }: { attachment: MessageAttachment; file: SignedFile | undefined; mine: boolean }) {
  const extension = extensionOf(attachment.name);
  const unavailable = Boolean(file && !file.url);
  // A file that could not be signed is tried again in a couple of minutes, so this is not final.
  const details = unavailable ? "Couldn't load" : [attachment.size > 0 ? formatFileSize(attachment.size) : null, extension].filter(Boolean).join(" · ");
  const className = cn("flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left", mine ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-900");
  const content = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", mine ? "bg-white/20 text-white" : "bg-white text-brand-600 ring-1 ring-gray-200")}>
        <FileTypeIcon attachment={attachment} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{attachment.name}</span>
        {details ? <span className={cn("block truncate text-xs", mine ? "text-white/80" : "text-gray-500")}>{details}</span> : null}
      </span>
      {file?.url ? <Download className={cn("h-4 w-4 shrink-0", mine ? "text-white/80" : "text-gray-500")} aria-hidden="true" /> : !file ? <Spinner className="h-4 w-4 shrink-0 opacity-70" /> : null}
    </>
  );

  if (!file?.url) {
    return (
      <div data-testid="attachment-file" aria-disabled="true" className={cn(className, "opacity-75")}>
        {content}
      </div>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" data-testid="attachment-file" title={`Open ${attachment.name}`} className={cn(className, mine ? "hover:bg-brand-700" : "hover:bg-gray-200")}>
      {content}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function FileTypeIcon({ attachment }: { attachment: MessageAttachment }) {
  const mime = attachment.mime.toLowerCase();
  const extension = extensionOf(attachment.name)?.toLowerCase() ?? "";
  const className = "h-5 w-5";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv" || ["xls", "xlsx", "csv"].includes(extension)) return <FileSpreadsheet className={className} />;
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx"].includes(extension)) return <Presentation className={className} />;
  if (mime.includes("zip") || extension === "zip") return <FileArchive className={className} />;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word") || mime.includes("rtf") || ["pdf", "txt", "doc", "docx", "rtf"].includes(extension)) return <FileText className={className} />;
  return <FileIcon className={className} />;
}

/** "PDF", "DOCX": the end of the file name, when it looks like a file type. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : null;
}

/** A single picture keeps its shape between 3:4 (tall) and 16:9 (wide); without its size it is square. */
function aspectRatioOf(a: MessageAttachment): number {
  if (!a.width || !a.height) return 1;
  return Math.min(Math.max(a.width / a.height, 3 / 4), 16 / 9);
}

/** "0:07", "12:30", "1:02:03". */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "3 photos", "1 video", "2 photos and 1 video". */
function mediaSummary(items: MessageAttachment[]): string {
  const photos = items.filter((a) => a.kind === "image").length;
  const videos = items.length - photos;
  const part = (count: number, noun: string) => (count === 0 ? null : `${count} ${noun}${count === 1 ? "" : "s"}`);
  return [part(photos, "photo"), part(videos, "video")].filter(Boolean).join(" and ");
}

function tileLabel(a: MessageAttachment, index: number, count: number): string {
  const position = count > 1 ? ` ${index + 1} of ${count}` : "";
  if (a.kind !== "video") return `Open photo${position}`;
  return `Play video${position}${a.duration ? ` (${formatDuration(a.duration)})` : ""}`;
}
