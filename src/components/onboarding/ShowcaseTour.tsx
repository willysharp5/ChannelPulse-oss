import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  OverlayMock,
  TranscriptMock,
  FilesMock,
  PersonasMock,
  InterviewPracticeMock,
  QuestionBankMock,
} from "./AppMocks";

export type ShowcaseSlide = {
  node: ReactNode;
  title: string;
  caption: string;
};

/**
 * localStorage flag: set once the user has seen (or dismissed) the dashboard
 * "How it works" showcase, so it only auto-opens on first launch.
 */
export const HOW_IT_WORKS_SEEN_KEY = "cp:how-it-works-seen-v2";

/**
 * The whole-app "how it works" story, led by the live interview coach. Reused
 * by the dashboard "How it works" modal. Same animated cards as onboarding.
 */
export const APP_SHOWCASE: ShowcaseSlide[] = [
  {
    node: <OverlayMock />,
    title: "Your live interview coach",
    caption:
      "On the real call it hears the question and hands you a quick talking point to work from.",
  },
  {
    node: <TranscriptMock />,
    title: "Real-time, speaker-aware",
    caption: "Every line is attributed as it's spoken.",
  },
  {
    node: <FilesMock />,
    title: "Grounded in your résumé",
    caption: "Answers pull from your real background and files.",
  },
  {
    node: <PersonasMock />,
    title: "Tuned to your scenario",
    caption: "Behavioral, system design, coding. Pick a persona.",
  },
  {
    node: <InterviewPracticeMock />,
    title: "Practice with scored feedback",
    caption:
      "Run mock interviews that grade your answers and show model responses.",
  },
  {
    node: <QuestionBankMock />,
    title: "Real questions, top companies",
    caption:
      "Coding, system design, behavioral & PM, from hundreds of companies.",
  },
];

/**
 * A dismissible, re-openable modal that pages through animated diagram slides.
 * Click the backdrop, the ✕, Escape, or "Done" to exit.
 */
export function ShowcaseTour({
  open,
  onClose,
  onComplete,
  slides = APP_SHOWCASE,
  eyebrow = "How it works",
  doneLabel,
  dismissLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Fires when the user finishes via "Done" (not when they exit early). */
  onComplete?: () => void;
  slides?: ShowcaseSlide[];
  /** Small caps label above the slides. */
  eyebrow?: string;
  /** Overrides the final button's text (and gives it a → instead of a ✓). */
  doneLabel?: string;
  /**
   * A quiet "no thanks" under the final button. Only worth showing when
   * finishing does something the user might not want (the Pro pitch opens the
   * pricing page); the mechanics tour has nothing to opt out of.
   */
  dismissLabel?: string;
}) {
  const [i, setI] = useState(0);

  // Restart at the first slide each time it opens.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Exit on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const slide = slides[i];
  const last = i === slides.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="cp-reveal relative z-10 w-full max-w-xl space-y-6 rounded-[28px] border-2 border-[#1a1a1a]/10 bg-white p-6 text-[#1a1a1a] shadow-2xl sm:p-8">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 cursor-pointer rounded-md p-1.5 text-[#8a8a80] transition-colors hover:bg-[#1a1a1a]/5 hover:text-[#222222]"
        >
          <XIcon className="size-4" />
        </button>

        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#034f46]">
            {eyebrow}
          </span>
        </div>

        {/* Landing-style animated diagram */}
        <div key={i} className="cp-reveal flex justify-center">
          {slide.node}
        </div>

        <div className="space-y-1.5 text-center">
          <h2 className="cp-display text-[1.625rem] font-normal leading-tight">
            {slide.title}
          </h2>
          <p className="mx-auto max-w-sm text-sm text-[#8a8a80]">
            {slide.caption}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {slides.map((_, idx) => (
            <button
              key={idx}
              aria-label={`Slide ${idx + 1}`}
              onClick={() => setI(idx)}
              className={cn(
                "size-1.5 cursor-pointer rounded-full transition-colors",
                idx === i ? "bg-[#034f46]" : "bg-[#1a1a1a]/15"
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            disabled={i === 0}
            onClick={() => setI((v) => Math.max(0, v - 1))}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-[#8a8a80] transition-colors hover:text-[#222222] disabled:cursor-default disabled:opacity-40"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </button>
          {last ? (
            <button
              onClick={() => {
                onComplete?.();
                onClose();
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#034f46] px-5 py-2.5 text-sm font-semibold text-[#f3f4f6] transition-colors hover:bg-[#023a34]"
            >
              {doneLabel ? (
                <>
                  {doneLabel}
                  <ArrowRightIcon className="size-4" />
                </>
              ) : (
                <>
                  <CheckIcon className="size-4" />
                  Show me around
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => setI((v) => v + 1)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#034f46] px-5 py-2.5 text-sm font-semibold text-[#f3f4f6] transition-colors hover:bg-[#023a34]"
            >
              Next
              <ArrowRightIcon className="size-4" />
            </button>
          )}
        </div>

        {last && dismissLabel && (
          <button
            onClick={onClose}
            className="mx-auto block cursor-pointer text-xs text-[#8a8a80] underline-offset-4 transition-colors hover:text-[#222222] hover:underline"
          >
            {dismissLabel}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
