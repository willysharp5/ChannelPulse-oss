import { useLocation, useNavigate } from "react-router-dom";
import { BugIcon, CameraIcon, CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBugReport } from "@/contexts";
import { cn } from "@/lib/utils";
import { isWeb } from "@/lib";

/**
 * Floating bar while a bug-report session is active. Lets the user capture
 * whatever screen they're on, then return to /report-bug to submit.
 */
export function BugReportCaptureBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    active,
    captures,
    capturing,
    hideChromeForCapture,
    captureScreen,
    endSession,
  } = useBugReport();

  // Web can't capture the screen natively — users upload screenshots on the
  // Report a bug page instead, so this floating capture bar never shows there.
  if (isWeb() || !active || hideChromeForCapture) return null;

  const onReportPage = pathname === "/report-bug";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-4 z-[60] flex justify-center px-4"
      )}
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-1">
          <BugIcon className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">Reporting a bug</span>
          {captures.length > 0 ? (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-3xs font-semibold text-primary">
              {captures.length} shot{captures.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        <Button
          type="button"
          size="sm"
          disabled={capturing}
          onClick={() => void captureScreen(pathname)}
          title={
            onReportPage
              ? "Go to the broken screen first, then capture"
              : "Capture this screen for the bug report"
          }
        >
          <CameraIcon />
          {capturing
            ? "Capturing…"
            : onReportPage
              ? "Capture (go to the bug first)"
              : "Capture this screen"}
        </Button>

        {!onReportPage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigate("/report-bug")}
          >
            <CheckIcon />
            Finish report
          </Button>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            endSession();
            if (!onReportPage) navigate("/report-bug");
          }}
          title="Cancel bug report session"
        >
          <XIcon />
          Cancel
        </Button>
      </div>
    </div>
  );
}
