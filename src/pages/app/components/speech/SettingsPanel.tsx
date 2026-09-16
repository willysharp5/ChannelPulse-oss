import { useState } from "react";
import { Button, Label, Slider, Switch } from "@/components";
import {
  ChevronDownIcon,
  SettingsIcon,
  RotateCcwIcon,
  ChevronUpIcon,
  EyeOffIcon,
} from "lucide-react";
import { VadConfig } from "@/hooks/useSystemAudio";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";

// Sensitivity presets for simpler UX
const SENSITIVITY_PRESETS = {
  low: {
    sensitivity_rms: 0.015,
    noise_gate_threshold: 0.005,
    label: "Low",
    description: "Only picks up clear, loud speech",
  },
  normal: {
    sensitivity_rms: 0.012,
    noise_gate_threshold: 0.003,
    label: "Normal",
    description: "Balanced for typical conversations",
  },
  high: {
    sensitivity_rms: 0.008,
    noise_gate_threshold: 0.002,
    label: "High",
    description: "Picks up quieter speech",
  },
} as const;

type SensitivityPreset = keyof typeof SENSITIVITY_PRESETS;

interface SettingsPanelProps {
  // VAD Config
  vadConfig: VadConfig;
  onUpdateVadConfig: (config: VadConfig) => void;
}

export const SettingsPanel = ({
  vadConfig,
  onUpdateVadConfig,
}: SettingsPanelProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Same stored setting as the dashboard's Settings → Privacy Mode switch and
  // the eye button in this panel's toolbar — read it, don't mirror it in state.
  const { customizable, togglePrivacyMode } = useApp();
  const privacyOn = customizable.privacyMode.isEnabled;

  // Determine current sensitivity preset based on values
  const getCurrentPreset = (): SensitivityPreset | "custom" => {
    for (const [key, preset] of Object.entries(SENSITIVITY_PRESETS)) {
      if (
        Math.abs(vadConfig.sensitivity_rms - preset.sensitivity_rms) < 0.001 &&
        Math.abs(vadConfig.noise_gate_threshold - preset.noise_gate_threshold) <
          0.001
      ) {
        return key as SensitivityPreset;
      }
    }
    return "custom";
  };

  const currentPreset = getCurrentPreset();

  const handlePresetChange = (preset: SensitivityPreset) => {
    const presetValues = SENSITIVITY_PRESETS[preset];
    onUpdateVadConfig({
      ...vadConfig,
      sensitivity_rms: presetValues.sensitivity_rms,
      noise_gate_threshold: presetValues.noise_gate_threshold,
    });
  };

  const handleResetDefaults = () => {
    const defaultConfig: VadConfig = {
      enabled: vadConfig.enabled, // Keep current mode
      hop_size: 1024,
      sensitivity_rms: 0.012,
      peak_threshold: 0.035,
      silence_chunks: 45,
      min_speech_chunks: 7,
      pre_speech_chunks: 12,
      noise_gate_threshold: 0.003,
      max_recording_duration_secs: 180,
    };
    onUpdateVadConfig(defaultConfig);
  };

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      {/* Settings Header - Always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-2.5 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SettingsIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Settings</span>
        </div>
        <ChevronDownIcon
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Settings Content */}
      {isOpen && (
        <div className="px-2.5 pb-2.5 space-y-4">
          {/* Privacy Section — first, because it's the setting people reach for
              mid-call. Mirrors Settings → Privacy Mode in the dashboard. */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Privacy
            </h4>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <EyeOffIcon className="size-3 shrink-0" />
                  Hide from screen shares
                </Label>
                <p className="text-3xs text-muted-foreground mt-0.5">
                  {privacyOn
                    ? "This window is left out of screen shares and recordings, and its dock icon hides while it's tucked away."
                    : "This window behaves like any other app; it shows up in screen shares and recordings."}
                </p>
              </div>
              <Switch
                checked={privacyOn}
                onCheckedChange={(checked) => void togglePrivacyMode(checked)}
                aria-label="Toggle Privacy Mode"
              />
            </div>
            <p className="text-3xs text-muted-foreground">
              Also in the toolbar above (the eye button) and in the app's
              Settings page.
            </p>
          </div>

          {/* Recording Settings Section */}
          <div className="space-y-3 pt-3 border-t border-border/50">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recording
            </h4>

            {/* Sensitivity Presets */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                Speech Sensitivity
              </Label>
              <div className="flex gap-2">
                {(
                  Object.entries(SENSITIVITY_PRESETS) as [
                    SensitivityPreset,
                    (typeof SENSITIVITY_PRESETS)[SensitivityPreset]
                  ][]
                ).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePresetChange(key)}
                    className={cn(
                      "flex-1 min-w-0 px-1.5 py-1.5 rounded-lg text-xs font-medium transition-all border",
                      currentPreset === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-accent"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="text-3xs text-muted-foreground">
                {currentPreset === "custom"
                  ? "Custom sensitivity values"
                  : SENSITIVITY_PRESETS[currentPreset as SensitivityPreset]
                      .description}
              </p>
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <div className="pt-3 border-t border-border/50">
            <button
              type="button"
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span>Advanced Settings</span>
              {showAdvanced ? (
                <ChevronUpIcon className="w-3 h-3" />
              ) : (
                <ChevronDownIcon className="w-3 h-3" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* VAD-specific advanced settings */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center justify-between">
                    <span>Speech Sensitivity (Raw)</span>
                    <span className="text-muted-foreground font-normal">
                      {(vadConfig.sensitivity_rms * 1000).toFixed(1)}
                    </span>
                  </Label>
                  <Slider
                    value={[vadConfig.sensitivity_rms * 1000]}
                    onValueChange={([value]) =>
                      onUpdateVadConfig({
                        ...vadConfig,
                        sensitivity_rms: value / 1000,
                      })
                    }
                    min={1}
                    max={20}
                    step={0.5}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center justify-between">
                    <span>Silence Duration</span>
                    <span className="text-muted-foreground font-normal">
                      {(
                        (vadConfig.silence_chunks * vadConfig.hop_size) /
                        44100
                      ).toFixed(1)}
                      s
                    </span>
                  </Label>
                  <Slider
                    value={[vadConfig.silence_chunks]}
                    onValueChange={([value]) =>
                      onUpdateVadConfig({
                        ...vadConfig,
                        silence_chunks: Math.round(value),
                      })
                    }
                    min={20}
                    max={180}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-3xs text-muted-foreground">
                    How long to wait after speech stops
                  </p>
                </div>

                {/* Noise gate */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center justify-between">
                    <span>Noise Gate</span>
                    <span className="text-muted-foreground font-normal">
                      {(vadConfig.noise_gate_threshold * 1000).toFixed(1)}
                    </span>
                  </Label>
                  <Slider
                    value={[vadConfig.noise_gate_threshold * 1000]}
                    onValueChange={([value]) =>
                      onUpdateVadConfig({
                        ...vadConfig,
                        noise_gate_threshold: value / 1000,
                      })
                    }
                    min={0}
                    max={10}
                    step={0.1}
                    className="w-full"
                  />
                  <p className="text-3xs text-muted-foreground">
                    Filters background noise
                  </p>
                </div>

                {/* Reset button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetDefaults}
                  className="w-full text-xs"
                >
                  <RotateCcwIcon className="w-3 h-3 mr-1.5" />
                  Reset to Defaults
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
