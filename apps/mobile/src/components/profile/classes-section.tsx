import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { addProfileClass, classCodeProblem, currentTerm, groupClassesByTerm, pickableTerms, removeProfileClass, type ProfileClass } from "@apartment-book/shared";
import { Button } from "@/components/ui";
import { hapticTap } from "@/lib/haptics";
import { errorText } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";

type UpdateClasses = (fn: (classes: ProfileClass[]) => ProfileClass[]) => void;

/**
 * "Classes this semester" under the bio: the codes of this term's classes as pills; a tap opens the Classes tab. The owner
 * with nothing listed for this term gets "Add your classes" instead; visitors see nothing then.
 */
export function ClassesCard({ classes, own, onPress }: { classes: ProfileClass[]; own: boolean; onPress: () => void }) {
  const term = currentTerm();
  const now = classes.filter((c) => c.term === term);
  if (now.length === 0 && !own) return null;
  const empty = now.length === 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={empty ? "Add your classes" : `Classes this semester: ${now.map((c) => c.code).join(", ")}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardHead}>
        <Ionicons name="school-outline" size={18} color={colors.text} />
        <Text style={styles.cardTitle}>{empty ? "Add your classes" : "Classes this semester"}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      </View>
      {empty ? (
        <Text style={styles.cardHint}>Let classmates find you: list what you're taking in {term}.</Text>
      ) : (
        <View style={styles.pills}>
          {now.map((c) => (
            <View key={c.id} style={styles.pill}>
              <Text style={styles.pillText}>{c.code}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/**
 * The Classes tab: classes grouped by semester, this one first ("Fall 2026 · This semester"). The owner adds a class with
 * a code ("CS 3358", checked as it would be by the database), an optional name and the semester, and removes one with the
 * cross beside it. `onChange` edits the list the profile holds, so the card above follows. `onOpenForm` lets the profile
 * bring the form up the screen, clear of the keyboard.
 */
export function ClassesSection({ own, userId, classes, onChange, onOpenForm }: { own: boolean; userId: string; classes: ProfileClass[]; onChange: UpdateClasses; onOpenForm?: () => void }) {
  const groups = useMemo(() => groupClassesByTerm(classes), [classes]);
  const [adding, setAdding] = useState(false);

  async function remove(c: ProfileClass) {
    hapticTap();
    onChange((list) => list.filter((x) => x.id !== c.id));
    try {
      await removeProfileClass(supabase, c.id);
    } catch (e) {
      onChange((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
      Alert.alert(`Could not remove ${c.code}`, errorText(e));
    }
  }

  return (
    <View style={styles.section}>
      {own && adding ? <AddClassForm userId={userId} onAdded={(c) => onChange((list) => [...list, c])} onClose={() => setAdding(false)} /> : null}
      {own && !adding ? (
        <Button
          title="Add class"
          variant="secondary"
          icon="add"
          onPress={() => {
            setAdding(true);
            onOpenForm?.();
          }}
        />
      ) : null}
      {groups.length === 0 ? (
        own ? (
          adding ? null : <Text style={styles.empty}>Add the classes you're taking so classmates can find you.</Text>
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="school-outline" size={28} color={colors.faint} />
            <Text style={styles.emptyTitle}>No classes listed</Text>
          </View>
        )
      ) : (
        groups.map((g) => (
          <View key={g.term} style={styles.group}>
            <Text style={styles.term} accessibilityRole="header">
              {g.current ? `${g.term} · This semester` : g.term}
            </Text>
            {g.classes.map((c) => (
              <View key={c.id} style={styles.classRow}>
                <View style={styles.codeBadge}>
                  <Ionicons name="book-outline" size={16} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.code}>{c.code}</Text>
                  {c.title ? (
                    <Text style={styles.title} numberOfLines={2}>
                      {c.title}
                    </Text>
                  ) : null}
                </View>
                {own ? (
                  <Pressable onPress={() => void remove(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${c.code}`} style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="close-circle" size={22} color={colors.faint} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

/** Class code, optional class name and the semester (this one picked), then Add. Stays open after a class is added, for the next one. */
function AddClassForm({ userId, onAdded, onClose }: { userId: string; onAdded: (c: ProfileClass) => void; onClose: () => void }) {
  const terms = useMemo(() => pickableTerms(), []);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState(terms[0]);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const titleInput = useRef<TextInput>(null);

  async function add() {
    if (busy) return;
    const problem = classCodeProblem(code);
    setCodeError(problem);
    setError(null);
    setAdded(null);
    if (problem) return;
    setBusy(true);
    try {
      const created = await addProfileClass(supabase, userId, { term, code, title: title.trim() || null });
      hapticTap();
      onAdded(created);
      setCode("");
      setTitle("");
      setAdded(`${created.code} added to ${created.term}.`);
    } catch (e) {
      setError(errorText(e, "Could not add the class. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.formHead}>
        <Text style={styles.formTitle}>Add a class</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.formClose}>
          <Ionicons name="close" size={18} color={colors.text} />
        </Pressable>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Class code</Text>
        <TextInput
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (codeError) setCodeError(null);
          }}
          placeholder="CS 3358"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Class code"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => titleInput.current?.focus()}
          style={[styles.input, codeError ? { borderColor: colors.red } : null]}
        />
        {codeError ? <Text style={styles.error}>{codeError}</Text> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Class name (optional)</Text>
        <TextInput ref={titleInput} value={title} onChangeText={setTitle} placeholder="Data Structures" placeholderTextColor={colors.faint} accessibilityLabel="Class name (optional)" maxLength={80} returnKeyType="done" onSubmitEditing={() => void add()} style={styles.input} />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Semester</Text>
        <View style={styles.terms} accessibilityRole="radiogroup" accessibilityLabel="Semester">
          {terms.map((t, i) => {
            const selected = t === term;
            return (
              <Pressable key={t} onPress={() => setTerm(t)} accessibilityRole="radio" accessibilityLabel={i === 0 ? `${t}, this semester` : t} accessibilityState={{ checked: selected }} style={[styles.termChip, selected && styles.termChipOn]}>
                <Text style={[styles.termText, selected && { color: colors.brand }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : added ? <Text style={styles.added}>{added}</Text> : null}
      <Button title="Add" icon="add" onPress={() => void add()} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.lg, marginHorizontal: space.lg, padding: space.md, gap: 10, borderRadius: radius.md, backgroundColor: colors.bg },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  cardHint: { fontSize: 13, color: colors.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pillText: { fontSize: 12, fontWeight: "700", color: colors.text },
  section: { padding: space.lg, gap: space.lg },
  empty: { fontSize: 14, color: colors.muted, textAlign: "center" },
  emptyBox: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  group: { gap: 2 },
  term: { fontSize: 14, fontWeight: "700", color: colors.muted, marginBottom: 4 },
  classRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  codeBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  code: { fontSize: 15, fontWeight: "700", color: colors.text },
  title: { fontSize: 13, color: colors.muted },
  remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  form: { gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  formHead: { flexDirection: "row", alignItems: "center" },
  formTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  formClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.input, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  error: { color: colors.red, fontSize: 12 },
  added: { color: colors.green, fontSize: 13 },
  terms: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  termChip: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  termChipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  termText: { fontSize: 13, fontWeight: "600", color: colors.muted },
});
