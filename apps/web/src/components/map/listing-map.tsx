"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { LeafletMapProps } from "./leaflet-map";

// Leaflet touches `window`, so it is only loaded in the browser.
const LeafletMap = dynamic(() => import("./leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-gray-100" />,
});

export type { MapPin } from "./leaflet-map";

export function ListingMap({ className, height = 360, ...props }: LeafletMapProps & { className?: string; height?: number }) {
  return (
    <div className={cn("relative z-0 isolate w-full overflow-hidden rounded-xl bg-gray-100 ring-1 ring-gray-200", className)} style={{ height }}>
      <LeafletMap {...props} />
    </div>
  );
}
