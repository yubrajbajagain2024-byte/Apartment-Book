import { ScrollView, Text, View } from "react-native";
import type { CallParticipant } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { Sheet, SheetHeader } from "@/components/sheet";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** One line under a name in the list: where they stand in the call. */
function stateText(p: CallParticipant, inRoom: boolean, me: boolean): string {
  switch (p.state) {
    case "joined":
      return me ? "You" : inRoom ? "In the call" : "Joining…";
    case "ringing":
      return "Ringing…";
    case "declined":
      return "Declined";
    case "missed":
      return "Didn't answer";
    default:
      return "Left";
  }
}

/**
 * Everyone a call rang, as FaceTime's list: who is in it (with a mute mark where their microphone is off), who it is
 * still ringing, who declined, and who left. `connected` are the identities LiveKit has in the room right now;
 * `muted` the ones whose microphone is off.
 */
export function ParticipantsSheet({ visible, onClose, participants, userId, connected, muted }: { visible: boolean; onClose: () => void; participants: CallParticipant[]; userId: string; connected: ReadonlySet<string>; muted: ReadonlySet<string> }) {
  const styles = useStyles();
  const colors = useColors();
  const order: Record<CallParticipant["state"], number> = { joined: 0, ringing: 1, left: 2, declined: 3, missed: 4 };
  const rows = [...participants].sort((a, b) => order[a.state] - order[b.state] || (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? ""));
  const inCall = rows.filter((p) => p.state === "joined").length;
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close the list" maxHeight="70%">
      <SheetHeader title={`${inCall} in the call`} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {rows.map((p) => {
          const me = p.user_id === userId;
          const dim = p.state !== "joined" && p.state !== "ringing";
          return (
            <View key={p.user_id} style={[styles.row, dim && styles.dim]} accessibilityLabel={`${p.profile?.full_name ?? "Someone"}, ${stateText(p, connected.has(p.user_id), me)}`}>
              <Avatar name={p.profile?.full_name} url={p.profile?.avatar_url} size={44} online={false} ringColor={colors.elevated} />
              <View style={styles.words}>
                <Text style={styles.name} numberOfLines={1}>
                  {p.profile?.full_name ?? "Someone"}
                </Text>
                <Text style={styles.state} numberOfLines={1}>
                  {stateText(p, connected.has(p.user_id), me)}
                </Text>
              </View>
              {p.state === "joined" && muted.has(p.user_id) ? <Icon name="mic-off" size={18} color={colors.muted} /> : null}
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingHorizontal: 16, paddingVertical: 8, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  dim: { opacity: 0.55 },
  words: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  state: { fontSize: 13, color: colors.muted },
}));
