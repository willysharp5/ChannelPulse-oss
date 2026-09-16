import { useEffect, useState } from "react";
import {
  Button,
  Card,
  ContextUsed,
  CopyButton,
  SpeakButton,
  toast,
} from "@/components";
import { Markdown } from "@/components/Markdown";
import { generateBehavioralHints } from "@/lib/interview";
import type { LlmConfig } from "@/lib/llm";
import type { Citation } from "@/types/completion";
import {
  Lightbulb,
  Loader2,
  Sparkles,
  FileText,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";

interface BehavioralHintsProps {
  question: string;
  config: LlmConfig;
  /** Selects the role lens on the behavioral playbook (EM, consulting, finance…). */
  roleLevel?: string | null;
  /** Disabled while the interviewer is still speaking. */
  disabled?: boolean;
}

type Hints = {
  hints: string[];
  modelAnswer: string;
  hasContext: boolean;
  citations?: Citation[];
};

/**
 * On-demand behavioral answer coach — progressive STAR steps + a model answer,
 * grounded in Profile + uploaded Files (e.g. resume). If there's no context
 * yet it prompts them to add it instead of inventing experience.
 */
export function BehavioralHints({
  question,
  config,
  roleLevel,
  disabled,
}: BehavioralHintsProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Hints | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [showModel, setShowModel] = useState(false);

  // Reset when the question changes.
  useEffect(() => {
    setData(null);
    setRevealed(0);
    setShowModel(false);
  }, [question]);

  const getHints = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await generateBehavioralHints({ config, question, roleLevel });
      setData(res);
      setRevealed(res.hints.length ? 1 : 0);
      setShowModel(false);
    } catch (e) {
      toast("Couldn’t fetch hints", {
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const stepsRemaining = data ? Math.max(0, data.hints.length - revealed) : 0;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lightbulb className="size-4 text-primary" />
          Answer coach
        </div>
        {!data || !data.hasContext ? (
          <Button
            size="sm"
            variant="outline"
            onClick={getHints}
            disabled={disabled || loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {loading ? "Thinking…" : data ? "Try again" : "Get hints"}
          </Button>
        ) : null}
      </div>

      {!data ? (
        <p className="text-xs text-muted-foreground">
          Get step-by-step hints tailored to <strong>your</strong> résumé &
          Profile, plus a model STAR answer built from your real experience.
        </p>
      ) : !data.hasContext ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <FileText className="size-3.5" />
            Add your background first
          </p>
          <p className="mt-1">
            To tailor these to your real experience, upload your résumé in{" "}
            <strong>Files</strong> (or fill in your <strong>Profile</strong>).
            I won’t invent experience you haven’t shared.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <ContextUsed citations={data.citations} />
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Steps to structure your answer
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {data.hints.slice(0, revealed).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRevealed((r) => Math.max(0, r - 1))}
              disabled={revealed === 0}
            >
              <ChevronLeft className="size-3.5" />
              Back
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {revealed === 0
                ? `${data.hints.length} steps`
                : `Step ${revealed} of ${data.hints.length}`}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setRevealed((r) => Math.min(r + 1, data.hints.length))
              }
              disabled={stepsRemaining === 0}
            >
              Next step
              <ChevronRight className="size-3.5" />
            </Button>
            {data.modelAnswer ? (
              <Button
                size="sm"
                variant={showModel ? "outline" : "default"}
                className="ml-auto"
                onClick={() => setShowModel((v) => !v)}
              >
                {showModel ? (
                  <>
                    <EyeOff className="size-3.5" />
                    Hide answer
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" />
                    Show answer
                  </>
                )}
              </Button>
            ) : null}
          </div>

          {showModel && data.modelAnswer ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm leading-relaxed">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Answer: grounded in your background
                </div>
                <div className="flex items-center gap-1">
                  <SpeakButton content={data.modelAnswer} />
                  <CopyButton
                    content={data.modelAnswer}
                    copyMessage="Answer copied"
                  />
                </div>
              </div>
              <Markdown>{data.modelAnswer}</Markdown>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
