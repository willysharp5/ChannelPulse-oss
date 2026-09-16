import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import {
  SquareIcon,
  PlayIcon,
  RotateCcwIcon,
  Volume2Icon,
  AlertTriangle,
} from "lucide-react";
import { useApp } from "@/contexts";
import {
  micAudioConstraints,
  resolveBrowserAudioInputId,
  resolveBrowserAudioOutputId,
} from "@/lib/utils";

const RECORD_SECS = 5;

/**
 * Records a few seconds from the selected microphone and plays it back through
 * the selected output. A quick, engine-independent way to confirm the mic is
 * actually set up and capturing — useful before blaming a streaming provider.
 */
export const MicPlaybackTest = ({ className }: { className?: string }) => {
  const { selectedAudioDevices } = useApp();

  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);

  const clearTimers = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    clearTimers();
  };

  const startRecording = async () => {
    setError(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    try {
      const browserId = await resolveBrowserAudioInputId(
        selectedAudioDevices.input.name
      );
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(browserId),
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(),
        });
      }
      streamRef.current = stream;
      chunksRef.current = [];

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        setRecordedUrl(URL.createObjectURL(blob));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsRecording(false);
        setCountdown(0);
      };

      mr.start();
      setIsRecording(true);
      setCountdown(RECORD_SECS);
      countdownRef.current = window.setInterval(() => {
        setCountdown((c) => (c > 0 ? c - 1 : 0));
      }, 1000);
      timeoutRef.current = window.setTimeout(stopRecording, RECORD_SECS * 1000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not access the microphone. Check permissions."
      );
      setIsRecording(false);
    }
  };

  const playRecording = async () => {
    if (!recordedUrl || isPlayingBack) return;
    try {
      const audio = playbackRef.current ?? new Audio();
      playbackRef.current = audio;
      audio.src = recordedUrl;
      const outId = await resolveBrowserAudioOutputId(
        selectedAudioDevices.output.name
      );
      const anyAudio = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (outId && typeof anyAudio.setSinkId === "function") {
        try {
          await anyAudio.setSinkId(outId);
        } catch {
          // Falls back to default output.
        }
      }
      audio.onended = () => setIsPlayingBack(false);
      setIsPlayingBack(true);
      await audio.play();
    } catch {
      setIsPlayingBack(false);
      setError("Couldn't play back the recording.");
    }
  };

  const resetRecording = () => {
    playbackRef.current?.pause();
    playbackRef.current = null;
    setIsPlayingBack(false);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
  };

  useEffect(() => {
    return () => {
      clearTimers();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      playbackRef.current?.pause();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      {isRecording ? (
        <div className="rounded-md border border-input/50 bg-background/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
                <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
              </span>
              Recording… {countdown}s
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={stopRecording}
              className="gap-1.5"
            >
              <SquareIcon className="size-3" />
              Stop
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground">
            Say a short sentence. You can play it back once recording stops.
          </p>
        </div>
      ) : recordedUrl ? (
        <div className="rounded-md border border-input/50 bg-background/60 p-3 space-y-2">
          <p className="text-xs font-medium">
            Mic captured audio. Play it back to confirm it's working.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={playRecording}
              disabled={isPlayingBack}
              className="gap-2 h-9"
            >
              <PlayIcon
                className={`size-4 ${isPlayingBack ? "animate-pulse" : ""}`}
              />
              {isPlayingBack ? "Playing…" : "Play recording"}
            </Button>
            <Button
              variant="ghost"
              onClick={startRecording}
              className="gap-2 h-9"
            >
              <RotateCcwIcon className="size-4" />
              Re-record
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetRecording}
              className="ml-auto text-muted-foreground"
            >
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={startRecording}
          className="gap-2"
        >
          <Volume2Icon className="size-3.5" />
          Record {RECORD_SECS}s &amp; play back
        </Button>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}
    </div>
  );
};
