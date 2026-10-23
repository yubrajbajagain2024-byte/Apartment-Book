import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { GlassBackdrop, GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The round buttons' size, and the photo's. */
const BUTTON = 40;
const AVATAR = 48;

/**
 * A chat's floating top bar, laid out like the Messages app's: Back in a glass circle on the left, the other person's
 * photo (or the group mark) in the middle with their name in a glass pill under it (a chevron says it opens the chat's
 * details, as does the photo), their activity line under that, and Search and Info in glass circles on the right.
 * Nothing solid behind it: the messages scroll under it, softened by a blur that fades in towards the top of the screen,
 * so the clock always has something quiet behind it. `onHeight` tells the chat how much of the list it covers.
 */
export function ChatHeader({
  conversation,
  subtitle,
  activeNow,
  keepSubtitleRoom,
  onBack,
  onOpenInfo,
  onOpenSearch,
  onHeight,
}: {
  conversation: ConversationSummary | null;
  /** "Active now", "Active 5 min ago" or "4 members"; "" for nothing. */
  subtitle: string;
  activeNow: boolean;
  /** Nothing to show yet, but maybe in a moment: the line keeps its place, so the name does not jump. */
  keepSubtitleRoom: boolean;
  onBack: () => void;
  onOpenInfo: () => void;
  onOpenSearch: () => void;
  onHeight: (height: number) => void;
}) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const other = conversation?.otherMembers[0];
  const isGroup = conversation?.type === "group";
  const title = conversation?.title ?? "";

  function measured(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h === height) return;
    setHeight(h);
    onHeight(h);
  }

  return (
    <View pointerEvents="box-none" style={styles.header} onLayout={measured}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* The blur reaches well past the bar, so the activity line still sits on frosted glass and no line shows where
            it ends; the wash on top keeps the clock and the name clear over any photo. */}
        <ProgressiveBlur edge="top" height={height + 44} intensity={60} tint={isDark ? "dark" : "light"} />
        <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: `linear-gradient(to bottom, ${colors.glass} 0%, ${colors.floatFill} 55%, transparent 100%)` }]} />
      </View>
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + 2 }]}>
        <View style={styles.side}>
          <GlassIconButton icon="chevron-back" label="Back" variant="float" size={BUTTON} iconSize={21} weight="semibold" haptic={false} onPress={onBack} />
        </View>
        <View pointerEvents="box-none" style={styles.center}>
          {conversation ? (
            <>
              <Pressable onPress={onOpenInfo} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${title}. Chat details`} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
                {isGroup ? (
                  <View style={styles.groupAvatar}>
                    <Icon name="people" size={22} color={colors.brand} />
                  </View>
                ) : (
                  <Avatar name={other?.full_name} url={other?.avatar_url} size={AVATAR} userId={other?.id} ringColor={colors.bg} />
                )}
              </Pressable>
              <Pressable
                onPress={onOpenInfo}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}. Chat details`}
                style={({ pressed }) => [styles.pill, { borderColor: colors.glassEdge }, pressed && { opacity: 0.8 }]}
              >
                <GlassBackdrop variant="float" radius={15} interactive />
                <Text style={styles.name} numberOfLines={1}>
                  {title}
                </Text>
                <Icon name="chevron-forward" size={11} color={colors.muted} weight="bold" />
              </Pressable>
              {subtitle ? (
                <View style={styles.subRow}>
                  {activeNow ? <View style={[styles.activeDot, { backgroundColor: colors.green }]} /> : null}
                  <Text style={[styles.sub, activeNow && { color: colors.successText }]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
              ) : keepSubtitleRoom ? (
                <Text style={styles.sub}> </Text>
              ) : null}
            </>
          ) : null}
        </View>
        <View style={[styles.side, styles.right]}>
          {conversation ? (
            <>
              <GlassIconButton icon="search" label="Search in this chat" variant="float" size={BUTTON} iconSize={19} weight="semibold" onPress={onOpenSearch} />
              <GlassIconButton icon="information-circle-outline" label="Chat details" variant="float" size={BUTTON} iconSize={21} onPress={onOpenInfo} />
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 12, paddingBottom: 10 },
  side: { width: BUTTON * 2 + 8, flexDirection: "row", alignItems: "center", gap: 8 },
  right: { justifyContent: "flex-end" },
  center: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: 4 },
  groupAvatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, height: 30, maxWidth: "100%", paddingLeft: 12, paddingRight: 9, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  name: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: colors.text },
  subRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: -2 },
  sub: { fontSize: 12, lineHeight: 16, color: colors.muted },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
}));
