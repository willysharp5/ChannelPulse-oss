import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  SpeakButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components";
import {
  type InterviewAssessment,
  type QuestionAssessment,
} from "@/lib/interview";
import { ModelAnswer } from "@/components/interview/ModelAnswer";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

interface AssessmentReportProps {
  assessment: InterviewAssessment;
  templateTitle: string;
  coding?: boolean;
  onPracticeAgain: () => void;
  onBackToSetup: () => void;
  /** When set, shows a Delete button (with confirm) for a saved result. */
  onDelete?: () => void;
}

export function AssessmentReport({
  assessment,
  templateTitle,
  coding = false,
  onPracticeAgain,
  onBackToSetup,
  onDelete,
}: AssessmentReportProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-3 border-b border-border/60 bg-background/95 px-1 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold">
              Assessment: {templateTitle}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {coding
              ? "Pass/fail feedback on each solution, plus answers you can study."
              : "Feedback on what to improve, plus an answer for each question."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBackToSetup}>
            <ArrowLeft className="h-4 w-4" />
            Choose another
          </Button>
          <Button onClick={onPracticeAgain}>
            <RotateCcw className="h-4 w-4" />
            Practice again
          </Button>
          {onDelete ? (
            <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  title="Delete this saved result"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-3">
                <p className="text-sm font-medium">Delete this result?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This permanently removes the saved assessment. This can’t be
                  undone.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setConfirmOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>

      <Card className="gap-4 py-5">
        <CardHeader className="px-5 pb-0">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Overall</CardTitle>
            <ScoreBadge score={assessment.overallScore} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <CopyableBlock label="Summary">
            <p className="text-sm leading-relaxed">
              {assessment.overallSummary}
            </p>
          </CopyableBlock>

          <div className="grid gap-4 sm:grid-cols-3">
            <ListBlock title="Strengths" items={assessment.strengths} />
            <ListBlock
              title="Areas to improve"
              items={assessment.improvements}
            />
            <ListBlock
              title="Recommendations"
              items={assessment.recommendations}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Per-question feedback</h3>
        {assessment.questions.map((q, i) => (
          <Card key={`${i}-${q.question.slice(0, 24)}`} className="gap-3 py-5">
            <CardHeader className="px-5 pb-0">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-sm font-semibold">
                  Question {i + 1}
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  {coding ? (
                    <Badge
                      variant={q.score >= 4 ? "default" : "destructive"}
                      className="text-3xs"
                    >
                      {q.score >= 4 ? "Pass" : "Fail"}
                    </Badge>
                  ) : null}
                  <ScoreBadge score={q.score} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5 text-sm">
              <CopyableBlock label="Interviewer asked">
                <p>{q.question}</p>
              </CopyableBlock>

              <CopyableBlock
                label={coding ? "Your submission" : "Your answer"}
              >
                {q.designImageBase64 ? (
                  <img
                    src={`data:image/png;base64,${q.designImageBase64}`}
                    alt={`Your system design for question ${i + 1}`}
                    className="max-h-[22.5rem] w-full rounded-lg border border-border/60 bg-background object-contain"
                  />
                ) : isDesignAnswerDump(q.answer) ? (
                  <p className="text-sm text-muted-foreground">
                    System design diagram submitted.
                  </p>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {q.answer}
                  </pre>
                )}
              </CopyableBlock>

              {q.strengths.length > 0 ? (
                <ListBlock title="What worked" items={q.strengths} compact />
              ) : null}
              {q.improvements.length > 0 ? (
                <ListBlock title="Improve" items={q.improvements} compact />
              ) : null}

              {(q.modelAnswer || q.modelAnswerHint) && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Answer
                    </div>
                    <div className="flex items-center gap-1">
                      <SpeakButton content={formatModelAnswerText(q)} />
                      <CopyButton
                        content={formatModelAnswerText(q)}
                        copyMessage="Answer copied"
                      />
                    </div>
                  </div>
                  {q.modelAnswerHint ? (
                    <p className="text-sm font-medium">{q.modelAnswerHint}</p>
                  ) : null}
                  {q.modelAnswer ? (
                    <ModelAnswer
                      markdown={q.modelAnswer}
                      category={coding ? "coding" : undefined}
                      className="border-0 bg-transparent p-0"
                    />
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatModelAnswerText(q: QuestionAssessment): string {
  const parts: string[] = [];
  if (q.modelAnswerHint) parts.push(q.modelAnswerHint);
  if (q.modelAnswer) parts.push(q.modelAnswer);
  return parts.join("\n\n");
}

/** Old/saved design answers stored as Components/Connections dumps — hide from UI. */
function isDesignAnswerDump(answer: string): boolean {
  const a = answer.trim();
  return (
    /^###\s*System design diagram/i.test(a) ||
    (/^Components:/m.test(a) && /^Connections:/m.test(a)) ||
    /Shapes \/ labels:/i.test(a)
  );
}

function ScoreBadge({ score }: { score: number }) {
  const variant =
    score >= 4 ? "default" : score >= 3 ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="tabular-nums">
      {score}/5
    </Badge>
  );
}

function CopyableBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function ListBlock({
  title,
  items,
  compact,
}: {
  title: string;
  items: string[];
  compact?: boolean;
}) {
  if (!items.length) {
    return (
      <div className={compact ? "" : "rounded-lg border border-border/50 p-3"}>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {title}
        </div>
        <p className="text-xs text-muted-foreground">None noted.</p>
      </div>
    );
  }
  return (
    <div className={compact ? "" : "rounded-lg border border-border/50 p-3"}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <ul className="list-disc pl-4 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
