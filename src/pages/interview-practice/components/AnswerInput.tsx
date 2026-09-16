import { useCallback, useEffect, useRef, useState } from "react";
import { AlertBanner, Button, RichTextEditor } from "@/components";
import { useApp } from "@/contexts";
import { fetchSTT } from "@/lib";
import { micAudioConstraints, resolveBrowserAudioInputId } from "@/lib/utils";
import { Mic, Square, Type, Loader2 } from "lucide-react";

interface AnswerInputProps {
  disabled?: boolean;
  onSubmit: (answer: string) => void;
  /** Called just before mic recording starts (e.g. pause interviewer TTS). */
  onStartRecording?: () => void;
  /** Prefill when revisiting a past answer (pair with a remount `key`). */
  initialText?: string;
  /** Override the text-mode submit button label. */
  submitLabel?: string;
  /** When false, keep the editor text after submit (default true). */
  clearOnSubmit?: boolean;
  /** Hide the text-mode submit button (parent owns Check / Submit). */
  hideSubmitButton?: boolean;
  /** Live draft updates while typing / after voice review. */
  onTextChange?: (text: string) => void;
}

const BAR_COUNT = 28;

/**
 * Push-to-talk answer capture with a live audio waveform, plus a Type mode for
 * writing/editing. Typing stays available even while the interviewer is speaking
 * (same idea as coding / system-design workbenches).
 */
export function AnswerInput({
  disabled,
  onSubmit,
  onStartRecording,
  initialText = "",
  submitLabel,
  clearOnSubmit = true,
  hideSubmitButton = false,
  onTextChange,
}: AnswerInputProps) {
  const { selectedAudioDevices } =
    useApp();
  const [mode, setMode] = useState<"voice" | "text">(
    initialText ? "text" : "voice"
  );
  const [text, setText] = useState(initialText);

  const updateText = (next: string) => {
    setText(next);
    onTextChange?.(next);
  };
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  // Live waveform (real mic audio).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const stopWaveform = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    for (const bar of barRefs.current) {
      if (bar) bar.style.height = "12%";
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    stopWaveform();
    setIsRecording(false);
  }, [stopWaveform]);

  useEffect(() => () => cleanupRecording(), [cleanupRecording]);

  const startWaveform = (stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
      const draw = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(data);
        for (let i = 0; i < BAR_COUNT; i++) {
          const bar = barRefs.current[i];
          if (!bar) continue;
          const v = (data[i * step] ?? 0) / 255;
          bar.style.height = `${Math.max(12, Math.round(v * 100))}%`;
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);
    } catch {
      // Waveform is best-effort; recording still works without it.
    }
  };

  const startRecording = async () => {
    if (disabled || isRecording || isTranscribing) return;
    setError(null);
    // Pause interviewer TTS so the mic doesn't capture the question audio.
    onStartRecording?.();
    try {
      const browserId = await resolveBrowserAudioInputId(
        selectedAudioDevices?.input?.name
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

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      setDurationMs(0);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100);
      setIsRecording(true);
      startWaveform(stream);
      tickRef.current = setInterval(() => {
        setDurationMs(Date.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      console.error(err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Microphone permission was denied. Allow mic access for this app, then try again."
        );
      } else {
        setError(
          "Could not access the microphone. Check permissions in Audio settings, or switch to Type."
        );
      }
      cleanupRecording();
    }
  };

  const stopAndTranscribe = async () => {
    if (!mediaRecorderRef.current || isTranscribing) return;
    setIsTranscribing(true);
    setError(null);
    stopWaveform();

    const mimeType = mediaRecorderRef.current.mimeType || "audio/webm";
    const chunks = [...chunksRef.current];

    await new Promise<void>((resolve) => {
      const rec = mediaRecorderRef.current;
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);

    try {
      if (chunks.length === 0) {
        setError("No audio captured. Try again.");
        setIsTranscribing(false);
        return;
      }
      const audioBlob = new Blob(chunks, { type: mimeType });
      const transcript = await fetchSTT({ audio: audioBlob });
      const trimmed = (transcript || "").trim();
      if (!trimmed) {
        setError("Couldn’t hear anything. Try speaking a bit louder or longer.");
        setIsTranscribing(false);
        return;
      }
      setIsTranscribing(false);
      // Don't auto-advance. Drop the transcript into the editor so the user can
      // review / edit it and submit when ready.
      setText((prev) => {
        const next = prev.trim() ? `${prev.trim()}\n\n${trimmed}` : trimmed;
        onTextChange?.(next);
        return next;
      });
      setMode("text");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Transcription failed. Try typing instead."
      );
      setIsTranscribing(false);
    }
  };

  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    if (clearOnSubmit) {
      updateText("");
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={mode === "voice" ? "default" : "outline"}
          onClick={() => setMode("voice")}
          disabled={disabled || isRecording}
        >
          <Mic className="h-4 w-4" />
          Speak
        </Button>
        <Button
          size="sm"
          variant={mode === "text" ? "default" : "outline"}
          onClick={() => {
            cleanupRecording();
            setMode("text");
          }}
          disabled={disabled || isRecording}
        >
          <Type className="h-4 w-4" />
          Type
        </Button>
      </div>

      {error ? (
        <AlertBanner
          variant="error"
          title="Answer capture failed"
          description={error}
          onClose={() => setError(null)}
        />
      ) : null}

      {mode === "voice" ? (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isTranscribing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Transcribing your answer…
                </>
              ) : isRecording ? (
                <span className="inline-flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  Recording… {formatTime(durationMs)}
                </span>
              ) : (
                "Press record, answer out loud, then stop when you’re done."
              )}
            </div>
            <div className="flex items-center gap-2">
              {isRecording ? (
                <Button
                  variant="destructive"
                  onClick={stopAndTranscribe}
                  disabled={isTranscribing}
                >
                  <Square className="h-4 w-4" />
                  Stop & review
                </Button>
              ) : (
                <Button
                  onClick={startRecording}
                  disabled={disabled || isTranscribing}
                >
                  <Mic className="h-4 w-4" />
                  Record answer
                </Button>
              )}
            </div>
          </div>

          {/* Live waveform (real mic audio) */}
          {isRecording ? (
            <div className="flex h-12 items-center justify-center gap-[3px] rounded-lg bg-background/60 px-3">
              {Array.from({ length: BAR_COUNT }).map((_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  className="w-1 rounded-full bg-primary/80 transition-[height] duration-75"
                  style={{ height: "12%" }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <RichTextEditor
            value={text}
            onChange={updateText}
            disabled={disabled}
            placeholder="Type your answer here…"
            minHeight={150}
            onSubmit={hideSubmitButton ? undefined : submitText}
          />
          {hideSubmitButton ? (
            <p className="text-xs text-muted-foreground">
              Keep typing or record more; your draft stays here until you
              Check or Submit below.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Rich text · ⌘/Ctrl+Enter to submit
              </p>
              <Button onClick={submitText} disabled={disabled || !text.trim()}>
                {submitLabel || "Submit answer"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
