import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** The end of a Home feed: a small mark and "You're all caught up.", centred under the last post. */
export function CaughtUp() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Ionicons name="disc-outline" size={18} color={colors.muted} />
      <Text style={styles.text}>You're all caught up.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingTop: 28, paddingBottom: 20 },
  text: { fontSize: 14, color: colors.muted },
}));
