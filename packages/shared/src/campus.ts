/**
 * Short campus codes for tight spots: the Marketplace title ("TXST marketplace") and the campus pin on every item card.
 * Self-contained (no runtime imports), so the unit tests load it straight from Node.
 */

/** A university as the queries return it. Either field may be missing: items carry the name only. */
export type CampusNameParts = { name?: string | null; email_domain?: string | null };

/**
 * Codes students really use that the rules below would get wrong: Texas State's initials, "TSU", belong to Texas
 * Southern, and "UTA" is UT Arlington. Matched on the email domain (or one of its subdomains) or, for a row without a
 * domain, on the full name.
 */
const KNOWN_CODES: readonly { domain: string; name: string; code: string }[] = [
  { domain: "txstate.edu", name: "texas state university", code: "TXST" },
  { domain: "utexas.edu", name: "university of texas at austin", code: "UT" },
];

/** Labels that only say what kind of domain it is, skipped to reach the institution's own: ox.ac.uk → ox. */
const GENERIC_LABELS = new Set(["ac", "edu", "co", "com", "org", "net", "gov", "sch"]);

/** Words that never give a letter: "University of California, Los Angeles" → UCLA. */
const MINOR_WORDS = new Set(["of", "the", "at", "and", "for", "in", "on", "de", "del", "la", "le", "les", "des", "du", "da", "di", "do", "der", "und", "y", "et"]);

const MAX_DOMAIN_CODE = 5;
const MAX_INITIALS = 6;
/** A one-word name is shown whole, up to this many letters. */
const MAX_WORD = 8;

function tidyDomain(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
}

function tidyName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The institution's own label of an email domain: asu.edu → asu, student.unimelb.edu.au → unimelb, mail.utoronto.ca →
 * utoronto, ox.ac.uk → ox. Empty for something that is not a domain.
 */
function institutionLabel(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  labels.pop();
  while (labels.length > 1 && GENERIC_LABELS.has(labels[labels.length - 1] ?? "")) labels.pop();
  return labels[labels.length - 1] ?? "";
}

/**
 * Initials of the name's significant words ("Imperial College London" → ICL), accents dropped, apostrophes ignored
 * ("King's College London" → KCL), "&" splitting a word ("Texas A&M University" → TAMU) and an acronym inside the name
 * kept whole ("IIT Delhi" → IITD). A one-word name is shown whole, upper-cased.
 */
function nameInitials(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !MINOR_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.toUpperCase().slice(0, MAX_WORD);
  return words
    .map((w) => (/^\p{Lu}{2,}$/u.test(w) ? w : w[0]!.toUpperCase()))
    .join("")
    .slice(0, MAX_INITIALS);
}

/**
 * A short upper-case code for a university: a well-known code when there is one (txstate.edu → TXST), else the
 * institution's label of its email domain when that is at most five letters (asu.edu → ASU, ucla.edu → UCLA), else the
 * initials of its name (Imperial College London → ICL). The email domain, unique per university, decides before the
 * name. Empty when there is nothing to go on.
 */
export function campusShortName(campus: CampusNameParts | null | undefined): string {
  if (!campus) return "";
  const domain = tidyDomain(campus.email_domain);
  if (domain) {
    const known = KNOWN_CODES.find((k) => domain === k.domain || domain.endsWith(`.${k.domain}`));
    if (known) return known.code;
    const label = institutionLabel(domain);
    if (label.length >= 2 && label.length <= MAX_DOMAIN_CODE && /^[a-z]+$/.test(label)) return label.toUpperCase();
  }
  const name = tidyName(campus.name);
  const known = KNOWN_CODES.find((k) => k.name === name);
  if (known) return known.code;
  return nameInitials(campus.name ?? "");
}
