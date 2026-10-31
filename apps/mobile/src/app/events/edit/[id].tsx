import { useLocalSearchParams } from "expo-router";
import { getEvent } from "@apartment-book/shared";
import { EventForm } from "@/components/events/event-form";
import { EmptyState, Loading } from "@/components/ui";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

/** "Edit event": the same form, filled from the event (the database lets only its organization's members save it). */
export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useQuery(() => getEvent(supabase, id), [id]);
  if (loading && !data) return <Loading />;
  if (!data) return <EmptyState icon="calendar-outline" title="This event is no longer available" />;
  return <EventForm event={data} />;
}
