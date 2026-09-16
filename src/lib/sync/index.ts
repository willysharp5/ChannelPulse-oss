import { runSync } from "./engine";
import { isManagedModeEnabled } from "@/lib/backend/client";

export * from "./engine";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Request a sync soon (debounced). Call after meaningful local mutations so
 * changes reach the server promptly without a request per keystroke.
 */
export function scheduleSync(delayMs = 4000): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, delayMs);
}

let stop: (() => void) | null = null;

/**
 * Start the background sync loop: an initial sync shortly after launch, then a
 * periodic sync, plus a sync when the window regains focus or comes online.
 * Idempotent — safe to call more than once. Returns a stop function.
 */
export function startSyncManager(): () => void {
  if (stop) return stop;

  const kick = () => {
    if (isManagedModeEnabled()) void runSync();
  };

  // Give auth a moment to hydrate the cached token, then sync (this is what
  // restores data on a fresh install once the user is signed in).
  const initial = setTimeout(kick, 3000);
  const interval = setInterval(kick, 45_000);
  const onFocus = () => scheduleSync(1500);
  const onOnline = () => scheduleSync(1000);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);

  stop = () => {
    clearTimeout(initial);
    clearInterval(interval);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    stop = null;
  };
  return stop;
}
