import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PeopleSearch } from "@/components/people-search";
import { useTabBarInset } from "@/lib/tab-bar";
import { space, textStyle } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

/** The title row, fixed under the safe area, laid out like Explore's. */
const TITLE_ROW = 52;

/**
 * The Search tab, second in the bottom bar: the people search (find accounts by name; people to follow while the box
 * is empty) under its own big "Search" title. The box waits for a tap rather than opening the keyboard on every visit.
 */
export default function SearchTab() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const tabBar = useTabBarInset();
  return (
    <View style={styles.screen}>
      <View style={[styles.chrome, { paddingTop: insets.top }]}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Search
        </Text>
      </View>
      <PeopleSearch bottomInset={tabBar} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  chrome: { backgroundColor: colors.bar },
  title: { height: TITLE_ROW, lineHeight: TITLE_ROW, paddingLeft: 20, paddingRight: space.lg, fontSize: textStyle.largeTitle.fontSize, fontWeight: textStyle.largeTitle.fontWeight, color: colors.text },
}));
