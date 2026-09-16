import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  SparklesIcon,
  HeadphonesIcon,
  GraduationCapIcon,
  CircleHelpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";

/**
 * The "what the app is + how to use it" tour. Shown once during first-run
 * onboarding, and replayable anytime from the Dashboard ("How it works").
 */
export const TOUR_SLIDES: {
  Icon: React.ElementType;
  title: string;
  body: string;
  hint?: string;
}[] = [
  {
    Icon: SparklesIcon,
    title: "Meet your interview coach",
    body: "ChannelPulse helps you win interviews two ways: practice realistic mock interviews on your own, then get live notes and coaching during the real one.",
  },
  {
    Icon: HeadphonesIcon,
    title: "The live notes window",
    body: "A floating window that listens, labels who's speaking, and shows a short suggested talking point you can say out loud. Pause anytime, or snap a screenshot for context. Want it excluded from screen shares/recordings? Turn on Privacy Mode in Settings.",
    hint: 'Start it with “Start listening” on the Dashboard (or the floating icon).',
  },
  {
    Icon: GraduationCapIcon,
    title: "Interview Practice",
    body: "Run scored mock interviews with an AI interviewer, drill real questions by company and role, and review model answers for every question.",
    hint: "Open “Interview practice” from the sidebar or the Dashboard.",
  },
  {
    Icon: CircleHelpIcon,
    title: "Help whenever you need it",
    body: "Tap Help in the sidebar for step-by-step guides on every feature, or join our Discord community to ask questions and share wins.",
  },
];

/** Standalone, replayable tour modal (no profile/persona setup). */
export function GuidedTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);

  // Restart at the first slide each time it's opened.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  if (!open) return null;
  const slide = TOUR_SLIDES[i];
  const last = i === TOUR_SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <slide.Icon className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">{slide.title}</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {slide.body}
          </p>
        </div>

        {slide.hint ? (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
            {slide.hint}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-center gap-1.5">
          {TOUR_SLIDES.map((_, idx) => (
            <div
              key={idx}
              className={cn(
                "size-1.5 rounded-full transition-colors",
                idx === i ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={i === 0}
            onClick={() => setI((x) => Math.max(0, x - 1))}
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Button>
          {last ? (
            <Button size="sm" className="gap-1.5" onClick={onClose}>
              <CheckIcon className="size-4" />
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setI((x) => x + 1)}
            >
              Next
              <ArrowRightIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
