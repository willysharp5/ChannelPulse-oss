import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CornerDownRight,
  HelpCircle,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import { matchEvidence } from "@/lib/scorecard/evidence";
import type { ScorecardLine } from "@/lib/scorecard/transcript";
import type { Evidence, Severity } from "@/lib/scorecard/types";

/**
 * The icon you hover to see what was actually said.
 *
 * Built on the existing Popover with controlled `open` rather than adding
 * @radix-ui/react-hover-card: hover opens it, a short close delay lets the
 * pointer travel into the panel, and click toggles it so keyboard and trackpad
 * users get the same thing.
 *
 * The panel shows the REAL transcript line (matched back from the model's
 * quote by lib/scorecard/evidence.ts) with the quote marked, plus the lines
 * either side for context. When the quote can't be found the panel says so
 * instead of passing the model's text off as transcript.
 */

const CLOSE_DELAY_MS = 140;

export const SEVERITY_STYLES: Record<
  Severity,
  { icon: typeof AlertTriangle; chip: string; text: string; label: string }
> = {
  red: {
    icon: AlertTriangle,
    chip: "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
    text: "text-destructive",
    label: "Needs attention",
  },
  yellow: {
    icon: AlertCircle,
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
    label: "Worth a look",
  },
  green: {
    icon: CheckCircle2,
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-400",
    label: "Strong moment",
  },
};

interface EvidenceChipProps {
  evidence: Evidence;
  /** The indexed transcript, so the quote can be matched to a real line. */
  lines: ScorecardLine[];
  /** Flip to the Transcript view and scroll to this message. */
  onJumpToTranscript?: (messageId: string) => void;
  className?: string;
}

export function EvidenceChip({
  evidence,
  lines,
  onJumpToTranscript,
  className,
}: EvidenceChipProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const style = SEVERITY_STYLES[evidence.severity];
  const Icon = style.icon;
  const match = matchEvidence(evidence.quote, lines);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Anchor rather than Trigger: PopoverTrigger force-appends its own
          data-[state=open] background/border classes, which would repaint the
          severity colour off the chip while the panel is open. */}
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={`${style.label}: show transcript`}
          className={cn(
            "inline-flex h-[1.125rem] w-[1.125rem] shrink-0 translate-y-[2px] items-center justify-center rounded-full border transition-colors",
            style.chip,
            className
          )}
          onMouseEnter={openNow}
          onFocus={openNow}
          onMouseLeave={closeSoon}
          onBlur={closeSoon}
          onClick={(e) => {
            e.stopPropagation();
            cancelClose();
            setOpen((v) => !v);
          }}
        >
          <Icon className="h-3 w-3" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        className="w-[22rem] p-0"
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
      >
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("h-3.5 w-3.5", style.text)} />
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                style.text
              )}
            >
              {style.label}
            </span>
            {match.line ? (
              <span className="ml-auto text-xs text-muted-foreground">
                Line {match.line.index}
              </span>
            ) : null}
          </div>

          {match.line ? (
            <TranscriptExcerpt
              before={match.before}
              line={match.line}
              after={match.after}
              span={match.span}
              fallbackQuote={evidence.quote}
            />
          ) : (
            <UnmatchedQuote quote={evidence.quote} speaker={evidence.speaker} />
          )}

          {evidence.note ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {evidence.note}
            </p>
          ) : null}

          {match.line && onJumpToTranscript ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={() => {
                setOpen(false);
                onJumpToTranscript(match.line!.messageId);
              }}
            >
              <CornerDownRight className="h-3 w-3" />
              Jump to transcript
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A whole interview answer can be several hundred words, which would make the
 * popover taller than the window. Keep a window of context either side of the
 * quote and elide the rest.
 */
const CONTEXT_CHARS = 160;

function clipAroundSpan(
  text: string,
  span: { start: number; end: number }
): { text: string; span: { start: number; end: number } } {
  const from = Math.max(0, span.start - CONTEXT_CHARS);
  const to = Math.min(text.length, span.end + CONTEXT_CHARS);
  if (from === 0 && to === text.length) return { text, span };
  const prefix = from > 0 ? "… " : "";
  const clipped =
    prefix + text.slice(from, to) + (to < text.length ? " …" : "");
  const offset = prefix.length - from;
  return {
    text: clipped,
    span: { start: span.start + offset, end: span.end + offset },
  };
}

/** The matched line with its neighbours dimmed, quote marked. */
function TranscriptExcerpt({
  before,
  line,
  after,
  span,
  fallbackQuote,
}: {
  before: ScorecardLine | null;
  line: ScorecardLine;
  after: ScorecardLine | null;
  span: { start: number; end: number } | null;
  fallbackQuote: string;
}) {
  const clipped = span ? clipAroundSpan(line.text, span) : null;
  return (
    <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/40 p-2.5">
      {before ? <ContextLine line={before} /> : null}
      <div className="text-sm leading-relaxed">
        <span className="font-semibold">{line.speaker}: </span>
        {clipped ? (
          <>
            {clipped.text.slice(0, clipped.span.start)}
            <mark className="rounded bg-primary/25 px-0.5 text-inherit">
              {clipped.text.slice(clipped.span.start, clipped.span.end)}
            </mark>
            {clipped.text.slice(clipped.span.end)}
          </>
        ) : (
          <>
            {line.text}
            <span className="mt-1 block text-xs italic text-muted-foreground">
              Closest match to “{fallbackQuote}”.
            </span>
          </>
        )}
      </div>
      {after ? <ContextLine line={after} /> : null}
    </div>
  );
}

function ContextLine({ line }: { line: ScorecardLine }) {
  return (
    <p className="line-clamp-2 text-xs leading-snug text-muted-foreground/70">
      <span className="font-medium">{line.speaker}: </span>
      {line.text}
    </p>
  );
}

/**
 * Shown when the quote isn't in the transcript. Stated plainly — a quote that
 * can't be verified must never look like one that can.
 */
function UnmatchedQuote({
  quote,
  speaker,
}: {
  quote: string;
  speaker?: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed border-border/70 bg-muted/30 p-2.5">
      <p className="text-sm leading-relaxed">
        {speaker ? <span className="font-semibold">{speaker}: </span> : null}“
        {quote}”
      </p>
      <p className="flex items-start gap-1 text-xs italic text-muted-foreground">
        <HelpCircle className="mt-[1px] h-3 w-3 shrink-0" />
        Not found word-for-word in the transcript; treat as a paraphrase.
      </p>
    </div>
  );
}
