"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ImagePlus, Star, X } from "lucide-react";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_LISTING, type PhotoMeta, type UploadKind } from "@apartment-book/shared";
import { formatBytes, uploadPhoto } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import { cn, errorMessage } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type Item = PhotoMeta & {
  key: string;
  status: "uploading" | "done" | "error";
  preview: string | null;
  error?: string;
  size?: number;
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

/**
 * Photo uploader: drag and drop or pick files, instant previews, per-photo
 * progress, reorder, choose the cover. Originals are uploaded untouched.
 * Submits `images` (URL) and `imageMeta` (JSON) hidden inputs, in order.
 */
export function ImageUploader({
  name = "images",
  metaName = "imageMeta",
  kind,
  userId,
  initial = [],
  max = MAX_IMAGES_PER_LISTING,
}: {
  name?: string;
  metaName?: string;
  kind: UploadKind;
  userId: string;
  initial?: PhotoMeta[];
  max?: number;
}) {
  const [items, setItems] = useState<Item[]>(() => initial.map((p, i) => ({ ...p, key: `initial-${i}`, status: "done", preview: null })));
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const done = items.filter((i) => i.status === "done");
  const uploading = items.filter((i) => i.status === "uploading").length;

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list);
    const room = max - items.filter((i) => i.status !== "error").length;
    const accepted = files.slice(0, Math.max(0, room));
    setNotice(accepted.length < files.length ? `You can add up to ${max} photos.` : null);
    if (accepted.length === 0) return;

    const supabase = createClient();
    const newItems: Item[] = accepted.map((file, i) => {
      const type = file.type || (/\.(heic|heif)$/i.test(file.name) ? "image/heic" : "");
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      const problem = !ALLOWED.has(type)
        ? "Only JPG, PNG, WEBP, GIF or HEIC photos are allowed"
        : file.size > MAX_IMAGE_SIZE_BYTES
          ? `Larger than 25 MB (${formatBytes(file.size)})`
          : null;
      return { key: `${Date.now()}-${i}-${file.name}`, url: "", width: null, height: null, blur: null, status: problem ? "error" : "uploading", preview, error: problem ?? undefined, size: file.size };
    });
    setItems((prev) => [...prev, ...newItems]);
    if (inputRef.current) inputRef.current.value = "";

    await Promise.all(
      accepted.map(async (file, i) => {
        const item = newItems[i];
        if (item.status === "error") return;
        try {
          const photo = await uploadPhoto(supabase, { kind, userId, file });
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

  function remove(key: string) {
    setItems((prev) => prev.filter((p) => p.key !== key));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void addFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-3">
      {done.map((p) => (
        <span key={p.key}>
          <input type="hidden" name={name} value={p.url} />
          <input type="hidden" name={metaName} value={JSON.stringify({ url: p.url, width: p.width, height: p.height, blur: p.blur })} />
        </span>
      ))}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn("rounded-xl border-2 border-dashed p-3 transition-colors", over ? "border-brand-500 bg-brand-50" : "border-gray-300")}
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {items.map((item, index) => (
            <div key={item.key} className={cn("group relative aspect-square overflow-hidden rounded-lg bg-gray-100 ring-1", item.status === "error" ? "ring-red-400" : "ring-gray-200")}>
              {item.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the file being uploaded
                <img src={item.preview} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" draggable={false} />
              ) : item.url ? (
                <Image src={item.url} alt={`Photo ${index + 1}`} fill sizes="200px" quality={75} placeholder={item.blur ? "blur" : "empty"} blurDataURL={item.blur ?? undefined} className="object-cover" />
              ) : null}

              {item.status === "uploading" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                  <Spinner className="h-6 w-6" />
                  <span className="text-[10px] font-medium">Uploading{item.size ? ` · ${formatBytes(item.size)}` : ""}</span>
                </div>
              ) : null}
              {item.status === "error" ? (
                <div className="absolute inset-0 flex items-end bg-gradient-to-t from-red-900/80 to-transparent p-1.5 text-[10px] font-medium leading-tight text-white">{item.error}</div>
              ) : null}

              {index === 0 && item.status === "done" ? (
                <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <Star className="h-3 w-3 fill-current" /> Cover
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => remove(item.key)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                aria-label={`Remove photo ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {item.status === "done" ? (
                <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow disabled:opacity-0" aria-label="Move photo left">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  {index > 0 ? (
                    <button type="button" onClick={() => move(index, 0)} className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-gray-800 shadow">
                      Make cover
                    </button>
                  ) : null}
                  <button type="button" onClick={() => move(index, index + 1)} disabled={index === items.length - 1} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow disabled:opacity-0" aria-label="Move photo right">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {items.filter((i) => i.status !== "error").length < max ? (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-white text-xs font-medium text-gray-600 hover:border-brand-500 hover:text-brand-600">
              <ImagePlus className="h-6 w-6" />
              Add photos
              <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
          ) : null}
        </div>
        <p className="mt-2 text-center text-xs text-gray-500">Drag and drop photos here, or click Add photos.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          Originals are kept at full quality (JPG, PNG, WEBP or HEIC, up to 25 MB each). The first photo is the cover; hover a photo to reorder.
        </span>
        <span className="font-medium text-gray-700">
          {done.length}/{max} added{uploading ? ` · ${uploading} uploading` : ""}
        </span>
      </div>
      {notice ? <p className="text-sm text-red-600">{notice}</p> : null}
    </div>
  );
}
