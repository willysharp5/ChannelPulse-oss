import { AudioSelection } from "./components";
import { PageLayout } from "@/layouts";
import { Button } from "@/components";
import { invoke } from "@tauri-apps/api/core";
import { SettingsIcon } from "lucide-react";

const Audio = () => {
  const openSoundSettings = () => {
    invoke("open_sound_settings").catch((err) =>
      console.error("Failed to open sound settings:", err)
    );
  };

  return (
    <PageLayout
      title="Audio Settings"
      description="Configure your audio input and output devices for voice interaction and system audio capture."
    >
      <AudioSelection />

      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 p-3">
        <p className="text-xs text-primary">
          Device not working? ChannelPulse falls back to your system defaults;
          set the right ones in your Sound settings.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={openSoundSettings}
          className="shrink-0 gap-1.5 border-primary/40 text-primary hover:bg-primary/15 hover:text-primary"
        >
          <SettingsIcon className="size-3.5" />
          Open Sound settings
        </Button>
      </div>
    </PageLayout>
  );
};

export default Audio;
