import { MicIcon } from "lucide-react";
import { Button } from "@/components";
import { AutoSpeechVAD } from "./AutoSpeechVad";
import { UseCompletionReturn } from "@/types";
import { useApp } from "@/contexts";

/**
 * Voice-input toggle. Used to be wrapped in a Popover that showed "Speech
 * Provider Configuration Required / PROVIDER IS MISSING" whenever no local STT
 * provider was selected — which, since STT went managed-only, is every fresh
 * install. It pointed at a settings screen that no longer has that setting, so
 * the advice was impossible to follow. Transcription is server-side now; there
 * is nothing to configure and nothing to warn about.
 */
export const Audio = ({
  micOpen: _micOpen,
  setMicOpen: _setMicOpen,
  enableVAD,
  setEnableVAD,
  submit,
  setState,
}: UseCompletionReturn) => {
  const { selectedAudioDevices } = useApp();

  if (enableVAD) {
    return (
      <AutoSpeechVAD
        key={selectedAudioDevices.input.id}
        submit={submit}
        setState={setState}
        setEnableVAD={setEnableVAD}
        microphoneDeviceId={selectedAudioDevices.input.id}
      />
    );
  }

  return (
    <Button
      size="icon"
      onClick={() => setEnableVAD(true)}
      className="cursor-pointer"
      title="Toggle voice input"
    >
      <MicIcon className="h-4 w-4" />
    </Button>
  );
};
