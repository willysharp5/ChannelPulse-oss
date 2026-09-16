import { useState } from "react";
import { AlertCircleIcon, Loader2, Trash2Icon } from "lucide-react";
import { Button } from "@/components";
import { useAuth } from "@/contexts";
import { backendDeleteAccount } from "@/lib/backend";

/**
 * Close the account: revokes access immediately, cancels any Stripe
 * subscription, and queues the data for erasure. The erase itself is a job
 * someone runs (`npm run purge:accounts -- --apply`), not part of this request,
 * so the copy here says "we'll erase it within 30 days" rather than implying the
 * rows are gone the moment the button returns. Don't promise instant deletion
 * unless that job becomes automatic.
 *
 * Rendered in two places on purpose — the Settings page (where people look for
 * it) and the Profile page (where the mobile app puts it, so the three surfaces
 * agree). Both are in the desktop AND web route tables, so Google Play's
 * required web-reachable deletion path resolves either way
 * (app.channelpulse.us/settings, app.channelpulse.us/profile).
 *
 * An admin can also close an account from the console's Users table, which goes
 * through /admin-accounts to the same server-side logic.
 *
 * Distinct from "Delete Chat History", which only clears local conversations.
 */
export const DeleteAccount = () => {
  const { user, isSignedIn, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setConfirming(false);
    setTyped("");
    setError(null);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setError(null);
    try {
      await backendDeleteAccount();
      // The account is banned and every function now refuses this token, so the
      // local session is already useless; this clears it and drops the app back
      // to the signed-out state instead of leaving a dead session on screen.
      await signOut();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div id="delete-account" className="space-y-3">
      <div>
        <p className="text-sm font-medium">Delete account</p>
        <p className="text-xs text-muted-foreground mt-1">
          {isSignedIn
            ? "Closes your account right away, signs you out everywhere, and cancels any active subscription. Your data is erased within 30 days."
            : "Sign in to delete your account."}
        </p>
      </div>

      <Button
        onClick={() => setConfirming(true)}
        disabled={!isSignedIn || deleting}
        variant="destructive"
        className="w-full h-11"
        title="Close your account and delete your data"
      >
        <Trash2Icon className="h-4 w-4 mr-2" />
        Delete my account
      </Button>

      {confirming && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 max-w-md mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Delete your account</h3>
            <p className="text-sm text-muted-foreground">
              This closes{" "}
              <span className="font-medium text-foreground">
                {user?.email ?? "your account"}
              </span>
              . You'll be signed out on every device and won't be able to log
              back in, and any active subscription is cancelled. Your profile,
              practice sessions and synced transcripts are erased within 30 days.
              Email us within 7 days if you tapped this by mistake.
            </p>
            <div className="space-y-1.5">
              <label
                htmlFor="delete-account-confirm"
                className="text-xs text-muted-foreground"
              >
                Type <span className="font-mono font-medium">DELETE</span> to
                confirm
              </label>
              <input
                id="delete-account-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircleIcon className="size-3.5 shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={deleteAccount}
                disabled={typed !== "DELETE" || deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Delete my account"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
