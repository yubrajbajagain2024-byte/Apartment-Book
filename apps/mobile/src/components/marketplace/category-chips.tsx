import { memo, useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { ITEM_CATEGORIES, type ItemCategoryValue } from "@apartment-book/shared";
import { hapticSelect } from "@/lib/haptics";
import { radius } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

const ALL = "all";
const OPTIONS: { key: string; value: ItemCategoryValue | null; label: string }[] = [{ key: ALL, value: null, label: "All" }, ...ITEM_CATEGORIES.map((c) => ({ key: c.value, value: c.value, label: c.label }))];
/** How much of the next chip stays in sight when the row scrolls to the chosen one, so it is clear there is more. */
const PEEK = 36;

/**
 * The Marketplace's category pills in one sideways row: All, then every category. The chosen one is filled with the brand
 * blue, the others sit on the input fill. Choosing another plays the selection tick and hands it to `onChange` (null for
 * All); tapping the chosen one again does nothing. The row scrolls just enough to keep the chosen pill in full view.
 */
export const CategoryChips = memo(function CategoryChips({ value, onChange }: { value: ItemCategoryValue | null; onChange: (value: ItemCategoryValue | null) => void }) {
  const styles = useStyles();
  const ref = useRef<ScrollView>(null);
  const boxes = useRef(new Map<string, { x: number; width: number }>());
  const offset = useRef(0);
  const viewport = useRef(0);
  const content = useRef(0);
  const chosen = value ?? ALL;

  const reveal = useCallback((key: string) => {
    const box = boxes.current.get(key);
    if (!box || viewport.current <= 0) return;
    let x = offset.current;
    if (box.x - PEEK < x) x = box.x - PEEK;
    else if (box.x + box.width + PEEK > x + viewport.current) x = box.x + box.width + PEEK - viewport.current;
    x = Math.max(0, Math.min(x, content.current - viewport.current));
    if (Math.abs(x - offset.current) > 1) ref.current?.scrollTo({ x, animated: true });
  }, []);

  useEffect(() => reveal(chosen), [chosen, reveal]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.x;
  }, []);

  function pick(next: ItemCategoryValue | null) {
    if (next === value) return;
    hapticSelect();
    onChange(next);
  }

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      // While the search keyboard is up, the first tap on a pill already picks it.
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={32}
      onLayout={(e: LayoutChangeEvent) => {
        viewport.current = e.nativeEvent.layout.width;
      }}
      onContentSizeChange={(w) => {
        content.current = w;
      }}
      style={styles.strip}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel="Categories"
    >
      {OPTIONS.map((o) => {
        const selected = o.key === chosen;
        return (
          <Pressable
            key={o.key}
            onLayout={(e) => {
              boxes.current.set(o.key, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
            }}
            onPress={() => pick(o.value)}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && styles.chipPressed]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const useStyles = makeStyles((colors) => ({
  strip: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.bar },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { height: 36, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  chipSelected: { backgroundColor: colors.brand },
  chipPressed: { opacity: 0.7 },
  // The same weight either way, so choosing a pill never changes its width.
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  labelSelected: { color: colors.onBrand },
}));
