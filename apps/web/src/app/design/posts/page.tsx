import type { Metadata } from "next";
import { Navbar } from "@/components/layout/navbar";
import { DesignPostsFeed } from "./design-posts-feed";

export const metadata: Metadata = { title: "Design preview: posts", robots: { index: false } };

/**
 * Temporary design page with sample posts (no database needed) so the card,
 * autoplay and mute behaviour can be reviewed before real videos exist.
 */
export default function DesignPostsPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-[640px] flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">
        <p className="mb-3 rounded-lg bg-accent-100 px-3 py-2 text-xs text-gray-800">Design preview with sample data. Video posts take the full column; photo-only posts sit two per row. The sample video is a public test stream.</p>
        <DesignPostsFeed />
      </main>
    </>
  );
}
