import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";

interface PrivacyModeToggleProps {
  className?: string;
}

export const PrivacyModeToggle = ({ className }: PrivacyModeToggleProps) => {
  const { customizable, togglePrivacyMode } = useApp();
  const isEnabled = customizable.privacyMode.isEnabled;

  const handleSwitchChange = async (checked: boolean) => {
    await togglePrivacyMode(checked);
  };

  return (
    <div id="privacy-mode" className={`space-y-2 ${className}`}>
      <Header
        title="Privacy Mode"
        description="Keep the floating window out of screen recordings and screen shares, and hide its icon from your dock/taskbar while it's tucked away. You can also flip this mid-call from the eye button in the floating window's toolbar."
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {isEnabled ? "Turn off Privacy Mode" : "Turn on Privacy Mode"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {isEnabled
                ? "The window won't appear in screen recordings or shares, and its icon hides from your dock/taskbar while collapsed."
                : "The window behaves like a normal app window, visible in recordings, screen shares, and your dock/taskbar."}
            </p>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={handleSwitchChange}
          aria-label="Toggle Privacy Mode"
        />
      </div>
    </div>
  );
};
