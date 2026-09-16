import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, setCachedToken } from "./client";

export interface SubscriptionInfo {
  status: string; // active | trialing | past_due | canceled | none
  plan: string; // free | pro | scale
  currentPeriodEnd: string | null;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
}

/** Send a one-time code / magic link to the given email. */
export async function sendLoginCode(email: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Auth is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

/** Verify the 6-digit email code and establish a session. */
export async function verifyLoginCode(
  email: string,
  token: string
): Promise<Session> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Auth is not configured.");
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("No session returned after verification.");
  setCachedToken(data.session.access_token);
  return data.session;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  setCachedToken(null);
}

/** Current session (refreshing if needed). */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  setCachedToken(data.session?.access_token ?? null);
  return data.session ?? null;
}

/** Fresh access token for backend calls, or null if not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token ?? null;
}

/** Whether the signed-in user is a super admin (profiles.is_admin). */
export async function getIsAdmin(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .maybeSingle();
  if (error || !data) return false;
  return !!(data as { is_admin?: boolean }).is_admin;
}

/** Read the signed-in user's subscription (RLS lets them read only their own). */
export async function getSubscription(): Promise<SubscriptionInfo | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, plan, current_period_end")
    .maybeSingle();
  if (error) {
    console.warn("getSubscription failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    status: data.status,
    plan: data.plan,
    currentPeriodEnd: data.current_period_end,
  };
}

/**
 * Paying, or a trial that has not yet reached currentPeriodEnd.
 * Expired trials count as not entitled even if status is still "trialing".
 * `status === "active"` unlocks regardless of plan / period end (covers
 * manually granted Pro comps that have no Stripe period).
 */
export function isSubscriptionActive(
  sub: SubscriptionInfo | null | undefined
): boolean {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status === "trialing") {
    if (!sub.currentPeriodEnd) return true;
    return new Date(sub.currentPeriodEnd).getTime() > Date.now();
  }
  return false;
}

/** Whole days remaining on a trial (0 if expired / not trialing). */
export function getTrialDaysLeft(
  sub: SubscriptionInfo | null | undefined
): number | null {
  if (!sub || sub.status !== "trialing" || !sub.currentPeriodEnd) return null;
  const ms = new Date(sub.currentPeriodEnd).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Initialize auth: hydrate the cached token and subscribe to changes. Returns
 * an unsubscribe function. `onChange` fires on sign-in/out/refresh.
 */
export function initAuth(
  onChange: (state: AuthState) => void
): () => void {
  const supabase = getSupabase();
  if (!supabase) {
    onChange({ user: null, session: null });
    return () => {};
  }

  // Hydrate immediately.
  supabase.auth.getSession().then(({ data }) => {
    setCachedToken(data.session?.access_token ?? null);
    onChange({ user: data.session?.user ?? null, session: data.session });
  });

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    setCachedToken(session?.access_token ?? null);
    onChange({ user: session?.user ?? null, session });
  });

  return () => sub.subscription.unsubscribe();
}
