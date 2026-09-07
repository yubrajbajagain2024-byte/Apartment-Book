"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { MAX_IMAGES_PER_LISTING, uploadImage, type UploadKind } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

/**
 * Uploads photos straight from the browser to Supabase Storage and submits
 * the resulting URLs as hidden `<input name={name}>` fields.
 */
export function ImageUploader({
  name,
  kind,
  userId,
  initial = [],
  max = MAX_IMAGES_PER_LISTING,
}: {
  name: string;
  kind: UploadKind;
  userId: string;
  initial?: string[];
  max?: number;
}) {
  const [urls, setUrls] = useState<string[]>(initial);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const room = max - urls.length;
    const selected = Array.from(files).slice(0, Math.max(0, room));
    if (selected.length < files.length) setError(`You can add up to ${max} photos.`);
    if (selected.length === 0) return;

    const supabase = createClient();
    setUploading((n) => n + selected.length);
    await Promise.all(
      selected.map(async (file) => {
        try {
          const url = await uploadImage(supabase, { kind, userId, file, fileName: file.name });
          setUrls((prev) => (prev.length < max ? [...prev, url] : prev));
        } catch (e) {
          setError(errorMessage(e, "Upload failed. Try a smaller JPG or PNG."));
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {urls.map((url, index) => (
          <div key={url} className="group relative aspect-square overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
            <Image src={url} alt={`Photo ${index + 1}`} fill sizes="150px" className="object-cover" />
            <input type="hidden" name={name} value={url} />
            {index === 0 ? (
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Cover</span>
            ) : null}
            <button
              type="button"
              onClick={() => setUrls((prev) => prev.filter((u) => u !== url))}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              aria-label="Remove photo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`uploading-${i}`} className="flex aspect-square items-center justify-center rounded-lg bg-gray-100">
            <Spinner className="text-gray-500" />
          </div>
        ))}
        {urls.length + uploading < max ? (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-xs font-medium text-gray-600 hover:border-brand-500 hover:text-brand-600">
            <ImagePlus className="h-6 w-6" />
            Add photos
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        ) : null}
      </div>
      <p className="text-xs text-gray-500">
        JPG, PNG, WEBP or GIF up to 5 MB each. The first photo is the cover. {urls.length}/{max} added.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
