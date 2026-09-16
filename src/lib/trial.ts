import { invoke } from "@tauri-apps/api/core";
import { getSubscription, isSubscriptionActive } from "@/lib/auth";

export type EntitlementStatus =
  | "loading"
  | "trial"
  | "expired"
  | "paid"
  | "unknown";

export interface Entitlement {
  status: EntitlementStatus;
  isActive: boolean;
  isPaid: boolean;
  daysLeft: number | null;
}

const SUPABASE_URL =
  ((import.meta as any).env?.VITE_SUPABASE_URL as string) || "";
const SUPABASE_ANON_KEY =
  ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string) || "";

// Fail-open result used before config exists, on network error, or offline.
const FAIL_OPEN: Entitlement = {
  status: "unknown",
  isActive: true,
  isPaid: false,
  daysLeft: null,
};

let cachedDeviceId: string | null = null;

async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = await invoke<string>("get_machine_id");
  return cachedDeviceId;
}

/**
 * Server-validated entitlement check.
 *
 * Order of precedence:
 * 1. Signed-in account subscription (`subscriptions` row — Pro / active trial)
 * 2. Anonymous device trial (`device_trials` via `check_trial` RPC)
 *
 * Account Pro must win over an expired device trial — otherwise paid users get
 * falsely locked after the machine's free trial clock runs out.
 *
 * If the backend is not configured or unreachable, we fail open.
 */
export async function checkEntitlement(): Promise<Entitlement> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return FAIL_OPEN;
  }

  // Account subscription first (when a session exists).
  try {
    const sub = await getSubscription();
    if (isSubscriptionActive(sub)) {
      return {
        status: "paid",
        isActive: true,
        isPaid: sub?.status === "active" || sub?.plan === "pro" || sub?.plan === "scale",
        daysLeft: null,
      };
    }
  } catch {
    // Fall through to device trial.
  }

  try {
    const deviceId = await getDeviceId();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_trial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_device_id: deviceId }),
    });

    if (!res.ok) {
      return FAIL_OPEN;
    }

    const data = await res.json();
    const isPaid = !!data?.is_paid;
    const isActive = !!data?.is_active;
    const daysLeft =
      typeof data?.days_left === "number" ? data.days_left : null;
    const status: EntitlementStatus = isPaid
      ? "paid"
      : isActive
      ? "trial"
      : "expired";

    return { status, isActive, isPaid, daysLeft };
  } catch {
    return FAIL_OPEN;
  }
}
