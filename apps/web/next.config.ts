import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : undefined;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  // The shared package is plain TypeScript; let Next.js compile it.
  transpilePackages: ["@apartment-book/shared"],
  images: {
    // Photos are the product: serve them sharp. Originals stay untouched in
    // storage; these settings control the on-page renditions next/image makes.
    qualities: [75, 85, 95],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [64, 96, 128, 256, 384, 512],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      // Supabase Storage (hosted)
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "*.supabase.in", pathname: "/storage/v1/object/public/**" },
      // Your exact project host (covers self-hosted / custom domains)
      ...(supabaseHost
        ? [{ protocol: supabaseHost.includes("localhost") || supabaseHost === "127.0.0.1" ? ("http" as const) : ("https" as const), hostname: supabaseHost }]
        : []),
      // Supabase local development (supabase start)
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
      // Google account avatars
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // Sample photos for the design preview page
      { protocol: "https", hostname: "picsum.photos" },
      // Video poster frames
      { protocol: "https", hostname: "image.mux.com" },
    ],
  },
};

export default nextConfig;
