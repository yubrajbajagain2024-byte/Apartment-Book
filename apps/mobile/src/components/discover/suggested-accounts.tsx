import { Pressable, ScrollView, Text, View } from "react-native";
import { compactCount, type DiscoverAccount, type FollowStats } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { FollowButton } from "@/components/follow-button";
import { radius, space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-provider";

const CARD_WIDTH = 150;

/** "12 followers", "1 follower"; nothing while unknown (a database before migration 44). */
function followersLabel(n: number | null): string | null {
  if (n === null) return null;
  return n === 1 ? "1 follower" : `${compactCount(n)} followers`;
}

/**
 * Discover's "Suggested for you", as Instagram's: cards side by side, each with the photo, the name, the university
 * (any campus: that is the point) and the follower count opening the profile, and a Follow button of its own.
 */
export function SuggestedAccounts({ accounts, stats, userId, onNeedLogin, onOpen }: { accounts: readonly DiscoverAccount[]; stats: Record<string, FollowStats>; userId: string | null; onNeedLogin: () => void; onOpen: (id: string) => void }) {
  const styles = useStyles();
  if (accounts.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading} accessibilityRole="header">
        Suggested for you
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {accounts.map((a) => {
          const campus = a.universityName ?? a.university?.email_domain ?? null;
          const followers = followersLabel(a.followers);
          return (
            <View key={a.id} style={styles.card}>
              <Pressable onPress={() => onOpen(a.id)} accessibilityRole="button" accessibilityLabel={[a.full_name, campus, followers].filter(Boolean).join(", ")} style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}>
                <Avatar name={a.full_name} url={a.avatar_url} size={64} userId={a.id} />
                <Text numberOfLines={1} style={styles.name}>
                  {a.full_name}
                </Text>
                {campus ? (
                  <Text numberOfLines={1} style={styles.meta}>
                    {campus}
                  </Text>
                ) : null}
                {followers ? <Text style={styles.meta}>{followers}</Text> : null}
              </Pressable>
              <FollowButton targetId={a.id} stats={stats[a.id]} userId={userId} onNeedLogin={onNeedLogin} compact style={styles.follow} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { paddingVertical: space.md, gap: space.sm },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, paddingHorizontal: space.lg },
  cards: { gap: space.sm, paddingHorizontal: space.lg },
  card: { width: CARD_WIDTH, padding: space.md, gap: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.input, alignItems: "center" },
  person: { alignItems: "center", gap: 2, alignSelf: "stretch" },
  name: { marginTop: space.xs, fontSize: 14, fontWeight: "700", color: colors.text, textAlign: "center" },
  meta: { fontSize: 12, color: colors.muted, textAlign: "center" },
  follow: { alignSelf: "stretch" },
}));
