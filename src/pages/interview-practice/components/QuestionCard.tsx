import { Badge, Button, Card, Highlight, SpeakButton } from "@/components";
import { Markdown } from "@/components/Markdown";
import { ModelAnswer } from "@/components/interview/ModelAnswer";
import {
  CATEGORY_LABELS,
  formatBankQuestion,
  normalizeAnswerMarkdown,
  type BankQuestion,
  type PracticedQuestionInfo,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Play,
} from "lucide-react";

const diffVariant = (d: string) =>
  d === "hard" ? "destructive" : d === "easy" ? "secondary" : "outline";

interface QuestionCardProps {
  q: BankQuestion;
  open: boolean;
  onToggle: () => void;
  /** Show the company badge (for cross-company lists). */
  showCompany?: boolean;
  /** Multi-select for practice sessions. */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Practice this single question. */
  onPractice?: () => void;
  /** Prior assessed practice progress for this bank question. */
  practiced?: PracticedQuestionInfo | null;
  /** Active search query — matched words are highlighted in the result. */
  query?: string;
}

const questionProse = cn(
  "cp-md text-base leading-relaxed text-foreground",
  "[&_p]:mb-0 [&_p+p]:mt-3",
  "[&_strong]:font-semibold",
  "[&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]"
);

/** Shared bank question card: badges, source link, formatted answer. */
export function QuestionCard({
  q,
  open,
  onToggle,
  showCompany,
  selectable,
  selected,
  onSelectedChange,
  onPractice,
  practiced,
  query,
}: QuestionCardProps) {
  const questionMd = formatBankQuestion(q.question);
  const done = !!practiced;
  const searching = !!(query && query.trim());

  return (
    <Card
      className={cn(
        "gap-2.5 p-5 transition-colors",
        selected && "border-primary/50 bg-primary/5",
        done && !selected && "border-emerald-500/30 bg-emerald-500/[0.06]"
      )}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect question" : "Select question"}
            onClick={() => onSelectedChange?.(!selected)}
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/80 text-transparent hover:border-primary/60"
            )}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </button>
        ) : null}

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {done ? (
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs text-emerald-700 dark:text-emerald-400"
                  title={
                    practiced.lastPracticedAt
                      ? `Practiced ${new Date(
                          practiced.lastPracticedAt
                        ).toLocaleDateString()}${
                          practiced.score != null
                            ? ` · best ${practiced.score}/5`
                            : ""
                        }`
                      : "Already practiced"
                  }
                >
                  <CheckCircle2 className="size-3" />
                  Done
                  {practiced.score != null ? ` · ${practiced.score}/5` : ""}
                </Badge>
              ) : null}
              {showCompany && q.company_name ? (
                <Badge className="gap-1 text-xs">
                  <Building2 className="size-3" />
                  <Highlight text={q.company_name} query={query} />
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-xs">
                {CATEGORY_LABELS[q.category]}
              </Badge>
              <Badge
                variant={diffVariant(q.difficulty)}
                className="text-xs capitalize"
              >
                {q.difficulty}
              </Badge>
              {q.role_level ? (
                <Badge variant="secondary" className="text-xs">
                  {q.role_level}
                </Badge>
              ) : null}
              {q.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline" className="text-xs">
                  <Highlight text={t} query={query} />
                </Badge>
              ))}
            </div>
            {onPractice ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={onPractice}
                  title={
                    done ? "Practice this question again" : "Practice this question"
                  }
                >
                  <Play className="size-3.5" />
                  {done ? "Retry" : "Practice"}
                </Button>
              </div>
            ) : null}
          </div>
          {q.stage || q.reported_at ? (
            <p className="text-xs text-muted-foreground">
              {q.stage ? q.stage : null}
              {q.stage && q.reported_at ? " · " : null}
              {q.reported_at
                ? `reported ${new Date(q.reported_at).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      year: "numeric",
                    }
                  )}`
                : null}
            </p>
          ) : null}
          {searching ? (
            // In search results, render the question as highlighted plain text
            // so the matched words are visibly marked.
            <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
              <Highlight text={q.question} query={query} />
            </p>
          ) : (
            <div className={questionProse}>
              <Markdown>{normalizeAnswerMarkdown(questionMd)}</Markdown>
            </div>
          )}
          {q.model_answer ? (
            <div>
              <button
                onClick={onToggle}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    open && "rotate-180"
                  )}
                />
                {open ? "Hide answer" : "Answer"}
              </button>
              {open ? (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-end">
                    <SpeakButton content={q.model_answer} />
                  </div>
                  <ModelAnswer markdown={q.model_answer} category={q.category} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
