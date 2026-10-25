import type { MetadataRoute } from "next";

/** A private tool: nothing here is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
