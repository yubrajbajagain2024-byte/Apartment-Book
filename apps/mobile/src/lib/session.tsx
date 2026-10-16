import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { getProfile, markDeliveredAll, type ProfileWithUniversity } from "@apartment-book/shared";
import { stopPresence } from "./presence-store";
import { supabase } from "./supabase";
import { registerForPush } from "./push";

type SessionState = {
  session: Session | null;
  user: User | null;
  profile: ProfileWithUniversity | null;
  /** True until the stored session has been read once. */
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileWithUniversity | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    // INITIAL_SESSION fires once the stored session has been read, so protected
    // screens never see "signed out" during the first paint of a cold start.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "INITIAL_SESSION") setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSession(data.session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const fresh = await getProfile(supabase, userId).then(
      (p) => ({ p }),
      () => null,
    );
    setProfile((prev) => {
      // A failed read (offline, say) keeps what was known about this user; a first read failing leaves it empty, as before.
      if (!fresh) return prev?.id === userId ? prev : null;
      // The same profile again keeps the same object, so screens that copy it into a form (Settings) are not reset.
      return prev && fresh.p && JSON.stringify(prev) === JSON.stringify(fresh.p) ? prev : fresh.p;
    });
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // While signed in and in the foreground: receipts ("Delivered") and the push token. The last-active time is stamped by
  // the presence store (lib/presence.tsx), and only for someone who shows their active status.
  useEffect(() => {
    if (!userId) return;
    const wake = () => {
      markDeliveredAll(supabase).catch(() => {});
    };
    wake();
    registerForPush(userId).catch(() => {});
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") wake();
    });
    return () => sub.remove();
  }, [userId]);

  const signOut = useCallback(async () => {
    // Stop appearing online at once, while the session can still stamp the time.
    stopPresence();
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<SessionState>(() => ({ session, user: session?.user ?? null, profile, loading, refreshProfile, signOut }), [session, profile, loading, refreshProfile, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
