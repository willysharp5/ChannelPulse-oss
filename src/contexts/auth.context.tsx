import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  initAuth,
  sendLoginCode,
  verifyLoginCode,
  signOut as authSignOut,
  getSubscription,
  isAuthConfigured,
  isSubscriptionActive,
  getTrialDaysLeft,
  type SubscriptionInfo,
} from "@/lib/auth";
import { startSyncManager, scheduleSync } from "@/lib/sync";
import { startSyncedKv } from "@/lib/sync/kv";
import { backendBillingProvision } from "@/lib/backend";
import { warmPrompts } from "@/lib/prompts";
import { syncOnboardingFromDb } from "@/lib/onboarding";

interface AuthContextType {
  /** Whether Supabase auth is configured at all (env present). */
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  subscription: SubscriptionInfo | null;
  /**
   * True once we've finished the first subscription fetch for the current
   * session (or determined the user is signed out). Feature gates should not
   * treat a signed-in user as unpaid until this is true.
   */
  subscriptionReady: boolean;
  isSignedIn: boolean;
  isSubscribed: boolean;
  /** Days left on an active trial; null when not trialing. */
  trialDaysLeft: number | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const configured = isAuthConfigured();
  const [loading, setLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null
  );
  const [subscriptionReady, setSubscriptionReady] = useState(!configured);
  const lastUserId = useRef<string | null>(null);

  const refreshSubscription = useCallback(async () => {
    try {
      const sub = await getSubscription();
      setSubscription(sub);
    } catch {
      setSubscription(null);
    } finally {
      setSubscriptionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      setSubscriptionReady(true);
      return;
    }
    const stopSync = startSyncManager();
    // Mirror synced localStorage (profile + interview practice) into/out of the
    // DB as syncs land, so this data persists and converges across devices.
    startSyncedKv();
    const unsub = initAuth(({ user, session }) => {
      setUser(user);
      setSession(session);
      setLoading(false);
      // Load DB-backed prompt overrides (best-effort; falls back to code defaults).
      if (session) void warmPrompts(true);
      // Fetch subscription + back up/restore data on sign-in / user change.
      if (user?.id && user.id !== lastUserId.current) {
        lastUserId.current = user.id;
        setSubscriptionReady(false);
        void refreshSubscription();
        scheduleSync(500);
        // Sync onboarding state from the DB (auto-shows for new signups).
        void syncOnboardingFromDb();
        // Register the user as a Stripe customer up front (free/trial included),
        // so billing "just works" later. Idempotent + best-effort.
        backendBillingProvision().catch(() => {});
      } else if (!user) {
        lastUserId.current = null;
        setSubscription(null);
        setSubscriptionReady(true);
      }
    });
    return () => {
      unsub();
      stopSync();
    };
  }, [configured, refreshSubscription]);

  const sendCode = useCallback(async (email: string) => {
    await sendLoginCode(email);
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      await verifyLoginCode(email, code);
      await refreshSubscription();
    },
    [refreshSubscription]
  );

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setSession(null);
    setSubscription(null);
    setSubscriptionReady(true);
  }, []);

  const isSignedIn = !!user;
  const isSubscribed = isSubscriptionActive(subscription);
  const trialDaysLeft = getTrialDaysLeft(subscription);

  return (
    <AuthContext.Provider
      value={{
        configured,
        loading,
        user,
        session,
        subscription,
        subscriptionReady,
        isSignedIn,
        isSubscribed,
        trialDaysLeft,
        sendCode,
        verifyCode,
        signOut,
        refreshSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
