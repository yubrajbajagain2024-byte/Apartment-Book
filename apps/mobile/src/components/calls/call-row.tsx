import { Pressable, Text, View } from "react-native";
import { callRowText, type MessageCall } from "@apartment-book/shared";
import { Icon } from "@/components/icon";
import { makeStyles, useColors } from "@/lib/theme-provider";

/**
 * A call's row in the chat, as the Messages app draws one: the phone or camera in a circle, "Audio call" with how it
 * went under it ("3:24", "No answer", "Calling…"), or "Missed video call" in red for the one who did not pick up. The
 * row follows the call live (the database updates it as the call goes on). A tap calls back, or joins a call that is
 * still going on.
 */
export function CallRow({ call, mine, width, onPress, onLongPress }: { call: MessageCall; mine: boolean; width: number; onPress?: () => void; onLongPress?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  // The message's sender is the one who called, so "mine" says whether the viewer is the caller.
  const text = callRowText(call, mine ? call.started_by : null);
  const live = call.status !== "ended";
  const hint = live ? "Joins the call" : "Calls back";
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={[text.title, text.detail].filter(Boolean).join(", ")}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.row, mine ? styles.mine : styles.theirs, { width }, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.circle, mine && styles.circleMine]}>
        <Icon name={call.kind === "video" ? "videocam" : "call"} size={18} color={text.missed ? colors.red : mine ? colors.onBrand : colors.text} />
      </View>
      <View style={styles.words}>
        <Text style={[styles.title, mine && styles.titleMine, text.missed && styles.missed]} numberOfLines={1}>
          {text.title}
        </Text>
        {text.detail ? (
          <Text style={[styles.detail, mine && styles.detailMine]} numberOfLines={1}>
            {text.detail}
          </Text>
        ) : null}
      </View>
      <Icon name={live ? "call" : call.kind === "video" ? "videocam-outline" : "call-outline"} size={16} color={mine ? colors.onBrand : colors.brand} style={styles.action} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  // As wide as a sent photo, so "Missed audio call" always fits on its line.
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 14, paddingVertical: 9, borderRadius: 18, borderCurve: "continuous" },
  mine: { backgroundColor: colors.brand },
  theirs: { backgroundColor: colors.input },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  circleMine: { backgroundColor: "rgba(255,255,255,0.22)" },
  words: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 15, lineHeight: 19, fontWeight: "600", color: colors.text },
  titleMine: { color: colors.onBrand },
  missed: { color: colors.red },
  detail: { fontSize: 13, lineHeight: 16, color: colors.muted },
  detailMine: { color: colors.onBrand, opacity: 0.85 },
  action: { marginLeft: 2 },
}));
