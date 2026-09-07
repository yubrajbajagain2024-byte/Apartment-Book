import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";

/**
 * Address search for the location picker, backed by OpenStreetMap's Nominatim
 * (free, about one request per second). Only signed-in users can call it.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to search addresses" }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ results: [] });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `ApartmentBook/1.0 (${getSiteUrl()})`, "Accept-Language": "en" },
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return NextResponse.json({ results: [] }, { status: 502 });
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    const results = data
      .map((r) => ({ label: r.display_name, latitude: Number(r.lat), longitude: Number(r.lon) }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
