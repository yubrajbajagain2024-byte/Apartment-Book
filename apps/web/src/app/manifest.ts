import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@apartment-book/shared";

/** Lets students "Add to Home Screen" on their phones until the native apps ship. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Apartments",
    description: APP_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#f1f3f4",
    theme_color: "#0f766e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
