import { PostSkeleton } from "@/components/feed/feed-bits";

/**
 * The app's loading state: the shape of Home while it renders. A tab bar and a post card drawn in shimmer blocks, in
 * the same 500px column the feeds use, so the page settles rather than jumps when the content arrives.
 */
export default function Loading() {
  return (
    <div className="-mt-4 flex w-full flex-col gap-1 sm:mt-0 sm:gap-4" aria-busy="true" aria-label="Loading">
      <div className="-mx-3 flex h-11 items-center justify-center gap-7 border-b border-gray-200 bg-white sm:mx-0 sm:w-full sm:max-w-[500px] sm:self-center sm:rounded-[14px] sm:border-b-0 sm:ring-1 sm:ring-gray-200" aria-hidden="true">
        <span className="ab-skeleton h-3 w-14 rounded" />
        <span className="ab-skeleton h-3 w-10 rounded" />
        <span className="ab-skeleton h-3 w-12 rounded" />
      </div>
      <div className="mx-auto w-full max-w-[500px]">
        <div className="-mx-3 flex flex-col bg-white sm:mx-0 sm:gap-4 sm:bg-transparent">
          <PostSkeleton />
          <PostSkeleton className="hidden sm:flex" />
        </div>
      </div>
    </div>
  );
}
