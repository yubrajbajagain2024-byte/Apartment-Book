import { ActivityIndicator, Text } from "react-native";
import { Icon } from "@/components/icon";
import { AnimatedPressable, usePressScale } from "@/components/ui";
import { radius } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** TikTok's grey Drafts capsule beside Post (and beside Next in a listing's steps). */
export function DraftsButton({ busy, disabled, onPress }: { busy: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const press = usePressScale();
  return (
    <AnimatedPressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} disabled={disabled} accessibilityRole="button" accessibilityLabel="Save as a draft" style={[styles.drafts, { opacity: disabled && !busy ? 0.5 : press.opacity, transform: [{ scale: press.scale }] }]}>
      {busy ? <ActivityIndicator color={colors.text} /> : <Icon name="archive-outline" sf="archivebox" size={19} weight="semibold" color={colors.text} />}
      <Text style={styles.draftsText}>Drafts</Text>
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  drafts: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: radius.pill, backgroundColor: colors.input },
  draftsText: { fontSize: 17, fontWeight: "600", color: colors.text },
}));
