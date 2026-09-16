import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  ImagePlusIcon,
  XIcon,
} from "lucide-react";
import {
  AlertBanner,
  Button,
  Input,
  Label,
  Textarea,
  toast,
} from "@/components";
import { PageLayout } from "@/layouts";
import { getPlatform, isWeb } from "@/lib";
import { useAuth, useBugReport } from "@/contexts";
import { useVersion } from "@/hooks";
import { DISCORD_INVITE_URL } from "@/hooks/useMenuItems";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  scale: "Scale",
};

function planProductLabel(plan: string | undefined): string {
  const key = (plan || "free").toLowerCase();
  return PLAN_LABELS[key] ?? plan ?? "unknown";
}

const ReportBug = () => {
  const { version } = useVersion();
  const { user, subscription, isSubscribed, trialDaysLeft, isSignedIn } =
    useAuth();
  const {
    active,
    captures,
    description,
    contact,
    setDescription,
    setContact,
    startSession,
    addImageFiles,
    removeCapture,
    clearCaptures,
  } = useBugReport();

  // The web build can't capture the screen natively — the user uploads their
  // own screenshots instead (see the file picker below).
  const web = isWeb();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const accountEmail = user?.email?.trim() || null;
  const plan = subscription?.plan ?? "free";
  const planStatus = subscription?.status ?? "none";
  const contactPrefillDone = useRef(false);

  const windowLabel =
    typeof window !== "undefined"
      ? getCurrentWebviewWindow().label
      : "unknown";
  const platform = getPlatform();

  const productLine = [
    `Product: ChannelPulse ${planProductLabel(plan)}`,
    `Plan: ${plan}`,
    `Subscription status: ${planStatus}`,
    `Entitled: ${isSubscribed ? "yes" : "no"}`,
    trialDaysLeft != null ? `Trial days left: ${trialDaysLeft}` : null,
    subscription?.currentPeriodEnd
      ? `Period end: ${subscription.currentPeriodEnd}`
      : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const captureRoutes = captures
    .map((c, i) => `${i + 1}. ${c.route}`)
    .join("\n");

  const diagnostics = [
    `App: ChannelPulse v${version || "unknown"}`,
    `OS: ${platform}`,
    `Window: ${windowLabel}`,
    `Signed in: ${isSignedIn ? "yes" : "no"}`,
    `Account email: ${accountEmail || "(not signed in)"}`,
    productLine,
    contact.trim() && contact.trim() !== accountEmail
      ? `Additional contact: ${contact.trim()}`
      : null,
    `Screenshots ${web ? "attached" : "captured in app"}: ${captures.length}`,
    captures.length > 0 ? `Captured routes:\n${captureRoutes}` : null,
    `User agent: ${navigator.userAgent}`,
    "",
    "What happened:",
    description.trim() || "(no description)",
  ]
    .filter((line) => line !== null)
    .join("\n");

  useEffect(() => {
    startSession();
  }, [startSession]);

  useEffect(() => {
    if (!contactPrefillDone.current && accountEmail && !contact.trim()) {
      setContact(accountEmail);
      contactPrefillDone.current = true;
    }
  }, [accountEmail, contact, setContact]);

  const copyReport = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(diagnostics);
      return true;
    } catch {
      toast("Couldn't copy automatically", {
        description: "Select the report text below and copy it manually.",
        variant: "info",
      });
      return false;
    }
  };

  const handleCopyMessage = async () => {
    const ok = await copyReport();
    if (ok) {
      toast("Report copied", {
        description: "Paste it in Discord when you’re ready.",
        variant: "success",
      });
    }
  };

  /** Invite links can't prefill or attach files — copy + open + tell the user. */
  const handleOpenDiscord = async () => {
    if (!description.trim()) {
      toast("Add a short description", {
        description: "Tell us what went wrong before opening Discord.",
        variant: "info",
      });
      return;
    }

    const copied = await copyReport();
    try {
      await openUrl(DISCORD_INVITE_URL);
      toast(copied ? "Discord opened, report copied" : "Discord opened", {
        description:
          "Paste the report (⌘V / Ctrl+V), then attach screenshots of the bug.",
        variant: "success",
      });
    } catch (err) {
      toast("Couldn't open Discord", {
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  return (
    <PageLayout
      title="Report a bug"
      description="Describe the issue, capture the broken screens for your notes, then open Discord and paste the report."
    >
      <AlertBanner
        variant="info"
        title={
          web
            ? "Add screenshots of the bug"
            : active
              ? "Capture mode is on"
              : "Start by visiting the screens where the bug happens"
        }
        description="Discord invite links can’t receive your message or images automatically. Open Discord copies the report for you; paste it, then attach screenshots."
      />

      <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Your account</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Included automatically in the copied report.
          </p>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">
              {accountEmail || "Not signed in"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Product / plan</dt>
            <dd className="font-medium">
              ChannelPulse {planProductLabel(plan)}{" "}
              <span className="text-muted-foreground font-normal">
                ({planStatus}
                {trialDaysLeft != null ? `, ${trialDaysLeft}d trial left` : ""})
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bug-description">What happened?</Label>
          <Textarea
            id="bug-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What were you doing? What did you expect? What went wrong?"
            className="min-h-28"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bug-contact">
            Contact
            {accountEmail ? " (prefilled from your account)" : " (optional)"}
          </Label>
          <Input
            id="bug-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Email or Discord username"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              Screenshots ({captures.length})
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {web
                ? "Add screenshots of the bug from your computer so you know what to attach in Discord (Discord can’t pull these from the app)."
                : "Capture the broken screens with the bar below so you know what to attach in Discord (Discord can’t pull these from the app)."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {web ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      void addImageFiles(e.target.files, "upload");
                    }
                    // reset so picking the same file again re-fires onChange
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlusIcon />
                  Add screenshot
                </Button>
              </>
            ) : null}
            {captures.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => clearCaptures()}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {captures.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
            {web ? (
              <>
                No screenshots yet. Click{" "}
                <span className="font-medium text-foreground">
                  Add screenshot
                </span>{" "}
                to upload images of the bug.
              </>
            ) : (
              <>
                No screenshots yet. Open the screen with the bug and use{" "}
                <span className="font-medium text-foreground">
                  Capture this screen
                </span>{" "}
                on the bar below.
              </>
            )}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {captures.map((c, i) => (
              <li
                key={c.id}
                className="overflow-hidden rounded-lg border border-border/60 bg-background"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/50 px-2 py-1.5">
                  <span className="truncate text-2xs text-muted-foreground">
                    {i + 1}. {c.route}
                  </span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="Remove"
                    onClick={() => removeCapture(c.id)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
                <img
                  src={`data:image/png;base64,${c.base64}`}
                  alt={`Bug screenshot of ${c.route}`}
                  className="max-h-48 w-full object-contain"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Send report</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Click Open Discord (copies this report for you).</li>
            <li>Paste the message in Discord (⌘V / Ctrl+V).</li>
            <li>Attach screenshots of the bug (Discord can’t take them from the app).</li>
          </ol>
        </div>
        <pre className="max-h-40 overflow-auto rounded-lg border border-border/50 bg-background/80 p-3 text-2xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {diagnostics}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleOpenDiscord()}>
            <ExternalLinkIcon />
            Open Discord
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCopyMessage()}
          >
            <ClipboardCopyIcon />
            Copy message
          </Button>
        </div>
      </div>
    </PageLayout>
  );
};

export default ReportBug;
