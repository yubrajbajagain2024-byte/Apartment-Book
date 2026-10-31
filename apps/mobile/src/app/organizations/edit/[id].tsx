import { useLocalSearchParams, useRouter } from "expo-router";
import { getOrganization } from "@apartment-book/shared";
import { OrganizationForm } from "@/components/events/organization-form";
import { EmptyState, Loading } from "@/components/ui";
import { hapticSuccess } from "@/lib/haptics";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

/** "Edit organization": the same form, filled in (the database lets only an owner save it). */
export default function EditOrganizationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, loading } = useQuery(() => getOrganization(supabase, id), [id]);
  if (loading && !data) return <Loading />;
  if (!data) return <EmptyState icon="people-outline" title="This organization is no longer available" />;
  return (
    <OrganizationForm
      organization={data}
      onDone={() => {
        hapticSuccess();
        router.back();
      }}
    />
  );
}
