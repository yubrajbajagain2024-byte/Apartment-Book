import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";
import { Image } from "expo-image";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { SFSymbol } from "expo-symbols";
import { AuroraPanel } from "@/components/aurora";
import { Avatar } from "@/components/avatar";
import { Icon, type IconName } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import { useReduceMotion } from "@/lib/accessibility";
import { clock, type UploadStatus } from "@/lib/compose-media";
import type { ComposeMedia } from "@/lib/compose-store";
import { hapticSelect } from "@/lib/haptics";
import { auroraGradient } from "@/lib/theme";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** The listing flow's steps after the camera, in order: what the progress bar names. */
export const LISTING_STEPS = ["Photos", "Details", "Listing", "Preview"] as const;
const TILE_MOVE = LinearTransition.springify().damping(30).stiffness(320);

/**
 * Where the listing flow is: four slim capsules under the screen's title (photos, details, the listing, the preview),
 * done ones in the Aurora, with the step's name and "2 of 4". Only the step being arrived at fills, once, as it opens.
 */
export function StepProgress({ step }: { step: 2 | 3 | 4 }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const fill = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) fill.value = withTiming(1, { duration: 420 });
  }, [fill, reduceMotion]);
  const filling = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of 4: ${LISTING_STEPS[step - 1]}`}>
      <View style={styles.track}>
        {LISTING_STEPS.map((name, i) => (
          <View key={name} style={styles.segment}>
            {i + 1 < step ? <View style={[styles.segmentFill, { width: "100%", experimental_backgroundImage: auroraGradient(colors.aurora, 90) }]} /> : null}
            {i + 1 === step ? <Animated.View style={[styles.segmentFill, { experimental_backgroundImage: auroraGradient(colors.aurora, 90) }, filling]} /> : null}
          </View>
        ))}
      </View>
      <View style={styles.progressWords}>
        <Text style={styles.progressName}>{LISTING_STEPS[step - 1]}</Text>
        <Text style={styles.progressCount}>
          {step} of {LISTING_STEPS.length}
        </Text>
      </View>
    </View>
  );
}

/** A thumbnail's upload: a thin bar while it goes, a retry if it failed, nothing once it is up. */
function UploadMark({ status, onRetry }: { status?: UploadStatus; onRetry: () => void }) {
  const styles = useStyles();
  if (!status || status.phase === "done") return null;
  if (status.phase === "failed") {
    return (
      <Pressable onPress={onRetry} hitSlop={8} style={styles.mark} accessibilityRole="button" accessibilityLabel="Upload failed, try again">
        <Icon name="refresh-outline" sf="arrow.clockwise" size={14} weight="bold" color="#fff" />
      </Pressable>
    );
  }
  return (
    <Animated.View exiting={FadeOut.duration(220)} style={styles.markBar} accessibilityLabel={status.phase === "processing" ? "Processing" : `Uploading ${Math.round(status.progress * 100)}%`}>
      <View style={[styles.markFill, { width: `${Math.max(6, (status.phase === "processing" ? 1 : status.progress) * 100)}%` }]} />
    </Animated.View>
  );
}

/** The listing's pictures in a row (the first marked Cover), tap to edit, + to add more; or one wide "Add photos" tile. */
export function MediaRow({ media, uploads, canAdd, onOpen, onAdd, onRetry, emptyHint }: { media: ComposeMedia[]; uploads: Record<string, UploadStatus>; canAdd: boolean; onOpen: (m: ComposeMedia) => void; onAdd: () => void; onRetry: (m: ComposeMedia) => void; emptyHint: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  if (media.length === 0) {
    return (
      <Pressable onPress={onAdd} style={({ pressed }) => [styles.addWide, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add photos or a video">
        <View style={styles.addWideIcon}>
          <Icon name="images-outline" sf="photo.on.rectangle.angled" size={22} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.addWideTitle}>Add photos or a video</Text>
          <Text style={styles.addWideHint}>{emptyHint}</Text>
        </View>
        <Icon name="chevron-forward" size={16} weight="semibold" color={colors.faint} />
      </Pressable>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.media}>
      {media.map((m, i) => (
        <Animated.View key={m.id} entering={reduceMotion ? undefined : FadeIn.duration(180)} layout={reduceMotion ? undefined : TILE_MOVE}>
          <Pressable onPress={() => onOpen(m)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={m.kind === "video" ? "Video, choose its cover" : `Photo ${i + 1}, edit`}>
            <Image source={{ uri: m.kind === "video" ? (m.thumbUri ?? undefined) : m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            <View style={styles.tileShade} />
            {i === 0 ? (
              <View style={styles.coverTag}>
                <Text style={styles.coverText}>Cover</Text>
              </View>
            ) : null}
            {m.kind === "video" ? (
              <View style={styles.tileFoot}>
                <Text style={styles.tileFootText}>Edit cover</Text>
                <Text style={styles.tileFootText}>{clock(m.duration)}</Text>
              </View>
            ) : null}
            <UploadMark status={uploads[m.id]} onRetry={() => onRetry(m)} />
          </Pressable>
        </Animated.View>
      ))}
      {canAdd ? (
        <Pressable onPress={onAdd} style={({ pressed }) => [styles.addTile, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Add more photos or a video">
          <Icon name="add" size={30} weight="regular" color={colors.text} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/**
 * Post as: your name and profile, or Anonymous. Anonymous is explained right where it is chosen, plainly: what nobody
 * will see, that people can still write, and that showing who you are is a choice made one chat at a time.
 */
export function IdentitySheet({ visible, anonymous, name, avatarUrl, noun, onClose, onChange }: { visible: boolean; anonymous: boolean; name: string; avatarUrl: string | null; noun: string; onClose: () => void; onChange: (anonymous: boolean) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const choices: { value: boolean; title: string; hint: string; avatar: ReactNode }[] = [
    { value: false, title: name || "Your name", hint: `Your name and profile show on the ${noun}.`, avatar: <Avatar name={name} url={avatarUrl} size={38} online={false} /> },
    { value: true, title: "Anonymous", hint: "Nobody can tell it's yours.", avatar: <Avatar name="Anonymous" size={38} anonymous /> },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close post as" draggable="sheet">
      <SheetHeader title="Post as" />
      <View style={styles.list} accessibilityRole="radiogroup">
        {choices.map((c) => {
          const on = c.value === anonymous;
          return (
            <Pressable
              key={String(c.value)}
              onPress={() => {
                if (!on) hapticSelect();
                onChange(c.value);
              }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.input }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${c.title}. ${c.hint}`}
            >
              {c.avatar}
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{c.title}</Text>
                <Text style={styles.optionHint}>{c.hint}</Text>
              </View>
              <View style={[styles.radio, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on ? <Icon name="checkmark" size={13} weight="bold" color={colors.onBrand} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      <AuroraPanel style={styles.explainer}>
        <Text style={styles.explainerTitle}>How anonymous posting works</Text>
        <Pledge icon="eye-off-outline" sf="eye.slash" text={`Your name, photo and profile never appear on the ${noun}, its photos or its link.`} />
        <Pledge icon="chatbubble-ellipses-outline" sf="bubble.left.and.bubble.right" text="People can still message you. You'll see who they are; they won't see you." />
        <Pledge icon="person-circle-outline" sf="person.crop.circle.badge.checkmark" text="In any chat, you can show that one person who you are. Nobody else will know." />
        <Pledge icon="shield-checkmark-outline" sf="checkmark.shield" text="Our safety team can still act on reports, so be kind." />
      </AuroraPanel>
      <SheetFooter>
        <Button title="Done" size="large" onPress={onClose} />
      </SheetFooter>
    </Sheet>
  );
}

function Pledge({ icon, sf, text }: { icon: IconName; sf: SFSymbol; text: string }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={styles.promise}>
      <Icon name={icon} sf={sf} size={18} color={colors.auroraInk} />
      <Text style={styles.promiseText}>{text}</Text>
    </View>
  );
}

/**
 * An inset group of rows, iOS Settings' way: a small title over a rounded card, and a footnote or an error under it.
 * `bare`: no card (a segmented control, which is its own grey track).
 */
export function Group({ title, footer, error, bare = false, children }: { title?: string; footer?: string | null; error?: string | null; bare?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      {bare ? children : <View style={[styles.groupCard, error ? styles.groupCardError : null]}>{children}</View>}
      {error ? (
        <Animated.Text entering={FadeIn.duration(160)} style={styles.groupError}>
          {error}
        </Animated.Text>
      ) : footer ? (
        <Text style={styles.groupFooter}>{footer}</Text>
      ) : null}
    </View>
  );
}

/** A hairline between two rows of a group, inset like iOS's. */
export function RowDivider() {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

/** A label and a field on one row, the value at the right with its "$" beside it: "From  $400". The whole row focuses it. */
export function FieldRow({ label, prefix, suffix, error, ...input }: TextInputProps & { label: string; prefix?: string; suffix?: string; error?: boolean }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const field = useRef<TextInputInstance>(null);
  return (
    <Pressable onPress={() => field.current?.focus()} style={styles.row} accessible={false}>
      <Text style={[styles.rowLabel, error && { color: colors.red }]}>{label}</Text>
      <View style={styles.rowField}>
        {prefix ? <Text style={[styles.affix, input.value ? { color: colors.text } : null]}>{prefix}</Text> : null}
        <TextInput ref={field} placeholderTextColor={colors.faint} keyboardAppearance={isDark ? "dark" : "light"} style={styles.rowInput} accessibilityLabel={label} {...input} />
        {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A label and a switch. */
export function SwitchRow({ label, icon, sf, value, onChange }: { label: string; icon?: IconName; sf?: SFSymbol; value: boolean; onChange: (on: boolean) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      {icon ? <Icon name={icon} sf={sf} size={19} color={colors.muted} /> : null}
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={(on) => {
          hapticSelect();
          onChange(on);
        }}
        trackColor={{ true: colors.brand, false: colors.border }}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Choices as a wrap of capsules (a sleep schedule, a category): tap one to choose it, again to clear it when allowed. */
export function ChoiceChips<T extends string>({ options, value, onChange, clearable = true, icons }: { options: readonly { value: T; label: string }[]; value: string; onChange: (value: T | "") => void; clearable?: boolean; icons?: (value: T) => IconName }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              hapticSelect();
              onChange(on && clearable ? "" : o.value);
            }}
            style={({ pressed }) => [styles.chip, on && { backgroundColor: colors.brandSoft, borderColor: colors.brand }, pressed && { opacity: 0.7 }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            {icons ? <Icon name={icons(o.value)} size={15} color={on ? colors.brand : colors.muted} /> : null}
            <Text style={[styles.chipText, on && { color: colors.brand }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
};

/**
 * A date, the system's way: on iOS the compact date button right in the row (tap for the calendar), with a clear
 * button; elsewhere a row that opens the system's date dialog. "" is no date: the row offers "Add".
 */
export function DateRow({ label, value, onChange, error }: { label: string; value: string; onChange: (iso: string) => void; error?: boolean }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const [today] = useState(() => new Date());
  const set = (d: Date | undefined) => d && onChange(toIso(d));
  const open = () => {
    if (Platform.OS === "android") DateTimePickerAndroid.open({ value: value ? fromIso(value) : today, mode: "date", minimumDate: today, onChange: (_e, d) => set(d) });
    else onChange(toIso(today));
  };
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }, error && { color: colors.red }]}>{label}</Text>
      {value && Platform.OS === "ios" ? (
        <>
          <DateTimePicker value={fromIso(value)} mode="date" display="compact" minimumDate={today} onChange={(_e, d) => set(d)} themeVariant={isDark ? "dark" : "light"} accentColor={colors.brand} accessibilityLabel={label} />
          <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`}>
            <Icon name="close-circle" size={20} color={colors.faint} />
          </Pressable>
        </>
      ) : (
        <Pressable onPress={open} hitSlop={8} style={({ pressed }) => [styles.addDate, pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={styles.addDateText}>{value ? fromIso(value).toLocaleDateString() : "Add"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  progress: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 7 },
  track: { flexDirection: "row", gap: 5 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  segmentFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: colors.brand },
  progressWords: { flexDirection: "row", justifyContent: "space-between" },
  progressName: { fontSize: 13, fontWeight: "600", color: colors.text },
  progressCount: { fontSize: 13, color: colors.muted, fontVariant: ["tabular-nums"] },
  media: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 },
  tile: { width: 104, height: 138, borderRadius: 14, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.skeleton },
  tileShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 40, experimental_backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%)" },
  coverTag: { position: "absolute", top: 0, left: 0, paddingHorizontal: 9, paddingVertical: 4, borderBottomRightRadius: 10, backgroundColor: "rgba(0,0,0,0.55)" },
  coverText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tileFoot: { position: "absolute", left: 7, right: 7, bottom: 6, flexDirection: "row", justifyContent: "space-between" },
  tileFootText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  addTile: { width: 104, height: 138, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  addWide: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 8, padding: 14, borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.input },
  addWideIcon: { width: 44, height: 44, borderRadius: 12, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  addWideTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  addWideHint: { fontSize: 13, lineHeight: 17, color: colors.muted, marginTop: 1 },
  mark: { position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.red },
  markBar: { position: "absolute", left: 8, right: 8, bottom: 26, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  markFill: { height: 3, backgroundColor: "#fff" },
  list: { paddingVertical: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  optionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  optionHint: { fontSize: 13, lineHeight: 17, color: colors.muted, marginTop: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  explainer: { marginHorizontal: 16, marginBottom: 8, gap: 10, padding: 14 },
  explainerTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  promise: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  promiseText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text },
  group: { marginHorizontal: 16, marginTop: 18 },
  groupTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 7, marginLeft: 4 },
  groupCard: { borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.input, overflow: "hidden", borderWidth: 1, borderColor: "transparent" },
  groupCardError: { borderColor: colors.red },
  groupFooter: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 7, marginHorizontal: 4 },
  groupError: { fontSize: 13, lineHeight: 18, color: colors.red, marginTop: 7, marginHorizontal: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingHorizontal: 14 },
  rowLabel: { fontSize: 16, color: colors.text },
  rowField: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 1 },
  rowInput: { flexShrink: 1, minWidth: 24, textAlign: "right", fontSize: 16, color: colors.text, paddingVertical: 12 },
  affix: { fontSize: 16, color: colors.faint },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.text },
  addDate: { paddingHorizontal: 12, height: 32, borderRadius: 8, justifyContent: "center", backgroundColor: colors.bg },
  addDateText: { fontSize: 15, fontWeight: "600", color: colors.brand },
}));
