import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Header,
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components";
import { UseSettingsReturn } from "@/types";
import {
  LaptopMinimalIcon,
  MousePointer2Icon,
  Lightbulb,
  CameraIcon,
  PaperclipIcon,
  LoaderIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const ScreenshotConfigs = ({
  screenshotConfiguration,
  handleScreenshotModeChange,
  handleScreenshotEnabledChange,
  hasActiveLicense,
}: UseSettingsReturn) => {
  // Test capture state — mirrors the chat popover's attachment flow.
  const [shots, setShots] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  // Screenshot currently shown enlarged in the lightbox (base64), or null.
  const [enlarged, setEnlarged] = useState<string | null>(null);
  // True while a Selection-Mode drag capture initiated here is in flight, so we
  // only react to the capture events we started.
  const selectionInitiatedRef = useRef(false);

  // Selection Mode returns its result asynchronously via events.
  useEffect(() => {
    let unlistenCaptured: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;
    (async () => {
      unlistenCaptured = await listen("captured-selection", (e: any) => {
        if (!selectionInitiatedRef.current) return;
        selectionInitiatedRef.current = false;
        const base64 = e.payload as string;
        if (base64) {
          setShots((prev) => [...prev, base64]);
          setImagesOpen(true);
        }
        setIsCapturing(false);
      });
      unlistenClosed = await listen("capture-closed", () => {
        if (!selectionInitiatedRef.current) return;
        selectionInitiatedRef.current = false;
        setIsCapturing(false);
      });
    })();
    return () => {
      unlistenCaptured?.();
      unlistenClosed?.();
    };
  }, []);

  // Close the lightbox on Escape and lock background scroll while open.
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [enlarged]);

  const takeScreenshot = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");
        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturing(false);
          return;
        }
      }

      if (screenshotConfiguration.enabled) {
        // Screenshot Mode: capture the whole screen immediately.
        const base64 = await invoke<string>("capture_to_base64");
        setShots((prev) => [...prev, base64]);
        setImagesOpen(true);
        setIsCapturing(false);
      } else {
        // Selection Mode: open the drag-to-select overlay. The result comes
        // back via the "captured-selection" event (see the listener above).
        selectionInitiatedRef.current = true;
        await invoke("start_screen_capture");
        // Keep isCapturing true until the selection completes or is cancelled.
      }
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
      selectionInitiatedRef.current = false;
      setIsCapturing(false);
    }
  };

  const removeShot = (index: number) =>
    setShots((prev) => prev.filter((_, i) => i !== index));

  return (
    <div id="screenshot" className="space-y-3">
      <div className="space-y-3">
        {/* Screenshot Capture Mode: Selection and Screenshot */}
        <div className="space-y-2">
          <div className="flex flex-col">
            <Header
              title="Capture Method"
              description={
                screenshotConfiguration.enabled
                  ? "Screenshot Mode: Quickly capture the entire screen with one click."
                  : "Selection Mode: Click and drag to select a specific area to capture."
              }
            />
          </div>
          <Select
            value={screenshotConfiguration.enabled ? "screenshot" : "selection"}
            onValueChange={(value) =>
              handleScreenshotEnabledChange(value === "screenshot")
            }
          >
            <SelectTrigger className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors">
              <div className="flex items-center gap-2">
                {screenshotConfiguration.enabled ? (
                  <LaptopMinimalIcon className="size-4" />
                ) : (
                  <MousePointer2Icon className="size-4" />
                )}
                <div className="text-sm font-medium">
                  {screenshotConfiguration.enabled
                    ? "Screenshot Mode"
                    : "Selection Mode"}
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="selection" disabled={!hasActiveLicense}>
                <div className="flex items-center gap-2">
                  <MousePointer2Icon className="size-4" />
                  <div className="font-medium">Selection Mode</div>
                  {!hasActiveLicense && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                      You need an active license to use Selection Mode.
                    </span>
                  )}
                </div>
              </SelectItem>
              <SelectItem value="screenshot" className="flex flex-row gap-2">
                <LaptopMinimalIcon className="size-4" />
                <div className="font-medium">Screenshot Mode</div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mode Selection: Auto and Manual */}
        <div className="space-y-2">
          <div className="flex flex-col">
            <Header
              title="Processing Mode"
              description={
                screenshotConfiguration.mode === "manual"
                  ? "Screenshots will be captured and automatically added to your attached files. You can then submit them with your own prompt. you can capture multiple screenshots and submit them later."
                  : "Screenshots are automatically analyzed by AI and the insights are added to your conversation, no prompt needed. Only one screenshot at a time."
              }
            />
          </div>
          <Select
            value={screenshotConfiguration.mode}
            onValueChange={handleScreenshotModeChange}
          >
            <SelectTrigger className="w-full h-11 border-1 border-input/50 focus:border-primary/50 transition-colors">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">
                  {screenshotConfiguration.mode === "auto" ? "Auto" : "Manual"}{" "}
                  Mode
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">
                <div className="font-medium">Manual Mode</div>
              </SelectItem>
              <SelectItem value="auto">
                <div className="font-medium">Auto Mode</div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

      </div>

      {/* Test capture */}
      <div className="space-y-2 pt-1">
        <Header
          title="Test capture"
          description={
            screenshotConfiguration.enabled
              ? "Take a screenshot to confirm capture works. Captured images stack on the upload icon; click it to view (click a thumbnail to enlarge)."
              : "Selection Mode: click, then drag to select an area. The capture stacks on the upload icon; click it to view (click a thumbnail to enlarge)."
          }
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={takeScreenshot}
            disabled={isCapturing}
            className="gap-2 h-11"
          >
            {isCapturing ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : screenshotConfiguration.enabled ? (
              <CameraIcon className="size-4" />
            ) : (
              <MousePointer2Icon className="size-4" />
            )}
            {isCapturing
              ? screenshotConfiguration.enabled
                ? "Capturing…"
                : "Selecting…"
              : screenshotConfiguration.enabled
              ? "Take screenshot"
              : "Select area"}
          </Button>

          <Popover
            open={imagesOpen && shots.length > 0}
            onOpenChange={setImagesOpen}
          >
            <PopoverAnchor asChild>
              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => {
                    if (shots.length > 0) setImagesOpen((v) => !v);
                  }}
                  title="View screenshots"
                  disabled={shots.length === 0}
                >
                  <PaperclipIcon className="size-4" />
                </Button>
                {shots.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-semibold text-primary-foreground">
                    {shots.length}
                  </span>
                )}
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={8}
              className="w-72 p-2"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">
                  Screenshots ({shots.length})
                </span>
                <button
                  onClick={() => setShots([])}
                  className="text-2xs text-destructive hover:underline"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {shots.map((img, i) => (
                  <div key={i} className="relative group">
                    <button
                      type="button"
                      onClick={() => setEnlarged(img)}
                      title="Click to enlarge"
                      className="block w-full cursor-zoom-in overflow-hidden rounded border"
                    >
                      <img
                        src={`data:image/png;base64,${img}`}
                        alt={`Screenshot ${i + 1}`}
                        className="h-20 w-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    </button>
                    <button
                      onClick={() => removeShot(i)}
                      className="absolute top-1 right-1 bg-background/90 border rounded-full p-0.5"
                      title="Remove"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Tips */}
      <div className="text-xs text-muted-foreground/70">
        <p className="flex items-start gap-1.5">
          <Lightbulb className="size-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>Tip:</strong>{" "}
            {screenshotConfiguration.enabled
              ? "Screenshot mode captures the full screen with one click."
              : "Selection mode lets you choose specific areas to capture."}{" "}
            Auto mode is great for quick analysis, manual mode gives you more
            control.
          </span>
        </p>
      </div>

      {/* Enlarged screenshot lightbox (portaled so it covers the window). */}
      {enlarged &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onClick={() => setEnlarged(null)}
            role="button"
            tabIndex={0}
          >
            <button
              onClick={() => setEnlarged(null)}
              title="Close (Esc)"
              type="button"
              className="absolute right-4 top-4 rounded-md border border-white/20 bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            >
              <XIcon className="size-5" />
            </button>
            <img
              src={`data:image/png;base64,${enlarged}`}
              alt="Screenshot preview"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92vh] max-w-[92vw] rounded-lg shadow-2xl"
            />
          </div>,
          document.body
        )}
    </div>
  );
};
