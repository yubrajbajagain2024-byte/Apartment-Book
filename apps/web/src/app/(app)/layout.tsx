import { getCurrentUser } from "@/lib/auth";
import { Navbar } from "@/components/layout/navbar";
import { ChatDock, ChatDockProvider } from "@/components/messages/chat-dock";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <ChatDockProvider userId={user?.id ?? null}>
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-4 sm:px-4 md:pb-8">{children}</main>
      <ChatDock userId={user?.id ?? null} />
    </ChatDockProvider>
  );
}
