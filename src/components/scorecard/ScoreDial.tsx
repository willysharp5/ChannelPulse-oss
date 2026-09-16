import { cn } from "@/lib/utils";

/**
 * Score visuals for the interview scorecard, on the same red → amber → emerald
 * scale as the evidence chips so a low score and a red moment read as the same
 * kind of signal.
 */

/** Matches the ScoreBadge thresholds in interview-practice/AssessmentReport. */
export function scoreTone(score: number): {
  stroke: string;
  text: string;
  bar: string;
  word: string;
} {
  if (score >= 4) {
    return {
      stroke: "stroke-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      bar: "bg-emerald-500",
      word: score >= 4.5 ? "Strong" : "Good",
    };
  }
  if (score >= 3) {
    return {
      stroke: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      bar: "bg-amber-500",
      word: "Mixed",
    };
  }
  return {
    stroke: "stroke-destructive",
    text: "text-destructive",
    bar: "bg-destructive",
    word: "Needs work",
  };
}

export function ScoreDial({
  score,
  size = 76,
  className,
}: {
  score: number;
  size?: number;
  className?: string;
}) {
  const tone = scoreTone(score);
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, score / 5));

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          className={tone.stroke}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-xl font-semibold tabular-nums", tone.text)}>
          {score}
        </span>
        <span className="text-xs text-muted-foreground">out of 5</span>
      </div>
    </div>
  );
}

/** One dimension: label, bar, score. */
export function ScoreBar({
  label,
  score,
  comment,
}: {
  label: string;
  score: number;
  comment?: string;
}) {
  const tone = scoreTone(score);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn("text-sm font-semibold tabular-nums", tone.text)}>
          {score}/5
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", tone.bar)}
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      {comment ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {comment}
        </p>
      ) : null}
    </div>
  );
}
