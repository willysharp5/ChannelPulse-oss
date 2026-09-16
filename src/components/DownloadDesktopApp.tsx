import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { DESKTOP_DOWNLOADS, WINDOWS_DOWNLOAD_AVAILABLE } from "@/config";
import { getPlatform, isWeb } from "@/lib";
import { cn } from "@/lib/utils";

/** Apple logo — lucide dropped brand marks, so we inline a minimal glyph. */
function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M16.365 1.43c0 1.14-.417 2.2-1.11 2.99-.84.98-2.22 1.74-3.36 1.65-.14-1.12.42-2.31 1.08-3.05.75-.85 2.06-1.5 3.24-1.59.01.06.15.13.15.15zM20.94 17.1c-.55 1.27-.81 1.84-1.52 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-1-4.03-.99-2.09.01-2.52 1.01-4.07.99-1.73-.02-3.05-1.78-4.04-3.35C.44 16.9-.19 12.1 1.5 9.19c.87-1.5 2.44-2.45 4.14-2.48 1.62-.03 3.15 1.09 4.03 1.09.88 0 2.75-1.35 4.63-1.15.79.03 3 .32 4.42 2.4-3.66 2.01-3.08 7.26 2.22 8.05z" />
    </svg>
  );
}

/**
 * "Download the desktop app" — the mirror image of `OpenInWeb`.
 *
 * Renders **only on the web build** (returns nothing on desktop, where the app
 * is already installed). Lives in the top-right header cluster in
 * `DashboardLayout`, next to the account controls, so it's visible on every
 * dashboard page: the browser app does everything except live coaching
 * (system-audio capture), so the one thing a web user can't do is exactly the
 * thing this button gets them.
 *
 * The Windows build isn't published yet ({@link WINDOWS_DOWNLOAD_AVAILABLE}),
 * so every visitor gets the Mac installer; Windows visitors also see a
 * "Windows download coming soon" note so the Mac-only link doesn't read as a
 * mistake. Links straight to the installer on the public downloads bucket — no
 * landing-page round trip.
 */
export function DownloadDesktopApp({ className }: { className?: string }) {
  // Desktop already IS the install — nothing to offer.
  if (!isWeb()) return null;

  // getPlatform() reflects the browser's OS on web. Windows has no build yet,
  // so everyone downloads Mac; we just flag it for Windows visitors.
  const isWindows = getPlatform() === "windows";
  const windowsComingSoon = isWindows && !WINDOWS_DOWNLOAD_AVAILABLE;
  const label = "Download the desktop app for Mac";

  return (
    <div className={cn("flex flex-col items-end gap-0.5", className)}>
      <Button asChild size="sm" className="h-8 gap-1.5" title={label} aria-label={label}>
        <a href={DESKTOP_DOWNLOADS.mac} target="_blank" rel="noopener noreferrer">
          <AppleGlyph className="size-4" />
          <span>Download for Mac</span>
          <DownloadIcon className="size-3.5 opacity-80" />
        </a>
      </Button>
      {windowsComingSoon && (
        <span className="text-2xs text-muted-foreground">
          Windows download coming soon
        </span>
      )}
    </div>
  );
}
