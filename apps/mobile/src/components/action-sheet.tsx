import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, Text, View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { radius, sheetShape } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-provider";
import { Icon } from "@/components/icon";

export type SheetOption = { label: string; icon?: keyof typeof Ionicons.glyphMap; destructive?: boolean; onPress: () => void };
/** `onCancel` runs when the sheet closes without a choice (Cancel, or a tap outside it). */
type Show = (options: SheetOption[], title?: string, onCancel?: () => void) => void;
const Ctx = createContext<Show>(() => {});

/** Native action sheet on iOS, a bottom sheet elsewhere (Android, web). */
export function ActionSheetProvider({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const [state, setState] = useState<{ options: SheetOption[]; title?: string; onCancel?: () => void } | null>(null);
  const show = useCallback<Show>((options, title, onCancel) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: [...options.map((o) => o.label), "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0) },
        (i) => (options[i] ? options[i].onPress() : onCancel?.()),
      );
      return;
    }
    setState({ options, title, onCancel });
  }, []);
  const open = useRef(state);
  open.current = state;
  const cancel = useCallback(() => {
    const was = open.current;
    setState(null);
    was?.onCancel?.();
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal visible={state !== null} transparent animationType="fade" onRequestClose={cancel}>
        <Pressable style={styles.backdrop} onPress={cancel} accessibilityLabel="Close menu">
          <Pressable style={styles.sheet} onPress={() => {}}>
            {state?.title ? <Text style={styles.title}>{state.title}</Text> : null}
            {state?.options.map((o) => (
              <Pressable
                key={o.label}
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.input }]}
                onPress={() => {
                  setState(null);
                  o.onPress();
                }}
              >
                {o.icon ? <Icon name={o.icon} size={20} color={o.destructive ? colors.red : colors.text} /> : null}
                <Text style={[styles.itemText, o.destructive && { color: colors.red }]}>{o.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.item, { justifyContent: "center" }]} onPress={cancel}>
              <Text style={[styles.itemText, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Ctx.Provider>
  );
}

export function useActionSheet(): Show {
  return useContext(Ctx);
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.elevated, ...sheetShape, padding: 8, paddingBottom: 16, gap: 2 },
  title: { textAlign: "center", color: colors.muted, fontSize: 13, paddingVertical: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.md, borderCurve: "continuous" },
  itemText: { fontSize: 16, fontWeight: "600", color: colors.text },
}));
