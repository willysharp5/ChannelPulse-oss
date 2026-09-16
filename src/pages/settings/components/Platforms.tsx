import { openUrl } from "@tauri-apps/plugin-opener";
import { GlobeIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import { Button, Header } from "@/components";
import { toast } from "@/components/ui";
import {
  DESKTOP_DOWNLOADS,
  MOBILE_STORE_LINKS,
  SITE_URL,
  WINDOWS_DOWNLOAD_AVAILABLE,
} from "@/config";
import { getPlatform, isTauri } from "@/lib/platform";

/**
 * "Where you can use ChannelPulse" — the three surfaces, in one quiet list.
 *
 * There are already pointers between desktop and web in the header cluster
 * (`OpenInWeb`, `DownloadDesktopApp`), but they're a single icon and a single
 * button: nothing tells you the set exists, or which one to reach for when the
 * app you're in can't do the thing you want. This is that, and only that — one
 * line per surface, no feature matrix. Settings is the right home because it's
 * where people already come looking for "what else is there", and it keeps the
 * working surfaces uncluttered.
 *
 * Renders on **both** builds; the row for the app you're in says so instead of
 * offering a link to itself.
 */
export const Platforms = () => {
  const desktop = isTauri();
  const windowsComingSoon = getPlatform() === "windows" && !WINDOWS_DOWNLOAD_AVAILABLE;
  const store = MOBILE_STORE_LINKS.ios || MOBILE_STORE_LINKS.android;

  return (
    <div id="platforms" className="space-y-3">
      <Header
        title="Where you can use ChannelPulse"
        description="One account across all of them — your practice, notes, files and personas sync, so you can start on one and finish on another."
        isMainTitle
      />

      <div className="divide-y divide-border/60">
        <Row
          icon={<MonitorIcon className="size-4" />}
          title="Desktop app"
          // The only surface that can hear the other side of a call: macOS
          // Core Audio process taps. Neither the browser nor a phone can.
          description={
            windowsComingSoon
              ? "Mac. The only one that can listen to a call's own audio. Windows build coming soon."
              : "Mac. The only one that can listen to a call's own audio."
          }
          action={
            desktop ? undefined : { label: "Download for Mac", url: DESKTOP_DOWNLOADS.mac }
          }
          here={desktop}
        />

        <Row
          icon={<GlobeIcon className="size-4" />}
          title="Web app"
          description="Any browser, nothing to install — including a work laptop you can't install on."
          // The landing page, not the app itself: this build has no account, so
          // `WEB_APP_URL` would be a sign-in screen with nothing explaining it.
          action={desktop ? { label: "See the web app", url: SITE_URL } : undefined}
          here={!desktop}
        />

        <Row
          icon={<SmartphoneIcon className="size-4" />}
          title="Phone app"
          description={
            store
              ? "iPhone and Android, for practising out loud away from your desk."
              : "iPhone and Android, for practising out loud away from your desk. Coming to the App Store and Google Play."
          }
          action={
            MOBILE_STORE_LINKS.ios
              ? { label: "App Store", url: MOBILE_STORE_LINKS.ios }
              : MOBILE_STORE_LINKS.android
              ? { label: "Google Play", url: MOBILE_STORE_LINKS.android }
              : undefined
          }
          secondary={
            MOBILE_STORE_LINKS.ios && MOBILE_STORE_LINKS.android
              ? { label: "Google Play", url: MOBILE_STORE_LINKS.android }
              : undefined
          }
        />
      </div>
    </div>
  );
};

interface Link {
  label: string;
  url: string;
}

interface RowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: Link;
  secondary?: Link;
  /** This is the app you're using right now — nowhere to send you. */
  here?: boolean;
}

const Row = ({ icon, title, description, action, secondary, here }: RowProps) => (
  <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium leading-none">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
    </div>

    <div className="flex shrink-0 items-center gap-1.5">
      {here && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          You're using this
        </span>
      )}
      {action && <LinkButton {...action} />}
      {secondary && <LinkButton {...secondary} />}
    </div>
  </div>
);

/**
 * One button that opens an external URL from either build. The Tauri webview
 * won't navigate away on a plain anchor, so desktop hands the URL to the OS.
 */
const LinkButton = ({ label, url }: Link) => (
  <Button
    size="sm"
    variant="outline"
    className="h-8 whitespace-nowrap"
    title={`${label} · ${url}`}
    onClick={() => {
      if (!isTauri()) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      openUrl(url).catch(() => {
        toast("Couldn't open your browser", { description: url, variant: "error" });
      });
    }}
  >
    {label}
  </Button>
);
