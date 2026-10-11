import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ProfileSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { hapticTap } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The person at the top of a direct chat's info: their photo (with the green dot while they are active), name, @username
 * and one more line (their university). Tapping it opens their profile. Without `onPress` (a deleted account) it is
 * just a picture and a name.
 */
export function InfoPersonCard({ name, username, detail, avatarUrl, userId, onPress }: { name: string; username?: string | null; detail?: string | null; avatarUrl?: string | null; userId?: string; onPress?: () => void }) {
  const styles = useStyles();
  const content = (
    <>
      <Avatar name={name} url={avatarUrl} size="xl" userId={userId} />
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      {username ? (
        <Text style={styles.handle} numberOfLines={1}>
          @{username}
        </Text>
      ) : null}
      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.card}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={username ? `${name}, @${username}` : name}
      accessibilityHint="Opens their profile"
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
}

/** The top of a group's info: the group mark, its name and how many people are in it. */
export function InfoGroupCard({ name, memberCount }: { name: string; memberCount: number }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.card}>
      <View style={styles.groupMark}>
        <Ionicons name="people" size={44} color={colors.brand} />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      <Text style={styles.handle}>{memberCount === 1 ? "Group · 1 member" : `Group · ${memberCount} members`}</Text>
    </View>
  );
}

export type InfoButton = { key: string; label: string; icon: IconName; onPress: () => void };

/** The row of round buttons under the card (Profile, Search, Share), Messenger style: a grey circle with the icon, the label under it. */
export function InfoButtons({ buttons }: { buttons: InfoButton[] }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.buttons}>
      {buttons.map((b) => (
        <Pressable
          key={b.key}
          onPress={() => {
            hapticTap();
            b.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          hitSlop={4}
          style={styles.button}
        >
          {({ pressed }) => (
            <>
              <View style={[styles.circle, pressed && { backgroundColor: colors.border }]}>
                <Ionicons name={b.icon} size={22} color={colors.text} />
              </View>
              <Text style={styles.buttonLabel} numberOfLines={1}>
                {b.label}
              </Text>
            </>
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** A section heading ("Members", "Shared"), with an optional count after it. */
export function InfoSectionTitle({ title, count }: { title: string; count?: number }) {
  const styles = useStyles();
  return (
    <Text style={styles.section} accessibilityRole="header">
      {title}
      {count !== undefined ? <Text style={styles.sectionCount}>{`  ${count}`}</Text> : null}
    </Text>
  );
}

/** One member of a group: photo, name ("You" beside your own) and a chevron; tapping opens the profile. */
export function InfoMemberRow({ member, isMe, onPress }: { member: ProfileSummary; isMe: boolean; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isMe ? `${member.full_name}, you` : member.full_name}
      accessibilityHint="Opens their profile"
      style={({ pressed }) => [styles.member, pressed && { backgroundColor: colors.input }]}
    >
      <Avatar name={member.full_name} url={member.avatar_url} size="md" userId={member.id} />
      <Text style={styles.memberName} numberOfLines={1}>
        {member.full_name}
      </Text>
      {isMe ? <Text style={styles.memberTag}>You</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

export type InfoListAction = { key: string; label: string; icon: IconName; tone?: "danger" | "brand"; onPress: () => void; busy?: boolean; disabled?: boolean };

/**
 * The actions at the bottom of the info screen (Block, Report, Leave group) as one rounded group of rows: red for what
 * blocks, reports or leaves; blue for the way back (Unblock). A row shows a spinner while its action is on its way.
 */
export function InfoActionList({ actions }: { actions: InfoListAction[] }) {
  const styles = useStyles();
  const colors = useColors();
  if (actions.length === 0) return null;
  return (
    <View style={styles.list}>
      {actions.map((a, i) => {
        const tint = a.tone === "brand" ? colors.brand : colors.red;
        const off = Boolean(a.disabled || a.busy);
        return (
          <Pressable
            key={a.key}
            onPress={a.onPress}
            disabled={off}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled: off, busy: Boolean(a.busy) }}
            style={({ pressed }) => [styles.listRow, i > 0 && styles.listDivider, pressed && { backgroundColor: colors.input }, a.disabled && !a.busy && { opacity: 0.5 }]}
          >
            <View style={styles.listIcon}>{a.busy ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name={a.icon} size={21} color={tint} />}</View>
            <Text style={[styles.listLabel, { color: tint }]} numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.md, gap: 4 },
  name: { fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center", marginTop: space.md },
  handle: { fontSize: 15, color: colors.muted, textAlign: "center" },
  detail: { fontSize: 13, color: colors.faint, textAlign: "center" },
  groupMark: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  buttons: { flexDirection: "row", justifyContent: "center", gap: space.lg, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  button: { width: 76, alignItems: "center", gap: 6 },
  circle: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: 12, fontWeight: "600", color: colors.text },
  section: { fontSize: 17, fontWeight: "800", color: colors.text, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  sectionCount: { fontSize: 15, fontWeight: "600", color: colors.muted },
  member: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8 },
  memberName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  memberTag: { fontSize: 13, color: colors.muted },
  list: { marginHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
  listDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  listIcon: { width: 24, alignItems: "center" },
  listLabel: { flex: 1, fontSize: 16, fontWeight: "600" },
}));
