import {
  Card,
  DragButton,
  CustomCursor,
  Button,
  Tooltip,
} from "@/components";
import { SystemAudio, AudioVisualizer } from "./components";
import { MicListener } from "./components/MicListener";
import { useApp, useOverlayClickThrough } from "@/hooks";
import { useApp as useAppContext, useAuth, useTheme } from "@/contexts";
import { useOnboardingComplete } from "@/lib/onboarding";
import {
  SettingsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MicIcon,
  MicOffIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const { configured, isSignedIn, loading } = useAuth();
  const { transparency } = useTheme();
  const onboardingDone = useOnboardingComplete();
  const platform = getPlatform();

  // Hide the floating overlay entirely until the user is signed in AND has
  // finished first-run setup (managed mode). When auth isn't configured
  // (admin/local build), always show it.
  const gated = configured && (loading || !isSignedIn || !onboardingDone);

  // The overlay is a transparent, full-size window; only capture the mouse
  // over visible controls (the pill, and — while the transcript/details panel
  // is open — its own Radix Popover wrapper, detected automatically by
  // useOverlayClickThrough via `[data-radix-popper-content-wrapper]`).
  // Everywhere else, clicks pass through to the app or desktop behind it,
  // even with the panel open. Past the Window Transparency slider's top end
  // (Settings → Theme), the panel becomes click-through too, matching
  // `--opacity` in theme.context.tsx — see useOverlayClickThrough's docstring
  // for why the pill itself stays exempt.
  const panelOpacity = (100 - transparency) / 100;
  useOverlayClickThrough(false, panelOpacity);

  // Nothing visible + fully click-through before sign-in.
  if (gated) {
    return <div className="w-screen h-screen pointer-events-none" />;
  }

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  };

  // Toggle the details panel (transcript + AI response + tools) and resize.
  const toggleDetails = () => {
    const open = !systemAudio.isPopoverOpen;
    systemAudio.setIsPopoverOpen(open);
    systemAudio.resizeWindow(open);
  };

  return (
    <ErrorBoundary
      fallbackRender={({ error }) => {
        return <ErrorLayout isCompact message={error?.message} />;
      }}
      onError={(error, info) => {
        console.error("App overlay caught an error:", error, info);
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div
        className={`w-screen h-screen flex overflow-hidden justify-center items-start pt-1 ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        <Card
          data-overlay-interactive="true"
          className="flex flex-row items-center gap-1 p-1.5 rounded-full w-fit shadow-lg"
        >
          {/* Left: start (headphones) / stop (X) listening + details panel */}
          <SystemAudio {...systemAudio} />

          {systemAudio.capturing ? (
            /* LISTENING: waveform + mic toggle + show-details */
            <>
              <div className="w-28 h-8 flex items-center overflow-hidden px-1">
                <AudioVisualizer isRecording={systemAudio.capturing} />
              </div>

              <Tooltip
                label={
                  systemAudio.micEnabled
                    ? "Microphone on. Click to mute"
                    : "Microphone off. Click to also hear you"
                }
              >
                <Button
                  size="icon"
                  variant={systemAudio.micEnabled ? "default" : "ghost"}
                  className="cursor-pointer rounded-full"
                  onClick={() =>
                    systemAudio.setMicEnabled(!systemAudio.micEnabled)
                  }
                >
                  {systemAudio.micEnabled ? (
                    <MicIcon className="h-4 w-4" />
                  ) : (
                    <MicOffIcon className="h-4 w-4" />
                  )}
                </Button>
              </Tooltip>

              <Tooltip
                label={
                  systemAudio.isPopoverOpen
                    ? "Hide details"
                    : "Show transcript, response & tools"
                }
              >
                <Button
                  size="icon"
                  className="cursor-pointer rounded-full"
                  onClick={toggleDetails}
                >
                  {systemAudio.isPopoverOpen ? (
                    <ChevronUpIcon className="h-4 w-4" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4" />
                  )}
                </Button>
              </Tooltip>
            </>
          ) : (
            /* IDLE: settings */
            <Tooltip label="Settings">
              <Button
                size="icon"
                className="cursor-pointer rounded-full"
                onClick={openDashboard}
              >
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}

          {/* ChannelPulse OSS ships no auto-updater: update by downloading a
              new release from GitHub. The commercial build's in-app updater
              relied on a hosted release feed + private signing key. */}
          <Tooltip label="Drag to move">
            <DragButton />
          </Tooltip>

          {/* Mic capture stays mounted for the whole capture session so the
              audio session is activated exactly once. Pausing is handled
              inside MicListener (it stops transcribing) rather than by
              unmounting: tearing down + re-acquiring getUserMedia while another
              app (e.g. Zoom) holds the system audio session makes WebKit's
              synchronous audio-session activation block the JS thread and
              freezes the whole overlay. */}
          {systemAudio.capturing && systemAudio.micEnabled && (
            <MicListener systemAudio={systemAudio} />
          )}
        </Card>

        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
