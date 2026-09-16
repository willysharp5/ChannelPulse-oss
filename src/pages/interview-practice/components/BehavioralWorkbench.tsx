import { useEffect, useState } from "react";
import { Badge, Button, CopyButton, toast } from "@/components";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import type { LlmConfig } from "@/lib/llm";
import {
  evaluateBehavioralAnswer,
  type BehavioralFeedback,
} from "@/lib/interview";
import { AnswerInput } from "./AnswerInput";
import { BehavioralHints } from "./BehavioralHints";
import { SpeechControl } from "./SpeechControl";
import {
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Mic,
  Lightbulb,
  ClipboardPaste,
} from "lucide-react";

interface BehavioralWorkbenchProps {
  question: string;
  companyHint?: string;
  config: LlmConfig;
  /** Selects the role lens on the coaching playbook (EM, consulting, finance…). */
  roleLevel?: string | null;
  /** Follow-along highlight range while the question is read aloud. */
  highlight?: { start: number; end: number } | null;
  speaking?: boolean;
  paused?: boolean;
  onPauseSpeech?: () => void;
  onResumeSpeech?: () => void;
  onReplaySpeech?: () => void;
  /** Fully stop the interviewer TTS (accepted for parity; SpeechControl uses pause/resume). */
  onStopSpeech?: () => void;
  canReplay?: boolean;
  /** Prefill when revisiting a past answer (pair with a remount `key`). */
  initialText?: string;
  /** Live draft — auto-saves the typed answer (committed on Next; past edits
   * update in place). Parity with the coding / system-design workbenches. */
  onDraft?: (answer: string) => void;
}

/**
 * Behavioral practice workbench — same shape as coding / system-design: a
 * collapsible left panel (Question · Coach · Feedback) beside the answer area.
 * The draft stays editable while you Check / revise; nothing is wiped on re-check.
 */
export function BehavioralWorkbench({
  question,
  companyHint,
  config,
  roleLevel,
  highlight,
  speaking,
  paused,
  onPauseSpeech,
  onResumeSpeech,
  onReplaySpeech,
  onStopSpeech,
  canReplay,
  initialText = "",
  onDraft,
}: BehavioralWorkbenchProps) {
  const [tab, setTab] = useState<"question" | "coach" | "feedback">("question");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [draft, setDraft] = useState(initialText);
  const [feedback, setFeedback] = useState<BehavioralFeedback | null>(null);
  const [grading, setGrading] = useState(false);
  // Remount AnswerInput when the question (or restored prefill) changes.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    setDraft(initialText);
    setFeedback(null);
    setGrading(false);
    setTab("question");
    setEditorKey((k) => k + 1);
  }, [question, initialText]);

  // Push the current draft up so "Next" auto-saves it (parity with the coding
  // and system-design workbenches, which have no explicit save button either).
  useEffect(() => {
    onDraft?.(draft);
  }, [draft, onDraft]);

  const checkAnswer = async () => {
    const answer = draft.trim();
    if (!answer || grading) return;
    setGrading(true);
    try {
      const fb = await evaluateBehavioralAnswer({
        config,
        question,
        answer,
        roleLevel,
      });
      setFeedback(fb);
      setTab("feedback");
    } catch (e) {
      toast("Couldn’t grade the answer", {
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setGrading(false);
    }
  };

  const applyStrongerVersion = () => {
    const stronger = feedback?.modelAnswer?.trim();
    if (!stronger) return;
    setDraft(stronger);
    setEditorKey((k) => k + 1);
    toast("Stronger version loaded into your draft; edit as you like");
  };

  const speech = (
    <SpeechControl
      speaking={speaking}
      paused={paused}
      onPause={onPauseSpeech}
      onResume={onResumeSpeech}
      onReplay={onReplaySpeech}
      canReplay={canReplay}
      className="ml-auto"
    />
  );

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "rounded-t-md px-3 py-2 text-xs font-medium transition-colors",
        tab === id
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  const canSubmit = !!draft.trim();

  return (
    <div className="flex h-[min(78vh,840px)] min-h-[32.5rem] overflow-hidden rounded-xl border border-border/60 bg-background">
      {/* Question / Coach / Feedback panel */}
      {panelCollapsed ? null : (
        <aside className="flex w-full max-w-md shrink-0 flex-col border-r border-border/60 sm:w-[40%]">
          <div className="flex items-center gap-1 border-b border-border/60 px-3 pt-2">
            {tabBtn("question", "Question")}
            {tabBtn("coach", "Coach")}
            {feedback ? tabBtn("feedback", "Feedback") : null}
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              title="Collapse panel"
              className="ml-auto rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {tab === "question" ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">Behavioral</Badge>
                  {companyHint ? (
                    <Badge variant="outline">{companyHint}</Badge>
                  ) : null}
                  {speech}
                </div>
                <p className="whitespace-pre-wrap text-base leading-relaxed">
                  {highlight ? (
                    <>
                      <span className="text-muted-foreground/70">
                        {question.slice(0, highlight.start)}
                      </span>
                      <mark className="rounded bg-primary/20 px-0.5 font-medium text-foreground">
                        {question.slice(highlight.start, highlight.end)}
                      </mark>
                      <span className="text-muted-foreground/50">
                        {question.slice(highlight.end)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{question}</span>
                  )}
                </p>
              </>
            ) : tab === "coach" ? (
              <BehavioralHints
                question={question}
                config={config}
                roleLevel={roleLevel}
                disabled={speaking}
              />
            ) : feedback ? (
              <div className="space-y-3 text-sm">
                <Badge
                  variant={feedback.score >= 4 ? "secondary" : "destructive"}
                  className="tabular-nums"
                >
                  {feedback.score >= 4
                    ? "Strong"
                    : feedback.score >= 3
                      ? "Solid"
                      : "Needs work"}{" "}
                  · {feedback.score}/5
                </Badge>
                {feedback.summary ? (
                  <p className="leading-relaxed text-muted-foreground">
                    {feedback.summary}
                  </p>
                ) : null}

                {feedback.strengths.length ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Strengths
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {feedback.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {feedback.improvements.length ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Improve
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {feedback.improvements.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {feedback.modelAnswer ? (
                  <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Stronger version of your answer
                      </div>
                      <CopyButton
                        content={feedback.modelAnswer}
                        copyMessage="Answer copied"
                      />
                    </div>
                    <Markdown>{feedback.modelAnswer}</Markdown>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={applyStrongerVersion}
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Load into my draft
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      )}

      {/* Answer area — always editable; draft is never wiped on Check / re-check */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {panelCollapsed ? (
              <button
                type="button"
                onClick={() => setPanelCollapsed(false)}
                title="Show the question & coach panel"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : null}
            <Mic className="h-4 w-4" />
            <span>Your answer</span>
            {draft.trim() ? (
              <Badge variant="outline" className="text-3xs">
                Draft saved in view
              </Badge>
            ) : null}
          </div>
          {speaking ? (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Speaking
            </Badge>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <AnswerInput
            key={editorKey}
            onStartRecording={onStopSpeech ?? onPauseSpeech}
            initialText={draft}
            clearOnSubmit={false}
            hideSubmitButton
            onTextChange={setDraft}
            onSubmit={setDraft}
          />

          <div className="space-y-2 border-t border-border/40 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void checkAnswer()}
                disabled={!canSubmit || grading}
                aria-busy={grading}
                className={cn(
                  "min-w-[8.75rem]",
                  grading && "disabled:opacity-100"
                )}
              >
                {grading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>Checking…</span>
                  </>
                ) : (
                  <>
                    <Lightbulb className="h-4 w-4 shrink-0" />
                    <span>{feedback ? "Re-check" : "Check answer"}</span>
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your answer auto-saves; hit Next above when you’re ready to move
              on.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
