import { type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { compactCount, type FollowStats, type ProfileWithUniversity } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { radius, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";

/** Height of the pills beside the photo (Edit profile, Follow, Message…) and of the round Share button. */
export const PROFILE_BUTTON_HEIGHT = 40;
/** The row of round buttons floating at the top of a profile, under the status bar: Back or Find friends, the menu. */
export const PROFILE_BAR_ROW_HEIGHT = 44;
/** How much of the cover shows under the status bar. */
const COVER_HEIGHT = 112;
const AVATAR_SIZE = 84;
/** The ring the photo wears, in the screen's colour, where it hangs over the cover's bottom edge. */
const AVATAR_RING = 3;
const AVATAR_OUTER = AVATAR_SIZE + AVATAR_RING * 2;
/** How far the photo hangs over the cover's bottom edge. */
const AVATAR_OVERLAP = 42;
const COVER_BUTTON = 38;

/** The @handle, when the profile has one (profiles read before the username column existed have none). */
export function profileHandle(profile: ProfileWithUniversity): string | null {
  const name: unknown = profile.username;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export type CoverAction = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };

/**
 * A translucent round button floating on the cover: Back or Find friends at the left, the menu (a gear) or More at the
 * right. The same fill over the cover and, once the cover has scrolled away, over the bar.
 */
export function CoverButton({ icon, label, onPress }: CoverAction) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.coverButton, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

/**
 * The bar that floats over the top of a profile, under the status bar: the round buttons at its ends (`left` for Back on a
 * stacked profile or Find friends on your own tab; `right` for the menu and More) sit straight on the cover, and the bar's
 * own background and the person's name fade in (`opacity`, from the pager, on the UI thread) as the cover scrolls away,
 * so the tabs row that sticks under it has an opaque bar above it. Only the buttons take touches: a drag or a tap anywhere
 * else goes through to the page.
 */
export function ProfileFloatingBar({ topInset, name, left, right, opacity }: { topInset: number; name: string; left?: CoverAction | null; right?: CoverAction[]; opacity: Animated.AnimatedInterpolation<number> | number }) {
  const styles = useStyles();
  return (
    <View pointerEvents="box-none" style={[styles.floatBar, { height: topInset + PROFILE_BAR_ROW_HEIGHT }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.floatBg, { opacity }]} />
      <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.floatTitle, { top: topInset, opacity }]}>
        <Text style={styles.floatName} numberOfLines={1}>
          {name}
        </Text>
      </Animated.View>
      <View pointerEvents="box-none" style={[styles.floatRow, { top: topInset }]}>
        {left ? <CoverButton {...left} /> : <View style={styles.coverButtonSpace} />}
        <View pointerEvents="none" style={{ flex: 1 }} />
        {(right ?? []).map((action) => (
          <CoverButton key={action.label} {...action} />
        ))}
      </View>
    </View>
  );
}

/** A grey pill beside the photo: Edit profile, Message. */
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

/** The round grey button beside the pills: Share profile on your own profile. */
export function HeaderIconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.button, styles.round, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

/**
 * The top of a profile: the cover band (a soft gradient under the status bar), the round photo hanging over its bottom
 * edge (yours with a blue "+" to change it) with the buttons (`actions`) beside it, then the name (on your own tab, with a
 * chevron: the account sheet), "@username" with a QR icon, a chip with the university and the program · class year, the
 * bio, and a rounded card with Posts | Followers | Following | Likes. `topInset` is the status bar's height, which the
 * cover runs under.
 */
export function ProfileHeader({
  profile,
  own,
  follow,
  likes,
  posts,
  topInset,
  onOpenFollows,
  onShowQr,
  onChangePhoto,
  changingPhoto,
  onAccount,
  actions,
}: {
  profile: ProfileWithUniversity;
  own: boolean;
  follow: FollowStats;
  likes: number;
  posts: number;
  topInset: number;
  onOpenFollows: (kind: "followers" | "following") => void;
  onShowQr: () => void;
  onChangePhoto?: () => void;
  changingPhoto?: boolean;
  /** Your own tab: the name opens the account sheet (the signed-in email, Log out). */
  onAccount?: () => void;
  actions: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const handle = profileHandle(profile);
  const school = profile.university?.name ?? null;
  const study = [profile.program, profile.graduation_year ? `'${String(profile.graduation_year).slice(-2)}` : null].filter(Boolean).join(" · ");
  // No fade-in: every profile tab draws its own copy of this header, and a copy appearing mid-swipe must match the others at once.
  const photo = <Avatar transition={0} name={profile.full_name} url={profile.avatar_url} size={AVATAR_SIZE} userId={own ? undefined : profile.id} online={own ? false : undefined} />;
  const name = (
    <Text style={styles.name} numberOfLines={2} accessibilityRole={onAccount ? undefined : "header"}>
      {profile.full_name}
    </Text>
  );
  return (
    <View style={styles.header}>
      <View style={[styles.cover, { height: topInset + COVER_HEIGHT }]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, styles.coverBase]} />
        <View style={[StyleSheet.absoluteFill, styles.coverGlowA]} />
        <View style={[StyleSheet.absoluteFill, styles.coverGlowB]} />
      </View>

      <View style={styles.headRow}>
        <View style={styles.avatarRing}>
          {own && onChangePhoto ? (
            <Pressable onPress={onChangePhoto} disabled={changingPhoto} accessibilityRole="button" accessibilityLabel="Change profile photo" accessibilityState={{ busy: Boolean(changingPhoto) }} style={({ pressed }) => pressed && { opacity: 0.85 }}>
              {photo}
              {changingPhoto ? (
                <View style={styles.photoBusy}>
                  <ActivityIndicator color={colors.onMedia} />
                </View>
              ) : null}
              <View style={styles.plus}>
                <Ionicons name="add" size={16} color={colors.onBrand} />
              </View>
            </Pressable>
          ) : (
            photo
          )}
        </View>
        <View style={styles.actions}>{actions}</View>
      </View>

      <View style={styles.info}>
        {onAccount ? (
          <Pressable onPress={onAccount} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${profile.full_name}, account options`} style={({ pressed }) => [styles.nameRow, pressed && { opacity: 0.6 }]}>
            {name}
            <Ionicons name="chevron-down" size={16} color={colors.muted} style={styles.nameChevron} />
          </Pressable>
        ) : (
          <View style={styles.nameRow}>{name}</View>
        )}
        {handle ? (
          <View style={styles.handleRow}>
            <Text style={styles.handle} numberOfLines={1}>
              @{handle}
            </Text>
            <Pressable onPress={onShowQr} hitSlop={10} accessibilityRole="button" accessibilityLabel="Show profile QR code" style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Ionicons name="qr-code-outline" size={14} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        {school || study ? (
          <View style={styles.chipRow}>
            {school ? (
              <View style={styles.chip}>
                <Ionicons name="school-outline" size={13} color={colors.muted} />
                <Text style={styles.chipText} numberOfLines={1}>
                  {school}
                </Text>
              </View>
            ) : null}
            {study ? (
              <Text style={styles.study} numberOfLines={2}>
                {study}
              </Text>
            ) : null}
          </View>
        ) : null}

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <View style={styles.stats}>
          <Stat n={posts} label={posts === 1 ? "Post" : "Posts"} />
          <Stat n={follow.followers} label={follow.followers === 1 ? "Follower" : "Followers"} onPress={() => onOpenFollows("followers")} />
          <Stat n={follow.following} label="Following" onPress={() => onOpenFollows("following")} />
          <Stat n={likes} label={likes === 1 ? "Like" : "Likes"} />
        </View>
      </View>
    </View>
  );
}

/** Bold number over a grey word; Followers and Following open the owner's lists (anyone else's mutual friends). Read out as "243 Followers". */
function Stat({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6} accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={`${n} ${label}`} style={({ pressed }) => [styles.stat, pressed && { opacity: 0.6 }]}>
      <Text style={styles.statNumber} numberOfLines={1}>
        {compactCount(n)}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { backgroundColor: colors.bg },
  // The cover: a vertical fade from its top colour into the screen, with a violet glow from the top left and a teal one from
  // the top right, drawn as real gradients (no seams, no images to load).
  cover: { width: "100%", overflow: "hidden", backgroundColor: colors.coverTop },
  coverBase: { experimental_backgroundImage: `linear-gradient(180deg, ${colors.coverTop} 0%, ${colors.coverTop} 35%, ${colors.bg} 100%)` },
  coverGlowA: { experimental_backgroundImage: `linear-gradient(150deg, ${colors.coverGlowA} 0%, transparent 52%)` },
  coverGlowB: { experimental_backgroundImage: `linear-gradient(235deg, ${colors.coverGlowB} 0%, transparent 46%)` },
  // The floating bar over the cover: transparent until the cover scrolls away, then the screen's bar colour with a hairline.
  floatBar: { position: "absolute", top: 0, left: 0, right: 0 },
  floatBg: { backgroundColor: colors.bar, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  floatTitle: { position: "absolute", left: 60, right: 60, height: PROFILE_BAR_ROW_HEIGHT, alignItems: "center", justifyContent: "center" },
  floatName: { fontSize: 17, fontWeight: "800", color: colors.text },
  floatRow: { position: "absolute", left: 0, right: 0, height: PROFILE_BAR_ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  coverButton: { width: COVER_BUTTON, height: COVER_BUTTON, borderRadius: COVER_BUTTON / 2, backgroundColor: colors.coverButton, alignItems: "center", justifyContent: "center" },
  coverButtonSpace: { width: COVER_BUTTON, height: COVER_BUTTON },
  // The photo hangs over the cover's bottom edge; the buttons sit beside it, level with its lower half.
  headRow: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: space.lg, marginTop: -AVATAR_OVERLAP, gap: space.md },
  avatarRing: { width: AVATAR_OUTER, height: AVATAR_OUTER, borderRadius: AVATAR_OUTER / 2, padding: AVATAR_RING, backgroundColor: colors.bg },
  photoBusy: { position: "absolute", top: 0, left: 0, width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.mediaScrim, alignItems: "center", justifyContent: "center" },
  // The ring is the screen's own colour (the profile sits on bg), cutting the badge out of the photo.
  plus: { position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, borderWidth: 2.5, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  actions: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm, paddingBottom: 6 },
  button: { height: PROFILE_BUTTON_HEIGHT, borderRadius: radius.pill, backgroundColor: colors.input, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, flexShrink: 1 },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.text },
  round: { width: PROFILE_BUTTON_HEIGHT, paddingHorizontal: 0, flexShrink: 0 },
  info: { paddingHorizontal: space.lg },
  nameRow: { marginTop: space.sm, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%" },
  name: { fontSize: 22, fontWeight: "800", color: colors.text, flexShrink: 1 },
  nameChevron: { marginLeft: 4, marginTop: 3 },
  handleRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  handle: { fontSize: 14, color: colors.muted, flexShrink: 1 },
  chipRow: { marginTop: 10, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.input, maxWidth: "100%" },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.muted, flexShrink: 1 },
  study: { fontSize: 14, color: colors.text, flexShrink: 1 },
  bio: { marginTop: 10, fontSize: 15, lineHeight: 20, color: colors.text },
  // The card with the numbers: a soft panel with four columns.
  stats: { marginTop: 14, flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderRadius: 18, backgroundColor: colors.panel },
  stat: { flex: 1, alignItems: "center", gap: 1, paddingHorizontal: 2 },
  statNumber: { fontSize: 17, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: 13, color: colors.muted },
}));
