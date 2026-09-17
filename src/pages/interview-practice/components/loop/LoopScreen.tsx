import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, toast } from "@/components";
import {
  cancelLoopStage,
  completeLoopStage,
  curateLoopStage,
  deleteLoopRun,
  formatLoopDuration,
  getLoopBlueprint,
  getLoopRun,
  isLoopFinished,
  isOffer,
  listLoopRuns,
  loopProgress,
  loopStageRun,
  loopTotalMinutes,
  LOOP_DECISION_LABELS,
  resetLoopStage,
  startLoopStage,
  type InterviewLoopRun,
  type InterviewTemplate,
  type LoopStage,
  type LoopStageRun,
} from "@/lib/interview";
import { cancelSpeech } from "@/lib/tts";
import { MAX_LOOP_RUNS } from "@/config";
import { useProUpsell } from "@/components/pro-upsell";
import { CircleHelpIcon, Clock, Layers, Play, Plus, Trash2 } from "lucide-react";
import moment from "moment";
import { PracticeSession } from "../PracticeSession";
import { LoopBoard } from "./LoopBoard";
import { LoopIntro, openLoopIntro } from "./LoopIntro";
import { LoopPicker } from "./LoopPicker";

interface LoopScreenProps {
  /** True while a round is in the room — the page hides its tab bar. */
  onSessionChange?: (active: boolean) => void;
  /** Open a saved round report in the page's report viewer. */
  onViewResult: (resultId: string) => void;
  /**
   * Called before a round starts. Return false to abort — the page uses this
   * for the soft paywall: browsing the board is free, walking into a round
   * prompts a lapsed account to subscribe. Defaults to always-allowed.
   */
  onGuard?: () => boolean;
}

interface ActiveStage {
  runId: string;
  stage: LoopStage;
  template: InterviewTemplate;
  deadlineAt: number;
}

/**
 * The "Full loop" tab: your loops in progress, the picker for a new one, the
 * board for a chosen loop, and the round itself when you're in the room.
 */
export function LoopScreen({
  onSessionChange,
  onViewResult,
  onGuard,
}: LoopScreenProps) {
  const [runs, setRuns] = useState<InterviewLoopRun[]>([]);
  const [picking, setPicking] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveStage | null>(null);
  const [startingStageId, setStartingStageId] = useState<string | null>(null);
  // Remounts PracticeSession when a round is retaken from its own report.
  const [sessionKey, setSessionKey] = useState(0);

  const { promptUpgrade } = useProUpsell();

  const refresh = useCallback(() => setRuns(listLoopRuns()), []);
  useEffect(() => refresh(), [refresh]);

  /**
   * Starting a loop, one at a time. This edition keeps MAX_LOOP_RUNS on the go;
   * finish or delete the one you have and the next is free. Asking for another
   * while one is open is where the hosted app gets to make its case.
   */
  const startNewLoop = () => {
    if (runs.length >= MAX_LOOP_RUNS) {
      promptUpgrade(
        MAX_LOOP_RUNS === 1
          ? "More than one interview loop at a time"
          : `More than ${MAX_LOOP_RUNS} interview loops at a time`
      );
      return;
    }
    setPicking(true);
  };

  useEffect(() => {
    onSessionChange?.(!!active);
  }, [active, onSessionChange]);

  const selectedRun = useMemo(
    () => (selectedRunId ? runs.find((r) => r.id === selectedRunId) ?? null : null),
    [runs, selectedRunId]
  );

  const leaveRoom = useCallback(() => {
    cancelSpeech();
    setActive(null);
    refresh();
  }, [refresh]);

  /** Curate the round's questions, start its clock, then walk in. */
  const startStage = async (stage: LoopStage) => {
    if (onGuard && !onGuard()) return;
    if (!selectedRunId) return;
    const run = getLoopRun(selectedRunId);
    const blueprint = run ? getLoopBlueprint(run.blueprintId) : null;
    if (!run || !blueprint) return;
    setStartingStageId(stage.id);
    try {
      // Curate BEFORE starting the clock — the candidate shouldn't lose minutes
      // to us querying the question bank.
      const curated = await curateLoopStage({ blueprint, stage, run });
      const next = startLoopStage(run.id, stage, curated.template);
      const state = next ? loopStageRun(next, stage.id) : null;
      if (!next || !state?.endsAt) {
        toast("Couldn't start that round.", { variant: "error" });
        return;
      }
      if (curated.wrapped) {
        // You've been through every question this round has. Say so, rather than
        // letting a familiar question look like a bug.
        toast("You've had every question in this round, starting the set again.");
      }
      setRuns(listLoopRuns());
      setActive({
        runId: run.id,
        stage,
        template: curated.template,
        deadlineAt: state.endsAt,
      });
    } catch (err) {
      console.error(err);
      toast("Couldn't prepare that round's questions.", { variant: "error" });
    } finally {
      setStartingStageId(null);
    }
  };

  /** Walk back into a round already running — same questions, same clock. */
  const resumeStage = (stage: LoopStage, state: LoopStageRun) => {
    if (onGuard && !onGuard()) return;
    if (!selectedRunId || !state.endsAt) return;
    if (!state.template) {
      toast("This round's questions are missing. Cancel and retake it.", {
        variant: "error",
      });
      return;
    }
    setActive({
      runId: selectedRunId,
      stage,
      template: state.template,
      deadlineAt: state.endsAt,
    });
  };

  // ── In the room ───────────────────────────────────────────────────────────
  if (active) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{active.stage.title}</Badge>
            <span className="text-xs text-muted-foreground">
              This round can't be paused. Leaving keeps the clock running;
              cancel it from the board if you need to stop.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={leaveRoom}>
            Back to the loop
          </Button>
        </div>
        <PracticeSession
          key={`${active.runId}-${active.stage.id}-${sessionKey}`}
          template={active.template}
          deadlineAt={active.deadlineAt}
          onExit={leaveRoom}
          onRestart={() => {
            // "Practice again" on a loop round means retaking it: the stage goes
            // back to pending and gets freshly curated questions.
            resetLoopStage(active.runId, active.stage.id);
            setSessionKey((k) => k + 1);
            leaveRoom();
          }}
          onCompleted={({ assessment, turns, resultId, timedOut }) => {
            if (!assessment) {
              // Timed out with nothing to grade — the round is lost.
              cancelLoopStage(active.runId, active.stage.id, "time");
            } else {
              completeLoopStage(active.runId, active.stage.id, {
                score: assessment.overallScore,
                summary: assessment.overallSummary,
                resultId,
                answered: turns.length,
                ranOutOfTime: timedOut,
                askedQuestions: turns.map((t) => t.question),
              });
            }
            refresh();
          }}
        />
      </div>
    );
  }

  // ── A chosen loop's board ─────────────────────────────────────────────────
  if (selectedRun) {
    return (
      <LoopBoard
        run={selectedRun}
        startingStageId={startingStageId}
        onChanged={(next) => {
          setRuns(listLoopRuns());
          setSelectedRunId(next.id);
        }}
        onStartStage={(stage) => void startStage(stage)}
        onResumeStage={resumeStage}
        onBack={() => setSelectedRunId(null)}
        onViewResult={onViewResult}
        onDeleteRun={() => {
          deleteLoopRun(selectedRun.id);
          setSelectedRunId(null);
          refresh();
        }}
      />
    );
  }

  // ── Picking a new loop ────────────────────────────────────────────────────
  if (picking) {
    return (
      <LoopPicker
        onCancel={() => setPicking(false)}
        onStarted={(run) => {
          setPicking(false);
          setRuns(listLoopRuns());
          setSelectedRunId(run.id);
        }}
      />
    );
  }

  // ── Your loops ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Full interview loop</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The whole process, not one question set: a phone screen, the
            technical rounds, system design, behavioral, values, and the hiring
            manager, each on its own clock, each graded, and a hire / no-hire
            call at the end.
          </p>
          {runs.length >= MAX_LOOP_RUNS && (
            <p className="text-xs text-muted-foreground">
              {MAX_LOOP_RUNS === 1 ? "One loop" : `${MAX_LOOP_RUNS} loops`} at a
              time in this edition — finish this one, or delete it to sit a
              different role.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={openLoopIntro}
            title="Show how a full loop works"
          >
            <CircleHelpIcon className="size-4" />
            How it works
          </Button>
          <Button size="sm" onClick={startNewLoop}>
            <Plus className="size-4" />
            New loop
          </Button>
        </div>
      </div>

      {/* A loop shows nothing until you've committed to one, so the walkthrough
          carries the empty page. Dismissible, and reopened by "How it works". */}
      <LoopIntro />

      {runs.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <Empty
            icon={Layers}
            title="No loops yet"
            description="Pick the role you're interviewing for and sit the whole process end to end."
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={startNewLoop}>
              <Play className="size-4" />
              Start a loop
            </Button>
            <Button size="sm" variant="outline" onClick={openLoopIntro}>
              <CircleHelpIcon className="size-4" />
              See how it works
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {runs.map((run) => {
            const blueprint = getLoopBlueprint(run.blueprintId);
            const progress = loopProgress(run);
            const done = isLoopFinished(run);
            const minutes = blueprint
              ? loopTotalMinutes(
                  blueprint.stages.filter((s) =>
                    run.stages.some((r) => r.stageId === s.id)
                  )
                )
              : 0;
            return (
              <Card key={run.id} className="gap-2 p-4 !bg-muted/40 border-border/60">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{run.title}</span>
                  <Badge variant="outline" className="shrink-0">
                    {run.level}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="tabular-nums">
                    {progress.done}/{progress.total} rounds
                  </Badge>
                  <Badge variant="secondary" className="tabular-nums">
                    <Clock className="size-3" />
                    {formatLoopDuration(minutes)}
                  </Badge>
                  {run.verdict ? (
                    <Badge
                      variant={isOffer(run.verdict.decision) ? "default" : "destructive"}
                    >
                      {LOOP_DECISION_LABELS[run.verdict.decision]}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-2xs text-muted-foreground">
                  {done ? "Finished" : "Updated"} {moment(run.updatedAt).fromNow()}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={done ? "outline" : "default"}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    {done ? "See the decision" : "Continue"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    title="Delete this loop"
                    onClick={() => {
                      deleteLoopRun(run.id);
                      refresh();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
