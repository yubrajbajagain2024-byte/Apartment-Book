import { getCurrentProfile } from "@/lib/auth";
import { Navbar } from "@/components/layout/navbar";
import { PresenceProvider } from "@/components/presence/presence-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  const me = profile ? { id: profile.id, full_name: profile.full_name, avatar_url: profile.avatar_url, show_active_status: profile.show_active_status } : null;
  return (
    <PresenceProvider me={me}>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">{children}</main>
    </PresenceProvider>
  );
}
