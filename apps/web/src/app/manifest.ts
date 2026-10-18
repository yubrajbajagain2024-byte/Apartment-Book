import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@apartment-book/shared";

/** Lets students "Add to Home Screen" on their phones until the native apps ship. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#f7f6f3",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
