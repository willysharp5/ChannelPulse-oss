import {
  Theme,
  AIProvider,
  SpeechToText,
  AlwaysOnTopToggle,
  PrivacyModeToggle,
  AutostartToggle,
  SyncStatus,
  Platforms,
  DeleteAccount,
} from "./components";
import { PageLayout } from "@/layouts";
import { isTauri } from "@/lib/platform";

/**
 * App Settings. Served by BOTH route tables (src/routes/index.tsx and
 * src/routes/web.tsx): the native-window preferences below only exist in the
 * desktop app, but account deletion has to be reachable from the browser too —
 * Google Play's account-deletion policy wants a web URL, and "go install the
 * desktop app to close your account" isn't one. So the three window toggles are
 * gated on `isTauri()` (they drive Tauri window/autostart APIs through useApp
 * and would silently do nothing in a browser) while sync, theme and the danger
 * zone render everywhere.
 */
const Settings = () => {
  const desktop = isTauri();

  return (
    <PageLayout title="Settings" description="Manage your settings">
      {/* AI provider — the core of the local-first setup */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <AIProvider />
      </div>

      {/* Cloud sync & backup */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <SyncStatus />
      </div>

      {/* Theme */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <Theme />
      </div>

      {desktop && (
        <>
          {/* Speech-to-text: on-device whisper.cpp by default, or the user's own
              cloud provider if they pick one. */}
          <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
            <SpeechToText />
          </div>

          {/* Autostart Toggle */}
          <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
            <AutostartToggle />
          </div>

          {/* Privacy Mode Toggle */}
          <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
            <PrivacyModeToggle />
          </div>

          {/* Always On Top Toggle */}
          <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
            <AlwaysOnTopToggle />
          </div>
        </>
      )}

      {/* The other two apps. Informational rather than a setting, so it sits at
          the bottom — but it renders on both builds, since neither one tells you
          the full set exists. */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <Platforms />
      </div>

      {/* Danger zone — same control as the Profile page, deliberately duplicated
          because this is where people look for it. */}
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <DeleteAccount />
      </div>
    </PageLayout>
  );
};

export default Settings;
