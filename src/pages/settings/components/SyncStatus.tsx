import { useEffect, useState } from "react";
import { Button } from "@/components";
import { useAuth } from "@/contexts";
import { subscribeSync, runSync, type SyncState } from "@/lib/sync";
import {
  RefreshCwIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  CloudIcon,
  CloudOffIcon,
} from "lucide-react";
import moment from "moment";

/**
 * Shows the cloud backup/sync status and a manual "Sync now" button. The engine
 * runs automatically (on sign-in, on a timer, and on focus); this just makes it
 * visible and gives the user a way to force it.
 */
export const SyncStatus = () => {
  const { isSignedIn } = useAuth();
  const [state, setState] = useState<SyncState>({
    status: "idle",
    lastSyncedAt: null,
  });

  useEffect(() => subscribeSync(setState), []);

  const syncing = state.status === "syncing";

  const label = !isSignedIn
    ? "Sign in to back up and sync your data"
    : syncing
    ? "Syncing…"
    : state.status === "error"
    ? "Sync failed, will retry automatically"
    : state.lastSyncedAt
    ? `Last synced ${moment(state.lastSyncedAt).fromNow()}`
    : "Not synced yet";

  const Icon = !isSignedIn
    ? CloudOffIcon
    : state.status === "error"
    ? AlertCircleIcon
    : state.status === "success"
    ? CheckCircle2Icon
    : CloudIcon;

  const iconClass =
    state.status === "error"
      ? "text-amber-600 dark:text-amber-500"
      : state.status === "success"
      ? "text-primary"
      : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 ${iconClass}`} />
        <div>
          <p className="text-sm font-medium">Cloud sync &amp; backup</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {state.status === "error" && state.error && (
            <p className="mt-0.5 text-2xs text-muted-foreground/80">
              {state.error}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => runSync()}
        disabled={!isSignedIn || syncing}
        className="shrink-0 gap-1.5"
      >
        <RefreshCwIcon className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
        Sync now
      </Button>
    </div>
  );
};
