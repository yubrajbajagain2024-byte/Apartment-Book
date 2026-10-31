import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getEventInterests, setEventInterests, type EventCategory } from "@apartment-book/shared";
import { InterestChips } from "@/components/events/interest-chips";
import { Button, Loading } from "@/components/ui";
import { alertWithHaptic, hapticSuccess } from "@/lib/haptics";
import { errorText, useQuery } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space, textStyle } from "@/lib/theme";
import { useColors } from "@/lib/theme-provider";

/** What the person is into (event_interests): the categories For you lifts. Save replaces the list. */
export default function EventInterestsScreen() {
  const { user } = useSession();
  const router = useRouter();
  const colors = useColors();
  const current = useQuery(() => (user ? getEventInterests(supabase, user.id) : Promise.resolve([])), [user?.id]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (current.data && picked === null) setPicked(new Set(current.data));
  }, [current.data, picked]);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  if (!picked) return <Loading />;
  async function save() {
    setBusy(true);
    try {
      await setEventInterests(supabase, user!.id, [...picked!] as EventCategory[]);
      hapticSuccess();
      router.back();
    } catch (e) {
      alertWithHaptic("error", "Could not save", errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Text style={{ ...textStyle.title3, color: colors.text }}>What are you into?</Text>
        <Text style={{ ...textStyle.subheadline, color: colors.muted }}>For you puts these first. Pick as many as you like; change them any time.</Text>
      </View>
      <InterestChips
        picked={picked}
        onToggle={(c) =>
          setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            return next;
          })
        }
      />
      <Button title="Save" size="large" loading={busy} onPress={() => void save()} />
    </ScrollView>
  );
}
