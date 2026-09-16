import { useApp, useTheme } from "@/contexts";
import { Header, Label, Slider, Button, Switch } from "@/components";
import {
  MonitorIcon,
  MoonIcon,
  SunIcon,
  Lightbulb,
  MousePointerClick,
  CheckCircle2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components";
import { FULLY_TRANSPARENT_OPACITY } from "@/hooks";
import { cn } from "@/lib/utils";

export const Theme = () => {
  const {
    theme,
    transparency,
    setTheme,
    onSetTransparency,
    highContrastText,
    onSetHighContrastText,
  } = useTheme();
  const { hasActiveLicense } = useApp();
  // Same formula as --opacity in theme.context.tsx and panelOpacity in
  // pages/app/index.tsx — single source of truth for the threshold lives in
  // useOverlayClickThrough.ts.
  const opacity = (100 - transparency) / 100;
  const clickThroughEnabled = opacity <= FULLY_TRANSPARENT_OPACITY;

  return (
    <div id="theme" className="relative space-y-3">
      <Header
        title={`Theme Customization ${
          hasActiveLicense
            ? ""
            : " (You need an active license to use this feature)"
        }`}
        description="Personalize your experience with custom theme and transparency settings"
        isMainTitle
      />

      {/* Theme Toggle */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                {theme === "system" ? (
                  <>
                    <MonitorIcon className="h-4 w-4" />
                    System
                  </>
                ) : theme === "light" ? (
                  <>
                    <SunIcon className="h-4 w-4" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <MoonIcon className="h-4 w-4" />
                    Dark Mode
                  </>
                )}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {theme === "light"
                  ? "Using light theme for better visibility in bright environments"
                  : "Using dark theme for comfortable viewing in low light"}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                {theme === "system" ? (
                  <MonitorIcon className="h-[1.2rem] w-[1.2rem]" />
                ) : (
                  <>
                    <SunIcon className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                    <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Transparency Slider */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <Header
          title="Window Transparency"
          description="Adjust the transparency level of the application window"
        />
        <div className="space-y-3">
          <div className="flex items-center gap-4 mt-4">
            <Slider
              value={[transparency]}
              onValueChange={(value: number[]) => onSetTransparency(value[0])}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
          </div>

          <p className="text-xs text-muted-foreground/70 flex items-start gap-1.5">
            <Lightbulb className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Tip: Higher transparency lets you see through the window, perfect
              for dark overlay. Changes apply immediately.
            </span>
          </p>

          {/* Visible status, not just a number on a slider — appears once
              transparency crosses the click-through threshold so it's clear
              *why* clicks started passing through the transcript panel.
              Semantic tokens only (bg-primary/text-muted-foreground/etc.),
              so this reads correctly in both Light and Dark mode. */}
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
              clickThroughEnabled
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/50 bg-muted/40 text-muted-foreground"
            )}
          >
            {clickThroughEnabled ? (
              <CheckCircle2 className="size-3.5 shrink-0" />
            ) : (
              <MousePointerClick className="size-3.5 shrink-0" />
            )}
            <span>
              {clickThroughEnabled
                ? "Click-through enabled. Clicks now pass through the transcript window."
                : "Slide further right to make the transcript window click-through too."}
            </span>
          </div>
        </div>
      </div>

      {/* High-contrast text — caption plate for very-transparent overlays */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">High-contrast text</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Adds a subtle backing plate behind text so it stays readable over
              any window at high transparency. The window still shows through.
            </p>
          </div>
          <Switch
            checked={highContrastText}
            onCheckedChange={onSetHighContrastText}
          />
        </div>
      </div>
    </div>
  );
};
