import { fetchSTT } from "@/lib";
import { UseCompletionReturn } from "@/types";
import { useMicVAD } from "@ricky0123/vad-react";
import { LoaderCircleIcon, MicIcon, MicOffIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components";
import { useApp } from "@/contexts";
import { floatArrayToWav } from "@/lib/utils";

interface AutoSpeechVADProps {
  submit: UseCompletionReturn["submit"];
  setState: UseCompletionReturn["setState"];
  setEnableVAD: UseCompletionReturn["setEnableVAD"];
  microphoneDeviceId?: string;
}

const AutoSpeechVADInternal = ({
  submit,
  setState,
  setEnableVAD,
  microphoneDeviceId,
}: AutoSpeechVADProps) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const { hasActiveLicense } = useApp();
  // useMicVAD keeps the initial onSpeechEnd callback — read latest via ref.
  const latest = useRef({ hasActiveLicense, submit, setState });
  latest.current = { hasActiveLicense, submit, setState };

  const audioConstraints: MediaTrackConstraints =
    microphoneDeviceId && microphoneDeviceId !== "default"
      ? { deviceId: { exact: microphoneDeviceId } }
      : {};

  const vad = useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: true,
    additionalAudioConstraints: audioConstraints,
    onSpeechEnd: async (audio) => {
      const {
        hasActiveLicense: licensed,
        submit: doSubmit,
        setState: set,
      } = latest.current;
      try {
        if (!licensed) {
          set((prev: any) => ({
            ...prev,
            error:
              "Your ChannelPulse trial has ended. Open the Dashboard to upgrade.",
          }));
          return;
        }

        // convert float32array to blob
        const audioBlob = floatArrayToWav(audio, 16000, "wav");

        setIsTranscribing(true);

        // Managed backend — no provider to select, and nothing to check first.
        const transcription = await fetchSTT({ audio: audioBlob });

        if (transcription) {
          doSubmit(transcription);
        }
      } catch (error) {
        console.error("Failed to transcribe audio:", error);
        set((prev: any) => ({
          ...prev,
          error:
            error instanceof Error ? error.message : "Transcription failed",
        }));
      } finally {
        setIsTranscribing(false);
      }
    },
  });

  return (
    <>
      <Button
        size="icon"
        onClick={() => {
          if (vad.listening) {
            vad.pause();
            setEnableVAD(false);
          } else {
            vad.start();
            setEnableVAD(true);
          }
        }}
        className="cursor-pointer"
        title={
          isTranscribing
            ? "Transcribing speech…"
            : vad.userSpeaking
            ? "Listening… (speech detected)"
            : vad.listening
            ? "Voice input on. Click to turn off"
            : "Voice input off. Click to turn on"
        }
      >
        {isTranscribing ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin text-green-500" />
        ) : vad.userSpeaking ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin" />
        ) : vad.listening ? (
          <MicOffIcon className="h-4 w-4 animate-pulse" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
      </Button>
    </>
  );
};

export const AutoSpeechVAD = (props: AutoSpeechVADProps) => {
  return <AutoSpeechVADInternal key={props.microphoneDeviceId} {...props} />;
};
