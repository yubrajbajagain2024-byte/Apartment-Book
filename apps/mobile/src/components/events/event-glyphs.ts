import type { SFSymbol } from "expo-symbols";
import type { EventCategory } from "@apartment-book/shared";
import type { IconName } from "@/components/icon";

/** One glyph per category (EVENT_CATEGORIES): the pill's icon, and the picture of an event that has none. */
export const CATEGORY_ICONS: Record<EventCategory, { name: IconName; sf: SFSymbol }> = {
  academic: { name: "school-outline", sf: "graduationcap" },
  career: { name: "briefcase-outline", sf: "briefcase" },
  social: { name: "people-outline", sf: "person.2" },
  sports: { name: "basketball-outline", sf: "basketball" },
  music: { name: "musical-notes-outline", sf: "music.note" },
  arts: { name: "color-palette-outline", sf: "paintpalette" },
  tech: { name: "laptop-outline", sf: "laptopcomputer" },
  wellness: { name: "leaf-outline", sf: "leaf" },
  cultural: { name: "earth-outline", sf: "globe.americas" },
  service: { name: "hand-left-outline", sf: "hand.raised" },
  faith: { name: "sparkles-outline", sf: "sparkles" },
  other: { name: "calendar-outline", sf: "calendar" },
};

export function categoryIcon(category: string): { name: IconName; sf: SFSymbol } {
  return CATEGORY_ICONS[category as EventCategory] ?? CATEGORY_ICONS.other;
}
