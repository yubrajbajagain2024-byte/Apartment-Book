import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { OrganizationForm } from "@/components/events/organization-form";
import { hapticSuccess } from "@/lib/haptics";

/** "New organization": the form, then a word about verification before the new page opens. */
export default function NewOrganizationScreen() {
  const router = useRouter();
  return (
    <OrganizationForm
      onDone={(org) => {
        hapticSuccess();
        Alert.alert("Awaiting verification", `${org.name} is yours. Staff verify clubs, organizations and departments before their events show to the campus; until then, events you publish are visible to your members alone.`, [
          { text: "OK", onPress: () => router.replace({ pathname: "/organizations/[id]", params: { id: org.id } } as never) },
        ]);
      }}
    />
  );
}
