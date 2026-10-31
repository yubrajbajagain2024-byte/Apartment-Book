import { useLocalSearchParams } from "expo-router";
import { EventForm } from "@/components/events/event-form";

/** "Create event": the form for a new one; `?organization=` (from an organization's page) picks that organization. */
export default function NewEventScreen() {
  const { organization } = useLocalSearchParams<{ organization?: string }>();
  return <EventForm initialOrganizationId={organization} />;
}
