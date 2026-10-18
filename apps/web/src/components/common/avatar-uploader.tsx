"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { uploadImage } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";

export function AvatarUploader({ name, userId, initialUrl, displayName }: { name: string; userId: string; initialUrl: string | null; displayName: string }) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(createClient(), { kind: "avatars", userId, file, fileName: file.name });
      setUrl(uploaded);
    } catch (e) {
      setError(errorMessage(e, "Upload failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <Avatar name={displayName} src={url} size="xl" className="ring-1 ring-gray-200" />
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white">
            <Spinner />
          </span>
        ) : null}
      </div>
      <input type="hidden" name={name} value={url ?? ""} />
      <div className="flex flex-col gap-2">
        <label className="ab-press inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] px-3.5 text-[13px] font-semibold text-gray-900 ring-1 ring-gray-300 transition-colors hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gray-400">
          <Camera className="h-4 w-4" strokeWidth={1.75} />
          Change photo
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => onChange(e.target.files)} />
        </label>
        {url ? (
          <button type="button" onClick={() => setUrl(null)} className="text-left text-sm text-gray-500 underline-offset-4 transition-colors hover:text-gray-900 hover:underline">
            Remove photo
          </button>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
