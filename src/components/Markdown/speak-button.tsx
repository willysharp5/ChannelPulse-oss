import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  speakSequence,
  cancelSpeech,
  pullSpeakableChunks,
  splitLeadChunk,
  markdownToSpeech,
  DEFAULT_TTS_SPEED,
  type TtsVoice,
} from "@/lib/tts";

type SpeakButtonProps = {
  /** Text to read aloud. */
  content: string;
  /** Cloud voice; defaults to the same warm "nova" the question section uses. */
  voice?: TtsVoice;
  /**
   * Drop fenced code blocks before speaking, so the coach reads only the
   * explanation — reading code aloud line by line sounds robotic and unhelpful.
   */
  skipCode?: boolean;
  className?: string;
};

/**
 * "Listen" control: reads `content` aloud in a natural, coach-like voice.
 *
 * Uses the SAME path as the interview question narration
 * (PracticeSession.speakQuestion): split into speakable sentence chunks and
 * play them with speakSequence on the cloud voice (Deepgram Aura-2 / "nova"),
 * not one long speak() blob. This matters for quality — sentence chunking gives
 * natural phrasing and prosody, and short per-chunk requests stay on the cloud
 * voice instead of tripping the robotic browser-speechSynthesis fallback that a
 * single long request can hit. Click to play, click again to stop.
 */
export function SpeakButton({
  content,
  voice = "nova",
  skipCode,
  className,
}: SpeakButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "speaking">("idle");
  // Only cancel on unmount if THIS button is the one currently speaking.
  const activeRef = useRef(false);

  useEffect(() => {
    return () => {
      if (activeRef.current) cancelSpeech();
    };
  }, []);

  const onClick = async () => {
    if (status !== "idle") {
      cancelSpeech();
      activeRef.current = false;
      setStatus("idle");
      return;
    }
    const text = markdownToSpeech(content, { stripCode: skipCode });
    if (!text) return;

    // Match the question narration: natural sentence chunks, quick lead chunk.
    const { chunks } = pullSpeakableChunks(text, { flush: true });
    const primed = splitLeadChunk(chunks.length ? chunks : [text]);

    setStatus("loading");
    activeRef.current = true;
    try {
      await speakSequence(primed, {
        voice,
        speed: DEFAULT_TTS_SPEED,
        onStart: () => setStatus("speaking"),
        onEnd: () => {
          activeRef.current = false;
          setStatus("idle");
        },
        onError: () => {
          activeRef.current = false;
          setStatus("idle");
        },
      });
    } catch {
      // Aborted or failed — the text is on screen regardless.
    } finally {
      activeRef.current = false;
      setStatus("idle");
    }
  };

  const active = status !== "idle";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative h-6 w-6", className)}
      aria-label={active ? "Stop reading aloud" : "Listen to this answer"}
      title={active ? "Stop" : "Listen"}
      onClick={onClick}
    >
      {status === "loading" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : status === "speaking" ? (
        <Square className="h-4 w-4 fill-current" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </Button>
  );
}
