import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ConversationSummary } from "@apartment-book/shared";
import { Avatar } from "@/components/avatar";
import { GlassIconButton } from "@/components/glass";
import { Icon } from "@/components/icon";
import { ProgressiveBlur } from "@/components/progressive-blur";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** Back, in a glass circle: the system's 44pt touch target. */
const BUTTON = 44;
/** The three actions on the right (Audio call, Video call, Info): a touch smaller, so a long name keeps its room. */
const ACTION = 40;
/** The person's photo beside their name. */
const AVATAR = 38;

/**
 * A chat's floating top bar, in one row: Back in a glass circle on the left, then who the chat is with (their photo,
 * with the green dot while they are active, their name with a chevron and their activity line under it; a group shows
 * its mark and member count), and Audio call, Video call and Info in glass circles on the right (Search is in the chat's
 * details, with everything else about the chat). The photo and the name open the chat's details, as Info does. Nothing solid behind it: the messages scroll under it through a blur that fades in towards the
 * top of the screen, so the clock always has something quiet behind it. `onHeight` tells the chat how much of the list
 * it covers.
 */
export function ChatHeader({
  conversation,
  subtitle,
  activeNow,
  keepSubtitleRoom,
  onBack,
  onOpenInfo,
  onAudioCall,
  onVideoCall,
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
  /** The call buttons; left out (a chat you cannot call in, e.g. one that blocked you), the bar shows Info alone. */
  onAudioCall?: () => void;
  onVideoCall?: () => void;
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
        {/* The blur reaches well past the bar, so no line shows where it ends; the wash on top keeps the clock and the
            name clear over any photo. */}
        <ProgressiveBlur edge="top" height={height + 40} intensity={60} tint={isDark ? "dark" : "light"} />
        <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: `linear-gradient(to bottom, ${colors.glass} 0%, ${colors.floatFill} 60%, transparent 100%)` }]} />
      </View>
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + 6 }]}>
        <GlassIconButton icon="chevron-back" label="Back" variant="float" size={BUTTON} iconSize={22} weight="medium" haptic={false} onPress={onBack} />
        {conversation ? (
          <Pressable
            onPress={onOpenInfo}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}. Chat details`}
            style={({ pressed }) => [styles.identity, pressed && { opacity: 0.7 }]}
          >
            {conversation.business ? (
              <Avatar name={conversation.business.name} url={conversation.business.logo_url} size={AVATAR} online={false} ringColor={colors.bg} />
            ) : isGroup ? (
              <View style={styles.groupAvatar}>
                <Icon name="people" size={18} color={colors.brand} />
              </View>
            ) : (
              <Avatar name={other?.full_name} url={other?.avatar_url} size={AVATAR} online={activeNow} ringColor={colors.bg} />
            )}
            <View style={styles.text}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {title}
                </Text>
                <Icon name="chevron-forward" size={13} color={colors.muted} weight="semibold" />
              </View>
              {subtitle ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : keepSubtitleRoom ? (
                <Text style={styles.sub}> </Text>
              ) : null}
            </View>
          </Pressable>
        ) : (
          <View style={styles.identity} />
        )}
        {conversation ? (
          <View style={styles.actions}>
            {onAudioCall ? <GlassIconButton icon="call" label="Audio call" variant="float" size={ACTION} iconSize={19} weight="medium" onPress={onAudioCall} /> : null}
            {onVideoCall ? <GlassIconButton icon="videocam" label="Video call" variant="float" size={ACTION} iconSize={21} weight="medium" onPress={onVideoCall} /> : null}
            <GlassIconButton icon="information-circle-outline" label="Chat details" variant="float" size={ACTION} iconSize={22} weight="medium" onPress={onOpenInfo} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingBottom: 12 },
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  groupAvatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  text: { flexShrink: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: "700", color: colors.text },
  sub: { fontSize: 13, lineHeight: 17, color: colors.muted },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
}));
