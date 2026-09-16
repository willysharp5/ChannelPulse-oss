import { cn } from "@/lib/utils";
import type { ScorecardLine } from "@/lib/scorecard/transcript";
import type { Evidence, Severity } from "@/lib/scorecard/types";
import { EvidenceChip, SEVERITY_STYLES } from "./EvidenceChip";

/**
 * A statement plus the flagged moments backing it: the statement is tinted by
 * its worst severity (red or yellow — the "highlight what was spoken" part of
 * the design) and each moment gets a chip you hover for the real transcript.
 */

const SEVERITY_RANK: Record<Severity, number> = { red: 3, yellow: 2, green: 1 };

/** The worst thing said in this group decides how the line is shaded. */
export function worstSeverity(evidence: Evidence[]): Severity | null {
  let worst: Severity | null = null;
  for (const item of evidence) {
    if (!worst || SEVERITY_RANK[item.severity] > SEVERITY_RANK[worst]) {
      worst = item.severity;
    }
  }
  return worst;
}

/** Left rule + wash, so a flagged point is visible before you read it. */
const TINT: Record<Severity, string> = {
  red: "border-l-2 border-destructive/60 bg-destructive/5 pl-2",
  yellow: "border-l-2 border-amber-500/60 bg-amber-500/5 pl-2",
  green: "border-l-2 border-emerald-500/50 bg-emerald-500/5 pl-2",
};

interface EvidenceTextProps {
  text: string;
  evidence: Evidence[];
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
  /** Rendered after the text, before the chips (e.g. an owner pill). */
  trailing?: React.ReactNode;
  className?: string;
  /** Off for headline text that shouldn't be washed, only chipped. */
  tint?: boolean;
}

export function EvidenceText({
  text,
  evidence,
  lines,
  onJumpToTranscript,
  trailing,
  className,
  tint = true,
}: EvidenceTextProps) {
  const worst = worstSeverity(evidence);
  return (
    <div
      className={cn(
        "rounded-r-md py-0.5 text-base leading-relaxed",
        tint && worst ? TINT[worst] : "",
        className
      )}
    >
      <span className={cn(tint && worst ? SEVERITY_STYLES[worst].text : "")}>
        {text}
      </span>
      {trailing}
      {evidence.length > 0 ? (
        <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
          {evidence.map((item, i) => (
            <EvidenceChip
              key={`${i}-${item.quote.slice(0, 24)}`}
              evidence={item}
              lines={lines}
              onJumpToTranscript={onJumpToTranscript}
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Standalone flagged moments (the "moments" arrays) — the model's note is the
 * text, and the chip carries the quote it came from.
 */
export function EvidenceRow({
  evidence,
  lines,
  onJumpToTranscript,
}: {
  evidence: Evidence;
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
}) {
  const style = SEVERITY_STYLES[evidence.severity];
  return (
    <div className={cn("rounded-r-md py-1", TINT[evidence.severity])}>
      <div className="flex items-start gap-1.5">
        <EvidenceChip
          evidence={evidence}
          lines={lines}
          onJumpToTranscript={onJumpToTranscript}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("text-base leading-snug", style.text)}>
            {evidence.note || style.label}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm italic text-muted-foreground">
            “{evidence.quote}”
          </p>
        </div>
      </div>
    </div>
  );
}

/** A bulleted list of statements, each with its own evidence. */
export function EvidenceList({
  items,
  lines,
  onJumpToTranscript,
  empty = "None noted.",
}: {
  items: { text: string; evidence: Evidence[]; trailing?: React.ReactNode }[];
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
  empty?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={`${i}-${item.text.slice(0, 32)}`} className="flex gap-2">
          <span
            aria-hidden
            className="mt-[0.5625rem] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50"
          />
          <EvidenceText
            text={item.text}
            evidence={item.evidence}
            lines={lines}
            onJumpToTranscript={onJumpToTranscript}
            trailing={item.trailing}
            className="flex-1"
          />
        </li>
      ))}
    </ul>
  );
}
