import { View } from "react-native";
import { EVENT_CATEGORIES, type EventCategory } from "@apartment-book/shared";
import { Chip } from "@/components/ui";
import { space } from "@/lib/theme";
import { categoryIcon } from "./event-glyphs";

/** Every category as a chip, the picked ones lit: the interests strip on For you and the Interests screen share it. */
export function InterestChips({ picked, onToggle }: { picked: ReadonlySet<string>; onToggle: (category: EventCategory) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {EVENT_CATEGORIES.map((c) => (
        <Chip key={c.value} label={c.label} icon={categoryIcon(c.value).name} active={picked.has(c.value)} onPress={() => onToggle(c.value)} />
      ))}
    </View>
  );
}
