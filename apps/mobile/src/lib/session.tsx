import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { getProfile, markDeliveredAll, touchPresence, type ProfileWithUniversity } from "@apartment-book/shared";
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
    setProfile(await getProfile(supabase, userId).catch(() => null));
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // While signed in and in the foreground: receipts ("Delivered"), presence heartbeat, push token.
  useEffect(() => {
    if (!userId) return;
    const wake = () => {
      markDeliveredAll(supabase).catch(() => {});
      touchPresence(supabase).catch(() => {});
    };
    wake();
    registerForPush(userId).catch(() => {});
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") wake();
    });
    return () => sub.remove();
  }, [userId]);

  const signOut = useCallback(async () => {
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
