import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { compactCount, type FollowStats, type ProfileWithUniversity } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Height of the buttons under the numbers (Edit profile, Follow, Message…). */
export const PROFILE_BUTTON_HEIGHT = 40;

/** The @handle, when the profile has one (profiles read before the username column existed have none). */
export function profileHandle(profile: ProfileWithUniversity): string | null {
  const name: unknown = profile.username;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * TikTok's top bar on your own profile tab: Find friends on the left, your name with a small chevron in the middle (the
 * account sheet, with Log out), and the menu on the right. Sits under the status bar (`topInset`).
 */
export function ProfileTopBar({ name, topInset, onFindFriends, onAccount, onMenu }: { name: string; topInset: number; onFindFriends: () => void; onAccount: () => void; onMenu: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.topBar, { paddingTop: topInset }]}>
      <View style={styles.topRow}>
        <BarIcon icon="person-add-outline" label="Find friends" onPress={onFindFriends} />
        <Pressable onPress={onAccount} hitSlop={6} accessibilityRole="button" accessibilityLabel={name ? `${name}, account options` : "Account options"} style={({ pressed }) => [styles.topTitle, pressed && { opacity: 0.6 }]}>
          <Text style={styles.topName} numberOfLines={1}>
            {name}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.text} />
        </Pressable>
        <BarIcon icon="menu-outline" label="Menu" onPress={onMenu} />
      </View>
    </View>
  );
}

function BarIcon({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.barIcon, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={26} color={colors.text} />
    </Pressable>
  );
}

/** A light grey rounded button of the profile's button row: Edit profile, Share profile, Message. */
export function HeaderButton({ title, onPress, disabled, style }: { title: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: Boolean(disabled) }} style={({ pressed }) => [styles.button, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }, style]}>
      <Text style={styles.buttonText} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

/** The square grey button at the end of the row: Find friends on your profile, More on someone else's. */
export function HeaderIconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.button, styles.square, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

/**
 * The top of a profile, centred like TikTok: the round photo (yours with a blue "+" to change it), the name, "@username"
 * with a QR icon, Following | Followers | Likes, the button row (`actions`), the bio and a red pin with the university.
 */
export function ProfileHeader({
  profile,
  own,
  follow,
  likes,
  onOpenFollows,
  onShowQr,
  onChangePhoto,
  changingPhoto,
  actions,
}: {
  profile: ProfileWithUniversity;
  own: boolean;
  follow: FollowStats;
  likes: number;
  onOpenFollows: (kind: "followers" | "following") => void;
  onShowQr: () => void;
  onChangePhoto?: () => void;
  changingPhoto?: boolean;
  actions: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const handle = profileHandle(profile);
  const place = [profile.university?.name, profile.program, profile.graduation_year ? `'${String(profile.graduation_year).slice(-2)}` : null].filter(Boolean).join(" · ");
  // No fade-in: every profile tab draws its own copy of this header, and a copy appearing mid-swipe must match the others at once.
  const photo = <Avatar transition={0} name={profile.full_name} url={profile.avatar_url} size={96} userId={own ? undefined : profile.id} online={own ? false : undefined} />;
  return (
    <View style={styles.header}>
      {own && onChangePhoto ? (
        <Pressable onPress={onChangePhoto} disabled={changingPhoto} accessibilityRole="button" accessibilityLabel="Change profile photo" accessibilityState={{ busy: Boolean(changingPhoto) }} style={({ pressed }) => pressed && { opacity: 0.85 }}>
          {photo}
          {changingPhoto ? (
            <View style={styles.photoBusy}>
              <ActivityIndicator color={colors.onMedia} />
            </View>
          ) : null}
          <View style={styles.plus}>
            <Ionicons name="add" size={18} color={colors.onBrand} />
          </View>
        </Pressable>
      ) : (
        photo
      )}

      <Text style={styles.name} accessibilityRole="header">
        {profile.full_name}
      </Text>
      {handle ? (
        <View style={styles.handleRow}>
          <Text style={styles.handle} numberOfLines={1}>
            @{handle}
          </Text>
          <Pressable onPress={onShowQr} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show profile QR code" style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <Ionicons name="qr-code-outline" size={15} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat n={follow.following} label="Following" onPress={() => onOpenFollows("following")} />
        <View style={styles.divider} />
        <Stat n={follow.followers} label={follow.followers === 1 ? "Follower" : "Followers"} onPress={() => onOpenFollows("followers")} />
        <View style={styles.divider} />
        <Stat n={likes} label={likes === 1 ? "Like" : "Likes"} />
      </View>

      <View style={styles.actions}>{actions}</View>

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      {place ? (
        <View style={styles.place}>
          <Ionicons name="location" size={14} color={colors.red} />
          <Text style={styles.placeText} numberOfLines={2}>
            {place}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Bold number over a grey word; Following and Followers open their lists. Read out as "243 Followers". */
function Stat({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6} accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={`${n} ${label}`} style={({ pressed }) => [styles.stat, pressed && { opacity: 0.6 }]}>
      <Text style={styles.statNumber}>{compactCount(n)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  topBar: { backgroundColor: colors.bar },
  topRow: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 },
  topTitle: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: space.sm },
  topName: { fontSize: 17, fontWeight: "800", color: colors.text, flexShrink: 1 },
  barIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", paddingTop: space.md, paddingHorizontal: space.lg },
  photoBusy: { position: "absolute", top: 0, left: 0, width: 96, height: 96, borderRadius: 48, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
  // The ring is the screen's own colour (the profile sits on bg), cutting the badge out of the photo.
  plus: { position: "absolute", right: -1, bottom: -1, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, borderWidth: 2.5, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  name: { marginTop: space.md, fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center" },
  handleRow: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  handle: { fontSize: 15, color: colors.text, flexShrink: 1 },
  stats: { marginTop: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  stat: { minWidth: 86, alignItems: "center", paddingHorizontal: space.md, gap: 1 },
  statNumber: { fontSize: 17, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: 13, color: colors.muted },
  divider: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: colors.border },
  actions: { marginTop: space.lg, flexDirection: "row", gap: 6, width: "100%", maxWidth: 440 },
  button: { flex: 1, height: PROFILE_BUTTON_HEIGHT, borderRadius: radius.sm, backgroundColor: colors.input, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.text },
  square: { flex: 0, width: PROFILE_BUTTON_HEIGHT, paddingHorizontal: 0 },
  bio: { marginTop: space.md, fontSize: 14, lineHeight: 19, color: colors.text, textAlign: "center" },
  place: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "100%" },
  placeText: { fontSize: 13, color: colors.muted, flexShrink: 1, textAlign: "center" },
}));
