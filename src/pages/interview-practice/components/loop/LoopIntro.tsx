import { useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui";
import {
  LoopRoleMock,
  LoopRoundsMock,
  LoopClockMock,
  LoopVerdictMock,
} from "@/components/onboarding/AppMocks";
import { safeLocalStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "cp:loop-intro-dismissed";
const OPEN_EVENT = "cp-loop-intro-open";

/** How long each step holds before the flow advances itself, in ms. */
const STEP_MS = 5200;

/** Re-open the (possibly dismissed) Full loop walkthrough from anywhere. */
export function openLoopIntro() {
  safeLocalStorage.removeItem(DISMISS_KEY);
  try {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  } catch {
    // no-op
  }
}

interface Step {
  node: ReactNode;
  /** The rail label — short enough to read as a step, not a sentence. */
  step: string;
  title: string;
  caption: string;
}

const STEPS: Step[] = [
  {
    node: <LoopRoleMock />,
    step: "Pick the role",
    title: "Start with the role you're interviewing for",
    caption:
      "Engineering, data, product, finance or leadership; each comes with the rounds that role actually gets, at your level.",
  },
  {
    node: <LoopRoundsMock />,
    step: "Choose the rounds",
    title: "Take the whole process, or just the rounds you want",
    caption:
      "Tick the rounds you want to sit. The loop tells you how many you've picked and how long the whole thing will take.",
  },
  {
    node: <LoopClockMock />,
    step: "Sit each round",
    title: "One round at a time, each on its own clock",
    caption:
      "45 to 60 minutes of real questions per round, and it can't be paused; closing the app doesn't stop the clock, same as the real thing.",
  },
  {
    node: <LoopVerdictMock />,
    step: "Get the call",
    title: "A grade per round, then one hire / no-hire decision",
    caption:
      "Every round is scored with feedback and model answers, and the committee weighs all of them into a single verdict at the end.",
  },
];

/**
 * The "how it works" walkthrough for the Full loop tab.
 *
 * A loop is the one feature here you can't understand from an empty page: there's
 * nothing on screen until you've already committed to a role and a set of rounds,
 * so a first-time user is asked to start four hours of interviews with no idea
 * what happens. So this plays the flow instead of describing it — the four steps
 * advance on their own, and each card animates the thing that step does (rounds
 * ticking on, a clock draining, scores landing).
 *
 * Same shell as `PracticeIntro` (dismissible, re-openable, dots + arrows) with
 * two additions: the rail is labelled, because these are ordered steps rather
 * than interchangeable slides, and it auto-advances so the empty page is never
 * static. Autoplay stops the moment you touch it — and never starts if the OS
 * asks for reduced motion. There's deliberately no pause/play control: the
 * arrows already stop it, and a transport button on a four-step explainer is one
 * more thing to read.
 */
export function LoopIntro() {
  const [dismissed, setDismissed] = useState(
    () => safeLocalStorage.getItem(DISMISS_KEY) === "1"
  );
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  // Restarts the step's animations when you come back to a step you've seen.
  const [pass, setPass] = useState(0);
  const timer = useRef<number | null>(null);

  // Allow re-opening after dismissal (the "How it works" button).
  useEffect(() => {
    const onOpen = () => {
      setI(0);
      setPass((p) => p + 1);
      setPlaying(!prefersReducedMotion());
      setDismissed(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (dismissed || !playing) return;
    timer.current = window.setTimeout(() => {
      setI((prev) => (prev + 1) % STEPS.length);
      setPass((p) => p + 1);
    }, STEP_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // `i` and `pass` are in the deps so the dwell restarts on every step.
  }, [dismissed, playing, i, pass]);

  if (dismissed) return null;

  const active = STEPS[i];
  const dismiss = () => {
    safeLocalStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };
  /** Any manual move takes over from autoplay — you're driving now. */
  const goTo = (next: number) => {
    setPlaying(false);
    setI((next + STEPS.length) % STEPS.length);
    setPass((p) => p + 1);
  };

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
        {/* `key` remounts the card so its one-shot animations replay per step. */}
        <div key={`${i}-${pass}`} className="cp-reveal flex justify-center">
          {active.node}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              How a loop works
            </span>
            <span className="text-2xs font-medium text-muted-foreground tabular-nums">
              Step {i + 1} of {STEPS.length}
            </span>
          </div>

          <h3 className="text-lg font-semibold">{active.title}</h3>
          <p className="text-sm text-muted-foreground">{active.caption}</p>

          {/* The rail: the four steps, named, so the flow is legible even
              standing still. Progress lives on the bar at the panel's bottom
              edge, not here — inline it was too small to notice. */}
          <ol className="space-y-1.5 pt-0.5">
            {STEPS.map((s, idx) => (
              <li key={s.step}>
                <button
                  onClick={() => goTo(idx)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors",
                    idx === i
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full text-3xs font-bold tabular-nums transition-colors",
                      idx === i
                        ? "bg-primary text-primary-foreground"
                        : idx < i
                          ? "bg-primary/20 text-primary"
                          : "bg-muted-foreground/20 text-muted-foreground"
                    )}
                  >
                    {idx + 1}
                  </span>
                  <span className="flex-1 truncate">{s.step}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              onClick={() => goTo(i - 1)}
              aria-label="Previous step"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              onClick={() => goTo(i + 1)}
              aria-label="Next step"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Autoplay progress, pinned across the bottom of the whole panel: one
          segment per step, so it shows both that it's advancing itself and how
          much of the walkthrough is left. Full-width because the old 40px dash
          on the rail was too small to read as progress. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 flex h-1.5 gap-0.5 overflow-hidden"
      >
        {STEPS.map((s, idx) => (
          <span key={s.step} className="flex-1 bg-muted-foreground/20">
            {idx < i ? (
              <span className="block h-full w-full bg-primary/60" />
            ) : idx === i && playing ? (
              <span
                key={`${i}-${pass}`}
                className="block h-full bg-primary"
                style={{ animation: `cp-dwell ${STEP_MS}ms linear both` }}
              />
            ) : idx === i ? (
              <span className="block h-full w-full bg-primary/60" />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
