import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, XIcon } from "lucide-react";

export interface TourStep {
  /** CSS selector of the element to spotlight. Omit for a centered step. */
  selector?: string;
  title: string;
  /** Optional short lead line. */
  body?: React.ReactNode;
  /** Concise bullet points (supports bold via inline JSX). */
  bullets?: React.ReactNode[];
  /** Preferred bubble placement relative to the target. Auto-flips if needed. */
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const BUBBLE_W = 340;
const PAD = 8; // spotlight padding around the target
const GAP = 14; // gap between target and bubble

/**
 * A spotlight/coach-mark tour: dims the screen, cuts a highlight around the
 * target element, and shows an explanatory bubble beside it. Targets are found
 * by CSS selector (tag elements with `data-tour="…"`). Steps without a selector
 * render a centered bubble (e.g. the welcome step).
 */
export function SpotlightTour({
  open,
  steps,
  onClose,
}: {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleH, setBubbleH] = useState(0);

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const step = steps[i];

  const measure = useCallback(() => {
    if (!open || !step) return;
    if (!step.selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    // Measure after the (possible) scroll settles.
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    });
  }, [open, step]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, measure]);

  // Measure the bubble so we can keep it fully inside the viewport.
  useLayoutEffect(() => {
    if (open && bubbleRef.current) {
      const h = bubbleRef.current.offsetHeight;
      setBubbleH((prev) => (prev !== h ? h : prev));
    }
  });

  if (!open || !step) return null;

  const last = i === steps.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Fallback height until the bubble is measured, so first paint isn't wildly off.
  const bh = bubbleH || 240;
  const clampTop = (t: number) => Math.max(12, Math.min(t, vh - bh - 12));

  // Compute bubble position (numeric top, always clamped inside the viewport).
  let bubbleStyle: React.CSSProperties = {
    width: BUBBLE_W,
    maxHeight: vh - 24,
    overflowY: "auto",
  };
  if (!rect) {
    bubbleStyle = {
      ...bubbleStyle,
      top: Math.max(12, (vh - bh) / 2),
      left: Math.max(12, (vw - BUBBLE_W) / 2),
    };
  } else {
    const placement = step.placement ?? "bottom";
    const clampLeft = Math.min(
      Math.max(12, rect.left),
      Math.max(12, vw - BUBBLE_W - 12)
    );
    const below = rect.top + rect.height + GAP;
    const above = rect.top - GAP - bh;
    if (placement === "right" && rect.left + rect.width + BUBBLE_W + GAP < vw) {
      bubbleStyle = {
        ...bubbleStyle,
        top: clampTop(rect.top),
        left: rect.left + rect.width + GAP,
      };
    } else if (placement === "left" && rect.left - BUBBLE_W - GAP > 0) {
      bubbleStyle = {
        ...bubbleStyle,
        top: clampTop(rect.top),
        left: rect.left - BUBBLE_W - GAP,
      };
    } else {
      // Below by default; flip above when it wouldn't fit; always clamp.
      const wantAbove = placement === "top" || below + bh > vh - 12;
      const top = wantAbove && above >= 12 ? above : below;
      bubbleStyle = { ...bubbleStyle, top: clampTop(top), left: clampLeft };
    }
  }

  return createPortal(
      <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true">
        {/* Click blocker so stray clicks don't hit the app during the tour. */}
        <div className="absolute inset-0" onClick={() => {}} />

        {/* Spotlight cutout (dims everything else via a huge box-shadow). */}
        {rect ? (
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/55" />
        )}

        {/* Bubble */}
        <div
          ref={bubbleRef}
          className="absolute rounded-2xl border border-border bg-background p-5 shadow-2xl"
          style={bubbleStyle}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Step {i + 1} of {steps.length}
            </span>
            <button
              onClick={onClose}
              aria-label="Close tour"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <h3 className="text-base font-semibold">{step.title}</h3>
          {step.body ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
          ) : null}
          {step.bullets?.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {step.bullets.map((b, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  idx === i ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
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
                Got it
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setI((x) => Math.min(steps.length - 1, x + 1))}
              >
                Next
                <ArrowRightIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
}
