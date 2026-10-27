import { useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { makeStyles } from "@/lib/theme-provider";

/**
 * Text folded to its first few lines with "more…" under it, "less" once opened, Facebook style. `children` are the
 * inline parts (plain strings and styled <Text> spans such as hashtags and mentions). A hidden copy laid out at full
 * length counts the lines, so the fold only shows when there really is more: a short text has no "more…" at all. With
 * `lines` 0 the text starts hidden altogether behind "more…" (a roommate post's description). `expanded` starts it open;
 * with `collapsible` false (a post's own screen) it is simply all there, without "less".
 */
export function ExpandableText({ children, style, lines = 3, expanded: startOpen = false, collapsible = true, selectable, accessibilityLabel }: { children: ReactNode; style?: StyleProp<TextStyle>; lines?: number; expanded?: boolean; collapsible?: boolean; selectable?: boolean; accessibilityLabel?: string }) {
  const styles = useStyles();
  const [open, setOpen] = useState(startOpen);
  const [folds, setFolds] = useState(false);
  // Hidden whole: nothing to measure, the fold is always there.
  const hidden = collapsible && lines <= 0;
  const measure = collapsible && !hidden;
  return (
    <View>
      {hidden && !open ? null : (
        <Text style={style} numberOfLines={open || hidden ? undefined : lines} selectable={selectable} accessibilityLabel={accessibilityLabel}>
          {children}
        </Text>
      )}
      {measure ? (
        // Same text, same style, same width, never seen: its line count says whether the fold is needed. It lies over the
        // real text (and "more…"), so a View that takes no touches holds it: a tappable span in it (an @mention) never
        // catches a tap meant for what is underneath.
        <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <Text style={style} onTextLayout={(e) => setFolds(e.nativeEvent.lines.length > lines)}>
            {children}
          </Text>
        </View>
      ) : null}
      {hidden || (measure && folds) ? (
        <Text style={[styles.toggle, hidden && !open && styles.toggleAlone]} onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={open ? "less" : "more"}>
          {open ? "less" : "more…"}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  measure: { position: "absolute", top: 0, left: 0, right: 0, opacity: 0 },
  toggle: { color: colors.muted, fontSize: 14, fontWeight: "600", paddingTop: 3, alignSelf: "flex-start" },
  // Standing in for the whole text, the fold needs no space above it.
  toggleAlone: { paddingTop: 0 },
}));
