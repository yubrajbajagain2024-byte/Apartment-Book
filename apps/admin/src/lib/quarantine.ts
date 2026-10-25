import "server-only";
import { storagePathFromUrl } from "@/lib/site-links";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Photos of hidden content live in the private `quarantine` bucket once the worker has
 * moved them, so their public URLs stop working. For the review screen, sign them for
 * ten minutes with the service role (when configured); anything that cannot be signed
 * keeps its public URL, which still works until the move happens.
 */
export async function reviewImageUrls(images: string[], hidden: boolean): Promise<string[]> {
  if (!hidden || images.length === 0) return images;
  const admin = createServiceClient();
  if (!admin) return images;
  return Promise.all(
    images.map(async (url) => {
      const path = storagePathFromUrl(url);
      if (!path) return url;
      const { data } = await admin.storage.from("quarantine").createSignedUrl(path, 600);
      return data?.signedUrl ?? url;
    }),
  );
}
