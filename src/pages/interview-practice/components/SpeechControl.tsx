import { Button } from "@/components";
import { cn } from "@/lib/utils";
import { Pause, Play, RotateCcw } from "lucide-react";

interface SpeechControlProps {
  speaking?: boolean;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  /** Replay the question from the start (shown when not actively speaking). */
  onReplay?: () => void;
  canReplay?: boolean;
  className?: string;
}

const iconBtn =
  "size-7 text-muted-foreground hover:text-foreground";

/**
 * Icon-only speech controls shown right next to the question: Pause while
 * speaking, Resume while paused, and Replay to hear it again. Pausing also
 * frees the answer input so you can start immediately.
 */
export function SpeechControl({
  speaking,
  paused,
  onPause,
  onResume,
  onReplay,
  canReplay,
  className,
}: SpeechControlProps) {
  const showReplay = !speaking && canReplay && !!onReplay;
  const showPause = speaking && !!onPause;
  const showResume = paused && !!onResume;
  if (!showReplay && !showPause && !showResume) return null;

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {showPause ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={iconBtn}
          onClick={onPause}
          title="Pause the question (start answering anytime)"
          aria-label="Pause the question"
        >
          <Pause className="size-4" />
        </Button>
      ) : null}
      {showResume ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-primary hover:text-primary"
          onClick={onResume}
          title="Resume the question"
          aria-label="Resume the question"
        >
          <Play className="size-4" />
        </Button>
      ) : null}
      {showReplay ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={iconBtn}
          onClick={onReplay}
          title="Replay the question"
          aria-label="Replay the question"
        >
          <RotateCcw className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
