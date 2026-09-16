import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "./storage";
import { getSupabase } from "@/lib/auth/client";

const ONBOARDING_EVENT = "channelpulse-onboarding-changed";

/**
 * Default "About you" applied when a user skips the profile step. Written so the
 * assistant is immediately useful for the core use case: live meetings and
 * interviews where the user wants real-time insights.
 */
export const DEFAULT_USER_PROFILE =
  "I use ChannelPulse to take notes and get live coaching during meetings, interviews, and calls: concise talking points and clear answers I can say out loud. Keep responses short, specific, and immediately usable.";

/** The persona preset applied by default when a user skips persona selection. */
export const DEFAULT_PERSONA_ID = "meeting-assistant";

export function isOnboardingComplete(): boolean {
  return safeLocalStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE) === "1";
}

export function setOnboardingComplete(complete = true): void {
  if (complete) {
    safeLocalStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, "1");
  } else {
    safeLocalStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
  }
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT));
  } catch {
    // no-op
  }
}

/**
 * Sync onboarding state from the database (the source of truth). New signups
 * have `onboarding_completed_at = null` → the first-run flow shows automatically;
 * anyone already onboarded (or hidden by an admin) has it set → hidden. Applied
 * on sign-in so it also works across devices. Best-effort — never throws.
 */
export async function syncOnboardingFromDb(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", uid)
      .maybeSingle();
    if (error || !data) return;
    setOnboardingComplete(!!data.onboarding_completed_at);
  } catch {
    // no-op: best-effort
  }
}

/**
 * Persist onboarding completion to the database so it's remembered per-user
 * (across devices and reinstalls). Best-effort — never throws.
 */
export async function persistOnboarding(complete: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.rpc("set_my_onboarding", { p_complete: complete });
  } catch {
    // no-op: best-effort
  }
}

/** Reactive onboarding-complete flag, synced across windows via storage events. */
export function useOnboardingComplete(): boolean {
  const [done, setDone] = useState(isOnboardingComplete());
  useEffect(() => {
    const update = () => setDone(isOnboardingComplete());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.ONBOARDING_COMPLETE) update();
    };
    window.addEventListener(ONBOARDING_EVENT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ONBOARDING_EVENT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return done;
}
