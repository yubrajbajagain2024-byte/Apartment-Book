import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isVerifiedPoster, type FollowStats, type PosterSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { FollowButton } from "@/components/follow-button";
import { colors, space } from "@/lib/theme";

/**
 * One person in a list (followers, following, search): avatar, name and university domain (verified people only) open
 * the profile; the Follow button beside them stays its own control for VoiceOver. No button on the viewer's own row.
 */
export function PersonRow({ person: p, stats, userId, onNeedLogin, onChange, onPress }: { person: PosterSummary; stats: FollowStats | undefined; userId: string | null; onNeedLogin: () => void; onChange?: (stats: FollowStats) => void; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={p.full_name} style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}>
        <Avatar name={p.full_name} url={p.avatar_url} size="md" userId={p.id} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={styles.personName}>{p.full_name}</Text>
          {isVerifiedPoster(p) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="checkmark-circle" size={13} color={colors.brand} />
              <Text numberOfLines={1} style={styles.domain}>{p.university?.email_domain}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {p.id !== userId ? <FollowButton targetId={p.id} stats={stats} userId={userId} onNeedLogin={onNeedLogin} compact onChange={onChange} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10 },
  person: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md },
  personName: { fontSize: 15, fontWeight: "700", color: colors.text },
  domain: { fontSize: 13, color: colors.muted },
});
