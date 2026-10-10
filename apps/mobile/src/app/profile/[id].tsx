import { useLocalSearchParams } from "expo-router";
import { ProfileView } from "@/components/profile/profile-view";

/** Anyone's profile on a stacked screen (the back button stays); your own opens with your buttons. */
export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView key={id} userId={id} />;
}
