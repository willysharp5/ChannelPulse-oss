import { MicIcon } from "lucide-react";
import { Button } from "@/components";

interface ChatAudioProps {
  /**
   * Retained for the caller's benefit only. This used to open a popover reading
   * "Speech Provider Required / Provider not configured" whenever no local STT
   * provider was selected — i.e. on every fresh install, since transcription
   * became managed server-side and the setting it told you to change was
   * removed. Clicking the mic now just records.
   */
  micOpen?: boolean;
  setMicOpen?: (open: boolean) => void;
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  disabled: boolean;
}

export const ChatAudio = ({
  isRecording,
  setIsRecording,
  disabled,
}: ChatAudioProps) => {
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={() => setIsRecording(!isRecording)}
      className="size-7 lg:size-9 rounded-lg lg:rounded-xl"
      title={isRecording ? "Recording..." : "Voice input"}
      disabled={disabled}
    >
      <MicIcon
        className={`size-3 lg:size-4 ${
          isRecording ? "text-red-500 animate-pulse" : ""
        }`}
      />
    </Button>
  );
};
