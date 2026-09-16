import { useEffect, useState, type ReactNode } from "react";
import { XIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui";
import {
  PracticePickMock,
  AnswerFormatsMock,
  InterviewPracticeMock,
  QuestionBankMock,
} from "@/components/onboarding/AppMocks";
import { safeLocalStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "cp:practice-intro-dismissed";
const OPEN_EVENT = "cp-practice-intro-open";

/** Re-open the (possibly dismissed) Practice intro showcase from anywhere. */
export function openPracticeIntro() {
  safeLocalStorage.removeItem(DISMISS_KEY);
  try {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  } catch {
    // no-op
  }
}

const SLIDES: { node: ReactNode; title: string; caption: string }[] = [
  {
    node: <PracticePickMock />,
    title: "Pick what to practice",
    caption:
      "Choose a company, role, or topic: coding, system design, behavioral, or product.",
  },
  {
    node: <AnswerFormatsMock />,
    title: "Answer in any format",
    caption: "Type, code, or speak, with a real editor and system-design canvas.",
  },
  {
    node: <InterviewPracticeMock />,
    title: "Scored feedback & model answers",
    caption:
      "Every answer gets a score, strengths, gaps, and a model response.",
  },
  {
    node: <QuestionBankMock />,
    title: "Real questions, top companies",
    caption: "Verified questions from hundreds of companies.",
  },
];

/**
 * Compact, dismissible "how it works" showcase for the Practice tab — reuses the
 * landing page's animated diagrams so new users see what the app does at a glance.
 */
export function PracticeIntro() {
  const [dismissed, setDismissed] = useState(
    () => safeLocalStorage.getItem(DISMISS_KEY) === "1"
  );
  const [i, setI] = useState(0);

  // Allow re-opening after dismissal (e.g. the "How it works" button).
  useEffect(() => {
    const onOpen = () => {
      setI(0);
      setDismissed(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  if (dismissed) return null;

  const slide = SLIDES[i];
  const dismiss = () => {
    safeLocalStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };
  const go = (dir: 1 | -1) =>
    setI((prev) => (prev + dir + SLIDES.length) % SLIDES.length);

  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>

      <div className="grid items-center gap-5 sm:grid-cols-2">
        <div className="flex justify-center">{slide.node}</div>

        <div className="space-y-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            How it works
          </span>
          <h3 className="text-lg font-semibold">{slide.title}</h3>
          <p className="text-sm text-muted-foreground">{slide.caption}</p>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              onClick={() => go(-1)}
              aria-label="Previous"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <div className="flex items-center gap-1.5">
              {SLIDES.map((_, idx) => (
                <button
                  key={idx}
                  aria-label={`Slide ${idx + 1}`}
                  onClick={() => setI(idx)}
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    idx === i ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              onClick={() => go(1)}
              aria-label="Next"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
