import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  // A private tool: never framed, never sniffed, no referrer leaks to other sites, no device APIs.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // The shared package is plain TypeScript; let Next.js compile it.
  transpilePackages: ["@apartment-book/shared"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // Moderation previews use plain <img> on purpose (quarantined files come through
  // short-lived signed URLs), so the image optimizer is only kept for avatars.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "image.mux.com" },
    ],
  },
};

export default nextConfig;
