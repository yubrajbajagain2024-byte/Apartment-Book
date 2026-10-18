"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, ShieldCheck, X } from "lucide-react";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_BUZZ, type PhotoMeta } from "@apartment-book/shared";
import { uploadBuzzPhoto } from "@/lib/buzz-photos";
import { formatBytes } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type Item = PhotoMeta & { key: string; status: "uploading" | "done" | "error"; preview: string; error?: string };

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

/**
 * Photo picker for anonymous Buzz threads. Every photo is redrawn in the
 * browser first (see lib/buzz-photos), so location and camera details never
 * leave the device; the original file is never uploaded.
 * Submits `images` (URL) and `imageMeta` (JSON) hidden inputs, in order, like ImageUploader.
 */
export function BuzzImageUploader({ name = "images", metaName = "imageMeta", max = MAX_IMAGES_PER_BUZZ }: { name?: string; metaName?: string; max?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const done = items.filter((i) => i.status === "done");
  const uploading = items.filter((i) => i.status === "uploading").length;
  const used = items.filter((i) => i.status !== "error").length;

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const accepted = files.slice(0, Math.max(0, max - used));
    setNotice(accepted.length < Array.from(list).length ? `You can add up to ${max} photos (pictures only).` : null);
    if (accepted.length === 0) return;

    const supabase = createClient();
    const newItems: Item[] = accepted.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      counter.current += 1;
      const tooBig = file.size > MAX_IMAGE_SIZE_BYTES;
      return { key: `buzz-photo-${counter.current}`, url: "", width: null, height: null, blur: null, status: tooBig ? "error" : "uploading", preview, error: tooBig ? `Larger than 25 MB (${formatBytes(file.size)})` : undefined };
    });
    setItems((prev) => [...prev, ...newItems]);
    if (inputRef.current) inputRef.current.value = "";

    await Promise.all(
      accepted.map(async (file, i) => {
        const item = newItems[i];
        if (item.status === "error") return;
        try {
          const photo = await uploadBuzzPhoto(supabase, file);
          setItems((prev) => prev.map((p) => (p.key === item.key ? { ...p, ...photo, status: "done" } : p)));
        } catch (e) {
          setItems((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: "error", error: errorMessage(e, "Upload failed. Try again.") } : p)));
        }
      }),
    );
  }

  function move(from: number, to: number) {
    setItems((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void addFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="buzz-image-uploader">
      {done.map((p) => (
        <span key={p.key}>
          <input type="hidden" name={name} value={p.url} />
          <input type="hidden" name={metaName} value={JSON.stringify({ url: p.url, width: p.width, height: p.height, blur: p.blur })} />
        </span>
      ))}
      {/* Lets the form block "Post" while a photo is still going up. */}
      {uploading ? <input type="hidden" name="photosUploading" value={uploading} /> : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn("rounded-xl border-2 border-dashed p-3 transition-colors", over ? "border-brand-500 bg-brand-50" : "border-gray-300")}
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item, index) => (
            <div key={item.key} className={cn("group relative aspect-square overflow-hidden rounded-lg bg-gray-100 ring-1", item.status === "error" ? "ring-red-400" : "ring-gray-200")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
              <img src={item.preview} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" draggable={false} />

              {item.status === "uploading" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                  <Spinner className="h-6 w-6" />
                  <span className="text-[10px] font-medium">Removing details…</span>
                </div>
              ) : null}
              {item.status === "error" ? <div className="absolute inset-0 flex items-end bg-gradient-to-t from-red-900/80 to-transparent p-1.5 text-[10px] font-medium leading-tight text-white">{item.error}</div> : null}

              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((p) => p.key !== item.key))}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label={`Remove photo ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {item.status === "done" && items.length > 1 ? (
                <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow disabled:opacity-0" aria-label="Move photo left">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(index, index + 1)} disabled={index === items.length - 1} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow disabled:opacity-0" aria-label="Move photo right">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {used < max ? (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-white text-xs font-medium text-gray-600 hover:border-brand-500 hover:text-brand-600">
              <ImagePlus className="h-6 w-6" />
              Add photos
              <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-gray-500">
        <span className="inline-flex items-start gap-1.5">
          <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-brand-600" />
          Location and camera details are removed from every photo before it is uploaded. Check that nothing in the picture itself shows who you are.
        </span>
        <span className="font-medium text-gray-700">
          {done.length}/{max} added{uploading ? ` · ${uploading} uploading` : ""}
        </span>
      </div>
      {notice ? <p className="text-sm text-red-600">{notice}</p> : null}
    </div>
  );
}
