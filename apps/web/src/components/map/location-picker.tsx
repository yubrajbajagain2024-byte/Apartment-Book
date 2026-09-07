"use client";

import { useState } from "react";
import { Crosshair, MapPin, Search, X } from "lucide-react";
import { DEFAULT_MAP_CENTER, distanceKm, formatDistance, type LatLng } from "@apartment-book/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingMap, type MapPin as Pin } from "./listing-map";

type GeocodeResult = { label: string; latitude: number; longitude: number };

/**
 * Lets a user pin a location: search an address, click the map, or drag the pin.
 * Submits `latitude` and `longitude` hidden inputs (empty when no pin).
 */
export function LocationPicker({
  initial,
  campus,
  addressFieldIds = [],
}: {
  initial?: LatLng | null;
  campus?: (LatLng & { name: string }) | null;
  /** Ids of address inputs in the same form, used by "Find the address above". */
  addressFieldIds?: string[];
}) {
  const [pin, setPin] = useState<LatLng | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(text: string) {
    const q = text.trim();
    if (q.length < 3) {
      setError("Type at least 3 characters");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Address search is unavailable right now");
      const data = (await res.json()) as { results: GeocodeResult[] };
      setResults(data.results);
      if (data.results.length === 0) setError("No match. Try a simpler address, or click the map to drop a pin.");
      if (data.results.length === 1) choose(data.results[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Address search failed");
    } finally {
      setSearching(false);
    }
  }

  function choose(result: GeocodeResult) {
    setPin({ latitude: result.latitude, longitude: result.longitude });
    setResults([]);
    setQuery(result.label);
  }

  function useAddressAbove() {
    const parts = addressFieldIds
      .map((id) => (document.getElementById(id) as HTMLInputElement | null)?.value?.trim())
      .filter((v): v is string => Boolean(v));
    const text = parts.join(", ");
    setQuery(text);
    void search(text);
  }

  const campusPin: Pin[] = campus ? [{ id: "campus", latitude: campus.latitude, longitude: campus.longitude, label: campus.name, kind: "campus" }] : [];
  const distance = pin && campus ? formatDistance(distanceKm(pin, campus)) : null;

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="latitude" value={pin ? String(pin.latitude) : ""} />
      <input type="hidden" name="longitude" value={pin ? String(pin.longitude) : ""} />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search(query);
              }
            }}
            placeholder="Search an address or place…"
            className="pl-9"
            aria-label="Search address"
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => search(query)} loading={searching}>
          Find on map
        </Button>
        {addressFieldIds.length > 0 ? (
          <Button type="button" variant="outline" onClick={useAddressAbove}>
            <Crosshair className="h-4 w-4" /> Use the address above
          </Button>
        ) : null}
      </div>
      {results.length > 1 ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" onClick={() => choose(r)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {r.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ListingMap
        center={pin ?? campus ?? DEFAULT_MAP_CENTER}
        zoom={pin ? 15 : 13}
        pins={campusPin}
        picker={{ position: pin, onChange: setPin }}
        height={300}
        scrollWheelZoom={false}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
        <span>
          {pin
            ? `Pinned at ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}${distance ? ` · about ${distance} from ${campus?.name}` : ""}`
            : "Click the map to drop a pin, or search an address. The distance to campus is calculated from the pin."}
        </span>
        {pin ? (
          <button type="button" onClick={() => setPin(null)} className="inline-flex items-center gap-1 font-medium text-gray-700 hover:underline">
            <X className="h-3.5 w-3.5" /> Clear pin
          </button>
        ) : null}
      </div>
    </div>
  );
}
