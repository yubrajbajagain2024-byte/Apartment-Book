import type { ParsedEvent } from "./ics";

export type RssOptions = {
  /** Items whose start is outside [windowStart, windowEnd] (ms) are left out. */
  windowStart: number;
  windowEnd: number;
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", times: "×", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", euro: "€", pound: "£",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù", acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", atilde: "ã", ntilde: "ñ", otilde: "õ", ccedil: "ç", szlig: "ß", aring: "å", oslash: "ø", aelig: "æ",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Ccedil: "Ç", Uuml: "Ü", Ouml: "Ö", Auml: "Ä",
};

/** HTML and XML entities turned back into characters (&amp;, &#39;, &#x2019;). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain words out of an item's HTML description: tags dropped, breaks and paragraphs kept as line breaks, entities decoded. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** The text of the first <tag> in a fragment (any namespace prefix when `tag` has none), CDATA unwrapped, or null. */
export function tagText(fragment: string, tag: string): string | null {
  const name = tag.includes(":") ? tag : `(?:[a-zA-Z0-9]+:)?${tag}`;
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, "i").exec(fragment);
  if (!m) return null;
  const inner = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return (cdata ? cdata[1]! : decodeEntities(inner)).trim() || null;
}

/** Every value of the tag (several <category> lines). */
function tagTexts(fragment: string, tag: string): string[] {
  const name = tag.includes(":") ? tag : `(?:[a-zA-Z0-9]+:)?${tag}`;
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, "gi");
  const out: string[] = [];
  for (const m of fragment.matchAll(re)) {
    const inner = m[1]!.trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
    const v = (cdata ? cdata[1]! : decodeEntities(inner)).trim();
    if (v) out.push(v);
  }
  return out;
}

/** The tags an item may give its start and end in: the RSS 1.0 Events module (ev:), xCal, Dublin Core, then plain names. */
const START_TAGS = ["ev:startdate", "xcal:dtstart", "dtstart", "startdate", "start_date", "start", "dc:date"];
const END_TAGS = ["ev:enddate", "xcal:dtend", "dtend", "enddate", "end_date", "end"];

/** An ISO 8601 or RFC 2822 date, as an instant; a date alone ("2026-11-05") is midnight UTC and marks an all-day item. */
function parseDate(value: string | null): { ms: number; dateOnly: boolean } | null {
  if (!value) return null;
  const v = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const ms = Date.parse(dateOnly ? `${v}T00:00:00Z` : v);
  return Number.isFinite(ms) ? { ms, dateOnly } : null;
}

/**
 * The events an RSS feed lists, one per item that says when it starts (ev:startdate and the like; the publication date
 * alone is not a start, so news items are skipped). The item's link is kept as the registration link.
 */
export function parseRss(xml: string, opts: RssOptions): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const item = m[1]!;
    const title = tagText(item, "title")?.replace(/\s+/g, " ");
    if (!title) continue;
    let start: ReturnType<typeof parseDate> = null;
    for (const t of START_TAGS) {
      start = parseDate(tagText(item, t));
      if (start) break;
    }
    if (!start) continue;
    let end: ReturnType<typeof parseDate> = null;
    for (const t of END_TAGS) {
      end = parseDate(tagText(item, t));
      if (end) break;
    }
    const endMs = end && end.ms > start.ms ? end.ms : null;
    if ((endMs ?? start.ms) < opts.windowStart || start.ms > opts.windowEnd) continue;
    const link = tagText(item, "link");
    const guid = tagText(item, "guid") ?? link ?? `${title}@${start.ms}`;
    if (seen.has(guid)) continue;
    seen.add(guid);
    const html = tagText(item, "content:encoded") ?? tagText(item, "description") ?? "";
    const description = stripHtml(html);
    out.push({
      uid: guid.slice(0, 500),
      title: title.slice(0, 160),
      description: description ? description.slice(0, 5000) : null,
      startsAt: new Date(start.ms).toISOString(),
      endsAt: endMs === null ? null : new Date(endMs).toISOString(),
      allDay: start.dateOnly,
      location: tagText(item, "ev:location")?.replace(/\s+/g, " ").slice(0, 200) ?? null,
      url: link && /^https?:\/\//i.test(link) ? link : null,
      categories: [...tagTexts(item, "category"), ...tagTexts(item, "ev:type")],
      cancelled: /\bcancell?ed\b/i.test(title),
    });
  }
  return out;
}
