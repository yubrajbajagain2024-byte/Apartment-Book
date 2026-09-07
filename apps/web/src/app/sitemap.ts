import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Public listings are indexable so students can find them through Google. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/roommates`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/marketplace`, changeFrequency: "hourly", priority: 0.9 },
  ];

  try {
    const supabase = await createClient();
    const [apartments, posts, items] = await Promise.all([
      supabase.from("apartments").select("id, updated_at").eq("status", "active").order("created_at", { ascending: false }).limit(1000),
      supabase.from("roommate_posts").select("id, updated_at").eq("is_active", true).order("created_at", { ascending: false }).limit(1000),
      supabase.from("items").select("id, updated_at").eq("status", "available").order("created_at", { ascending: false }).limit(1000),
    ]);
    return [
      ...staticPages,
      ...(apartments.data ?? []).map((a) => ({ url: `${base}/apartments/${a.id}`, lastModified: a.updated_at })),
      ...(posts.data ?? []).map((p) => ({ url: `${base}/roommates/${p.id}`, lastModified: p.updated_at })),
      ...(items.data ?? []).map((i) => ({ url: `${base}/marketplace/${i.id}`, lastModified: i.updated_at })),
    ];
  } catch {
    return staticPages;
  }
}
