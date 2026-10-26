import type { Ionicons } from "@expo/vector-icons";
import { formatPrice, type ItemCategoryValue, type ItemWithSeller } from "@apartment-book/shared";

type IconName = keyof typeof Ionicons.glyphMap;

/** Each category's icon: beside the category on a Marketplace post, and on the empty feed of that category. */
const CATEGORY_ICONS: Record<ItemCategoryValue, IconName> = {
  mattress_bedding: "bed-outline",
  furniture: "cube-outline",
  desk_chair: "desktop-outline",
  kitchen: "restaurant-outline",
  electronics: "laptop-outline",
  textbooks: "book-outline",
  decor: "bulb-outline",
  storage: "archive-outline",
  bikes_transport: "bicycle-outline",
  clothing: "shirt-outline",
  sports: "basketball-outline",
  other: "pricetag-outline",
};

export function categoryIcon(category: string | null | undefined): IconName {
  return category && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, category) ? CATEGORY_ICONS[category as ItemCategoryValue] : "bag-handle-outline";
}

/** The pickup location as the seller wrote it, trimmed and on one line ("" when none was given). */
export function pickupText(location: string | null | undefined): string {
  return (location ?? "").replace(/\s+/g, " ").trim();
}

/** "$80", or "Free" for a price of 0. */
export function priceText(item: Pick<ItemWithSeller, "price" | "currency">): string {
  return item.price === 0 ? "Free" : formatPrice(item.price, item.currency);
}
