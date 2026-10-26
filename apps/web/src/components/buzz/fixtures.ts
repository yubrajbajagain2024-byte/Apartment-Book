/**
 * DEVELOPMENT ONLY: the website's Buzz fixtures. The data and the fake Buzz calls are shared with the app
 * (`@apartment-book/shared/buzz-fixtures`, variants listed there); only the uploads are the website's own. Loaded only
 * by `api.ts` when the page was opened with `?buzzFixtures=<variant>` in a non-production build.
 */
import { createBuzzFixtures } from "@apartment-book/shared/buzz-fixtures";
import { cleanBuzzPhoto } from "@/lib/buzz-photos";
import type { BuzzApi } from "./api";
import { BuzzVideoTooLong, BUZZ_VIDEO_MAX_SECONDS, readVideoMeta } from "./video-upload";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createFixtureApi(variant: string): BuzzApi {
  return {
    ...createBuzzFixtures(variant),
    async uploadPhoto(file) {
      // The real re-encode runs (so the EXIF strip is exercised); only the upload is faked.
      const clean = await cleanBuzzPhoto(file);
      await wait(500);
      return { url: URL.createObjectURL(clean.blob), width: clean.width, height: clean.height, blur: clean.blur };
    },
    async uploadVideo(file, onProgress) {
      const meta = await readVideoMeta(file);
      if (meta.durationSeconds !== null && meta.durationSeconds > BUZZ_VIDEO_MAX_SECONDS) throw new BuzzVideoTooLong();
      for (let p = 0; p <= 100; p += 10) {
        onProgress(p, "uploading");
        await wait(140);
      }
      onProgress(100, "processing");
      await wait(900);
      return { playbackId: "fixturePlaybackId00000", posterUrl: null, width: meta.width, height: meta.height, durationSeconds: meta.durationSeconds };
    },
  };
}
