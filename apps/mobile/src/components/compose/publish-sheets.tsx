import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { POST_AUDIENCES, campusLabel, type PostAudience } from "@apartment-book/shared";
import { Icon, type IconName } from "@/components/icon";
import { Sheet, SheetFooter, SheetHeader } from "@/components/sheet";
import { Button } from "@/components/ui";
import { hapticSelect } from "@/lib/haptics";
import { makeStyles, useAppTheme } from "@/lib/theme-provider";

/** Each audience's symbol, the same in the sheet and on the publish screen's row. */
export const AUDIENCE_ICONS: Record<PostAudience, { icon: IconName; sf: SFSymbol }> = {
  campus: { icon: "school-outline", sf: "graduationcap" },
  global: { icon: "earth-outline", sf: "globe.americas" },
  friends: { icon: "people", sf: "person.2.fill" },
  selected: { icon: "person-circle-outline", sf: "person.crop.circle.badge.checkmark" },
};

/**
 * The publish screen's audience row, TikTok's "Everyone can view this post": "Texas State students can view this post",
 * "Everyone on UniBuzz can view this reel", "3 people can view this post".
 */
export function audienceSentence(audience: PostAudience, noun: string, campus: string | null, people: number): string {
  if (audience === "campus") return `${campus ? `${campusLabel(campus)} students` : "Your campus"} can view this ${noun}`;
  if (audience === "friends") return `Only friends can view this ${noun}`;
  if (audience === "selected") return people > 0 ? `${people} ${people === 1 ? "person" : "people"} can view this ${noun}` : `Choose who can view this ${noun}`;
  return `Everyone on UniBuzz can view this ${noun}`;
}

/** The address as typed, made a link: "unibuzz.app/x" gains https://, spaces around it go. Null when it can't be one. */
export function normalizeLink(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".") || /\s/.test(raw)) return null;
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

/** Add link: one address shown under the caption, opened in the in-app browser. */
export function LinkSheet({ visible, value, onClose, onSave }: { visible: boolean; value: string; onClose: () => void; onSave: (link: string) => void }) {
  const styles = useStyles();
  const { colors, isDark } = useAppTheme();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setText(value);
      setError(null);
    }
  }, [visible, value]);
  const save = () => {
    if (!text.trim()) return onSave("");
    const link = normalizeLink(text);
    if (!link) return setError("That doesn't look like a link. Try something like unibuzz.app/events.");
    onSave(link);
  };
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close add link" keyboard>
      <SheetHeader title="Add link" />
      <View style={styles.body}>
        <View style={[styles.field, error ? { borderColor: colors.red } : null]}>
          <Icon name="link-outline" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              setError(null);
            }}
            placeholder="Paste or type a link"
            placeholderTextColor={colors.faint}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            keyboardAppearance={isDark ? "dark" : "light"}
            clearButtonMode="while-editing"
            accessibilityLabel="Link"
            style={styles.input}
          />
        </View>
        <Text style={error ? styles.error : styles.hint}>{error ?? "Shown under your caption. People open it in UniBuzz's browser."}</Text>
      </View>
      <SheetFooter style={styles.footerRow}>
        {value ? (
          <View style={{ flex: 1 }}>
            <Button title="Remove" variant="secondary" size="large" onPress={() => onSave("")} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button title="Done" size="large" onPress={save} />
        </View>
      </SheetFooter>
    </Sheet>
  );
}

/**
 * Who can see it: the author's campus ("Texas State"), every campus (Global), friends only, or people picked one by one
 * (Selected people, which opens the picker). Enforced by the database, not just hidden in the app.
 */
export function AudienceSheet({ visible, value, noun, campus, people, onClose, onDismiss, onChange, onChoosePeople }: { visible: boolean; value: PostAudience; noun: string; campus: string | null; people: number; onClose: () => void; onDismiss?: () => void; onChange: (audience: PostAudience) => void; onChoosePeople: () => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={onDismiss} closeLabel="Close audience" draggable="sheet">
      <SheetHeader title={`Who can view this ${noun}`} />
      <View style={styles.list} accessibilityRole="radiogroup">
        {POST_AUDIENCES.map((a) => {
          const on = a.value === value;
          const noCampus = a.value === "campus" && !campus;
          const title = a.value === "campus" && campus ? campusLabel(campus) : a.label;
          const hint = a.value === "campus" ? (campus ? `Only students at ${campus}` : "Add your university to your profile to use this") : a.value === "selected" && people > 0 ? `${people} ${people === 1 ? "person" : "people"} chosen` : a.hint;
          return (
            <Pressable
              key={a.value}
              disabled={noCampus}
              onPress={() => {
                hapticSelect();
                if (a.value === "selected") onChoosePeople();
                else onChange(a.value);
              }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.input }, noCampus && { opacity: 0.45 }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: noCampus }}
              accessibilityLabel={`${title}. ${hint}`}
            >
              <View style={[styles.optionIcon, on && { backgroundColor: colors.brandSoft }]}>
                <Icon name={AUDIENCE_ICONS[a.value].icon} sf={AUDIENCE_ICONS[a.value].sf} size={20} color={on ? colors.brand : colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{title}</Text>
                <Text style={styles.optionHint}>{hint}</Text>
              </View>
              {a.value === "selected" ? (
                <View style={styles.selectedEnd}>
                  {on ? <View style={[styles.radio, { borderColor: colors.brand, backgroundColor: colors.brand }]}><Icon name="checkmark" size={13} weight="bold" color={colors.onBrand} /></View> : null}
                  <Icon name="chevron-forward" size={16} weight="semibold" color={colors.faint} />
                </View>
              ) : (
                <View style={[styles.radio, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on ? <Icon name="checkmark" size={13} weight="bold" color={colors.onBrand} /> : null}</View>
              )}
            </Pressable>
          );
        })}
        <Text style={[styles.hint, { paddingHorizontal: 16, paddingTop: 6 }]}>
          {value === "global" || value === "campus" ? "Anyone who can view it can share it into a chat with people who can view it too." : "Posts for friends or selected people can't be shared into chats."}
        </Text>
      </View>
      <SheetFooter>
        <Button title="Done" size="large" onPress={onClose} />
      </SheetFooter>
    </Sheet>
  );
}

/** More options: whether others can comment, and saving a copy to the phone. */
export function MoreOptionsSheet({ visible, commentsOff, saveToDevice, onClose, onComments, onSaveToDevice }: { visible: boolean; commentsOff: boolean; saveToDevice: boolean; onClose: () => void; onComments: (allow: boolean) => void; onSaveToDevice: (save: boolean) => void }) {
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close more options" draggable="sheet">
      <SheetHeader title="More options" />
      <View style={styles.list}>
        <ToggleRow icon="chatbubble-outline" sf="bubble.right" title="Allow comments" hint={commentsOff ? "Nobody can comment, you included." : "Anyone who can view it can comment."} value={!commentsOff} onChange={onComments} />
        <ToggleRow icon="download-outline" sf="square.and.arrow.down" title="Save to device" hint="Keep a copy of the photos and video in your library once posted." value={saveToDevice} onChange={onSaveToDevice} />
      </View>
      <SheetFooter>
        <Button title="Done" size="large" onPress={onClose} />
      </SheetFooter>
    </Sheet>
  );
}

/** Share to: once it's posted, send it to friends in UniBuzz, or out to other apps. Public posts only. */
export function ShareToSheet({ visible, friends, apps, onClose, onFriends, onApps }: { visible: boolean; friends: boolean; apps: boolean; onClose: () => void; onFriends: (on: boolean) => void; onApps: (on: boolean) => void }) {
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close share to" draggable="sheet">
      <SheetHeader title="Share to" />
      <View style={styles.list}>
        <Text style={[styles.hint, { paddingHorizontal: 16, paddingBottom: 6 }]}>Right after it's posted, we'll open these for you.</Text>
        <ToggleRow icon="paper-plane-outline" sf="paperplane" title="Friends on UniBuzz" hint="Send it in a chat with a note." value={friends} onChange={onFriends} />
        <ToggleRow icon="share-outline" sf="square.and.arrow.up" title="Other apps" hint="Messages, Instagram, WhatsApp and more." value={apps} onChange={onApps} />
      </View>
      <SheetFooter>
        <Button title="Done" size="large" onPress={onClose} />
      </SheetFooter>
    </Sheet>
  );
}

function ToggleRow({ icon, sf, title, hint, value, disabled, onChange }: { icon: IconName; sf: SFSymbol; title: string; hint: string; value: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.option, disabled && { opacity: 0.5 }]}>
      <View style={styles.optionIcon}>
        <Icon name={icon} sf={sf} size={20} color={colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(on) => {
          hapticSelect();
          onChange(on);
        }}
        trackColor={{ true: colors.brand, false: colors.border }}
        accessibilityLabel={title}
      />
    </View>
  );
}

/** A row of the publish screen: symbol, words, what is chosen, chevron. */
export function SettingRow({ icon, sf, title, value, disabled, onPress, children }: { icon: IconName; sf: SFSymbol; title: string; value?: string | null; disabled?: boolean; onPress: () => void; children?: ReactNode }) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.input }, disabled && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title}>
      <Icon name={icon} sf={sf} size={22} color={colors.text} />
      <Text style={[styles.rowTitle, !value && !children && { flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {children}
      <Icon name="chevron-forward" size={16} weight="semibold" color={colors.faint} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 50, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.input, borderWidth: 1, borderColor: "transparent" },
  input: { flex: 1, fontSize: 16, color: colors.text, height: 50 },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { fontSize: 13, lineHeight: 18, color: colors.red },
  footerRow: { flexDirection: "row", gap: 10 },
  list: { paddingVertical: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.input },
  optionTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  optionHint: { fontSize: 13, lineHeight: 17, color: colors.muted, marginTop: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  selectedEnd: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 56 },
  rowTitle: { fontSize: 16, fontWeight: "500", color: colors.text, flexShrink: 1 },
  rowValue: { flex: 1, textAlign: "right", fontSize: 15, color: colors.muted },
}));
