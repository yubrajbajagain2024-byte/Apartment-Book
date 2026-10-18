import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** The end of a Home feed: a small mark and "You're all caught up.", centred under the last post. */
export function CaughtUp() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Ionicons name="ellipse-outline" size={14} color={colors.faint} />
      <Text style={styles.text}>You're all caught up.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 32, paddingBottom: 24 },
  text: { ...type.aside, color: colors.muted },
}));
