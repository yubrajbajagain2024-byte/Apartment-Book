import { EVENT_CATEGORIES, EVENT_CATEGORY_VALUES, type EventCategory } from "../constants";

export function categoryLabel(category: string): string {
  return EVENT_CATEGORIES.find((c) => c.value === category)?.label ?? "Other";
}

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && (EVENT_CATEGORY_VALUES as string[]).includes(value);
}

/**
 * The words that put a calendar's event in a category, checked as whole words against its own categories and title.
 * Earlier rows win a tie, so "Career workshop" is Career, not Academic.
 */
const KEYWORDS: [EventCategory, RegExp][] = [
  ["career", /\b(careers?|jobs?|internships?|resumes?|résumés?|employers?|hiring|recruit\w*|networking|interview\w*|linkedin|professional development)\b/i],
  ["tech", /\b(tech|technology|coding|code|hackathons?|programming|software|robotics|ai|machine learning|data science|cyber\w*|startups?|engineering|computer science|developers?)\b/i],
  ["sports", /\b(games?|match|football|basketball|soccer|volleyball|baseball|softball|tennis|athletics?|intramurals?|tournaments?|track|swim\w*|golf|rec sports|bobcats?|kickoff|tailgate|esports)\b/i],
  ["music", /\b(concerts?|music|bands?|choirs?|orchestra|recitals?|jazz|dj|open mic|symphony|acapella|a cappella|singers?)\b/i],
  ["arts", /\b(arts?|gallery|theat(?:re|er)|exhibits?|exhibitions?|films?|dance|museum|poetry|design|photography|improv|comedy|screening|painting|crafts?)\b/i],
  ["wellness", /\b(wellness|yoga|meditation|health|fitness|counsel\w*|mental health|mindfulness|nutrition|5k|fun run|hike|wellbeing|well-being|therapy|stress)\b/i],
  ["service", /\b(volunteer\w*|service|donations?|drive|clean-?up|fundrais\w*|charity|community service|philanthropy|blood drive|food bank)\b/i],
  ["cultural", /\b(cultural?|heritage|international|diwali|lunar new year|festival|hispanic|latinx?|black history|pride|holi|eid|multicultural|celebration|fiesta|powwow)\b/i],
  ["faith", /\b(worship|bible|prayer|church|chapel|mass|fellowship|ministry|faith|islamic|muslim|jewish|hillel|ramadan|christian|catholic|hindu|sikh|buddhist|religious)\b/i],
  ["academic", /\b(lectures?|seminars?|workshops?|class(?:es)?|study|exams?|finals|research|colloqui\w*|thesis|dissertation|tutoring|advising|library|academic|symposium|conference|panel|orientation|registration|commencement|graduation|info session|webinar)\b/i],
  ["social", /\b(party|mixer|social|meet-?ups?|game night|trivia|hang-?out|movie night|karaoke|welcome|bingo|picnic|bbq|barbecue|dinner|lunch|breakfast|coffee|ice cream|meet and greet|homecoming)\b/i],
];

/**
 * The category a calendar's own words suggest: its CATEGORIES first (one match there decides), else its title; the
 * feed's default when nothing matches. A category word the app knows, as the calendar's category, wins outright.
 */
export function categoryFromText(categories: string[], title: string, fallback: EventCategory): EventCategory {
  for (const c of categories) {
    const direct = c.trim().toLowerCase();
    if (isEventCategory(direct)) return direct;
  }
  const score = (texts: string[]): EventCategory | null => {
    const joined = texts.join(" \n ");
    let best: EventCategory | null = null;
    let bestCount = 0;
    for (const [category, re] of KEYWORDS) {
      const count = joined.match(new RegExp(re.source, "gi"))?.length ?? 0;
      if (count > bestCount) {
        best = category;
        bestCount = count;
      }
    }
    return best;
  };
  return score(categories) ?? score([title]) ?? fallback;
}
