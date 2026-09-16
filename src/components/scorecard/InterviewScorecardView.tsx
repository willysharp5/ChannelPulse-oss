import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { SpeakButton } from "@/components";
import { cn } from "@/lib/utils";
import type { ScorecardLine } from "@/lib/scorecard/transcript";
import type {
  InterviewScorecard,
  QuestionReview,
  Verdict3,
} from "@/lib/scorecard/types";
import { EvidenceList, EvidenceRow } from "./EvidenceText";
import { ScoreBar, ScoreDial, scoreTone } from "./ScoreDial";

/**
 * The interview scorecard: overall score, how it breaks down, the key points of
 * what was said, then every question reviewed on its own — what was asked, what
 * was actually answered, whether that answered the question, and what a
 * stronger answer covers.
 */

interface Props {
  scorecard: InterviewScorecard;
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
}

export function InterviewScorecardView({
  scorecard,
  lines,
  onJumpToTranscript,
}: Props) {
  const tone = scoreTone(scorecard.overallScore);

  return (
    <div className="space-y-4">
      <Card className="gap-4 py-5">
        <CardContent className="px-5">
          <div className="flex items-start gap-4">
            <ScoreDial score={scorecard.overallScore} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="cp-display text-2xl leading-tight">
                  {scorecard.headline}
                </h2>
                <Badge variant="secondary" className="text-xs">
                  {tone.word}
                </Badge>
              </div>
              {scorecard.verdict ? (
                <p className={cn("text-base font-medium", tone.text)}>
                  {scorecard.verdict}
                </p>
              ) : null}
              {scorecard.summary ? (
                <p className="text-base leading-relaxed text-muted-foreground">
                  {scorecard.summary}
                </p>
              ) : null}
            </div>
          </div>

          {scorecard.dimensions.length > 0 ? (
            <div className="mt-5 grid gap-x-6 gap-y-3 border-t border-border/50 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {scorecard.dimensions.map((d) => (
                <ScoreBar
                  key={d.label}
                  label={d.label}
                  score={d.score}
                  comment={d.comment}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {scorecard.keyPoints.length > 0 ? (
        <Section title="Key points">
          <EvidenceList
            items={scorecard.keyPoints}
            lines={lines}
            onJumpToTranscript={onJumpToTranscript}
          />
        </Section>
      ) : null}

      {scorecard.moments.length > 0 ? (
        <Section
          title="Flagged moments"
          hint="Hover an icon to see the transcript it came from."
        >
          <div className="space-y-1.5">
            {scorecard.moments.map((moment, i) => (
              <EvidenceRow
                key={`${i}-${moment.quote.slice(0, 24)}`}
                evidence={moment}
                lines={lines}
                onJumpToTranscript={onJumpToTranscript}
              />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <PlainList title="Strengths" items={scorecard.strengths} />
        <PlainList title="Areas to improve" items={scorecard.improvements} />
        <PlainList title="Recommendations" items={scorecard.recommendations} />
      </div>

      {scorecard.questions.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">
            Question by question
            <span className="ml-1.5 font-normal text-muted-foreground">
              ({scorecard.questions.length})
            </span>
          </h3>
          {scorecard.questions.map((q, i) => (
            <QuestionCard
              key={`${i}-${q.question.slice(0, 24)}`}
              index={i}
              question={q}
              lines={lines}
              onJumpToTranscript={onJumpToTranscript}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuestionCard({
  index,
  question: q,
  lines,
  onJumpToTranscript,
}: {
  index: number;
  question: QuestionReview;
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
}) {
  const [showStronger, setShowStronger] = useState(false);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base font-semibold">
            Q{index + 1}
            <span className="ml-2 font-normal text-muted-foreground">
              {q.question}
            </span>
          </CardTitle>
          <Badge
            variant={
              q.score >= 4 ? "default" : q.score >= 3 ? "secondary" : "destructive"
            }
            className="shrink-0 tabular-nums"
          >
            {q.score}/5
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap gap-1.5">
          <VerdictPill
            label="Answered what was asked"
            verdict={q.answeredWhatWasAsked}
          />
          <VerdictPill label="Made sense" verdict={q.madeSense} />
        </div>

        {q.answerSummary ? (
          <div>
            <div className="mb-1 text-sm font-medium text-muted-foreground">
              What you said
            </div>
            <p className="text-base leading-relaxed">{q.answerSummary}</p>
          </div>
        ) : null}

        {q.evidence.length > 0 ? (
          <div>
            <div className="mb-1 text-sm font-medium text-muted-foreground">
              From the transcript
            </div>
            <div className="space-y-1.5">
              {q.evidence.map((item, i) => (
                <EvidenceRow
                  key={`${i}-${item.quote.slice(0, 24)}`}
                  evidence={item}
                  lines={lines}
                  onJumpToTranscript={onJumpToTranscript}
                />
              ))}
            </div>
          </div>
        ) : null}

        {q.strengths.length > 0 || q.improvements.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <PlainList title="What worked" items={q.strengths} compact />
            <PlainList title="Improve" items={q.improvements} compact />
          </div>
        ) : null}

        {q.strongerAnswer ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left"
              onClick={() => setShowStronger((v) => !v)}
              aria-expanded={showStronger}
            >
              <Lightbulb className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-semibold uppercase tracking-wide text-primary">
                A stronger answer
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 text-primary transition-transform",
                  showStronger ? "rotate-180" : ""
                )}
              />
            </button>
            {showStronger ? (
              <div className="space-y-2 px-3 pb-3">
                <div className="flex justify-end">
                  <SpeakButton content={q.strongerAnswer} />
                </div>
                <Markdown>{q.strongerAnswer}</Markdown>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const VERDICT_STYLE: Record<Verdict3, { label: string; className: string }> = {
  yes: {
    label: "Yes",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  partly: {
    label: "Partly",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  no: {
    label: "No",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

function VerdictPill({
  label,
  verdict,
}: {
  label: string;
  verdict: Verdict3;
}) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        style.className
      )}
    >
      {label}: {style.label}
    </span>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {hint ? (
          <p className="text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

function PlainList({
  title,
  items,
  compact,
}: {
  title: string;
  items: string[];
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact ? "" : "rounded-xl border border-border/60 bg-card/50 p-3"
      }
    >
      <div className="mb-1 text-sm font-medium text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None noted.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-base">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
