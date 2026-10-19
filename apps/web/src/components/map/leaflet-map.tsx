"use client";

import "leaflet/dist/leaflet.css";
import L, { type LatLngBoundsExpression } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_MAP_ZOOM, DEFAULT_TILE_ATTRIBUTION, DEFAULT_TILE_URL, type LatLng } from "@apartment-book/shared";

export type MapPin = {
  id: string;
  latitude: number;
  longitude: number;
  /** Short text shown on the pin, e.g. "$650" or the campus name. */
  label: string;
  title?: string;
  subtitle?: string;
  href?: string;
  kind?: "listing" | "campus" | "picker";
};

export type LeafletMapProps = {
  center: LatLng;
  zoom?: number;
  pins?: MapPin[];
  /** Zoom the map so that every pin is visible. */
  fitToPins?: boolean;
  /** Lets the user drop and drag a pin (used by the location picker). */
  picker?: { position: LatLng | null; onChange: (position: LatLng) => void };
  scrollWheelZoom?: boolean;
};

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || DEFAULT_TILE_URL;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Pins are HTML labels sized by their content (no iconSize), positioned with CSS
 * transforms so the label sits centred above the coordinate.
 */
function iconFor(kind: MapPin["kind"], label: string): L.DivIcon {
  if (kind === "campus") {
    return L.divIcon({
      className: "ab-marker",
      html: `<span class="inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold text-white shadow-md ring-2 ring-white">🎓 ${escapeHtml(label)}</span>`,
    });
  }
  if (kind === "picker") {
    return L.divIcon({
      className: "ab-marker",
      html: `<span class="block h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-red-600 shadow-md"></span>`,
    });
  }
  return L.divIcon({
    className: "ab-marker",
    html: `<span class="inline-block -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow-md ring-2 ring-white hover:bg-brand-700">${escapeHtml(label)}</span>`,
  });
}

function FitToPins({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  const key = pins.map((p) => `${p.latitude},${p.longitude}`).join("|");
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0].latitude, pins[0].longitude], 14);
      return;
    }
    const bounds = pins.map((p) => [p.latitude, p.longitude]) as LatLngBoundsExpression;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function PickerEvents({ picker }: { picker: NonNullable<LeafletMapProps["picker"]> }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      picker.onChange({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
  });
  const position = picker.position;
  useEffect(() => {
    if (position) map.panTo([position.latitude, position.longitude]);
  }, [map, position]);
  if (!position) return null;
  return (
    <Marker
      position={[position.latitude, position.longitude]}
      draggable
      icon={iconFor("picker", "")}
      eventHandlers={{
        dragend: (e) => {
          const ll = (e.target as L.Marker).getLatLng();
          picker.onChange({ latitude: ll.lat, longitude: ll.lng });
        },
      }}
    />
  );
}

export function LeafletMap({ center, zoom = DEFAULT_MAP_ZOOM, pins = [], fitToPins, picker, scrollWheelZoom = true }: LeafletMapProps) {
  return (
    <MapContainer center={[center.latitude, center.longitude]} zoom={zoom} scrollWheelZoom={scrollWheelZoom} className="h-full w-full">
      <TileLayer url={TILE_URL} attribution={DEFAULT_TILE_ATTRIBUTION} />
      {pins.map((pin) => (
        <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={iconFor(pin.kind, pin.label)} zIndexOffset={pin.kind === "campus" ? 1000 : 0}>
          {pin.title ? (
            <Popup>
              <div className="min-w-40 text-sm">
                {pin.href ? (
                  <a href={pin.href} className="font-semibold text-brand-700 hover:underline">
                    {pin.title}
                  </a>
                ) : (
                  <span className="font-semibold">{pin.title}</span>
                )}
                {pin.subtitle ? <p className="mt-0.5 text-gray-600">{pin.subtitle}</p> : null}
              </div>
            </Popup>
          ) : null}
        </Marker>
      ))}
      {fitToPins ? <FitToPins pins={pins} /> : null}
      {picker ? <PickerEvents picker={picker} /> : null}
    </MapContainer>
  );
}
