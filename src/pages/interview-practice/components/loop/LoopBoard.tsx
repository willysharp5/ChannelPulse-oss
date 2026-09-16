import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, ConfirmDialog } from "@/components";
import { useApp } from "@/contexts";
import {
  cancelLoopStage,
  formatLoopDuration,
  generateLoopVerdict,
  getLoopBlueprint,
  isLoopFinished,
  isOffer,
  loopAverageScore,
  loopProgress,
  loopTotalMinutes,
  LOOP_DECISION_LABELS,
  LOOP_STAGE_KIND_LABELS,
  resetLoopStage,
  saveLoopVerdict,
  type InterviewLoopRun,
  type LoopStage,
  type LoopStageRun,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import moment from "moment";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";

interface LoopBoardProps {
  run: InterviewLoopRun;
  /** A stage was started/cancelled/reset — the parent re-reads storage. */
  onChanged: (run: InterviewLoopRun) => void;
  /** Enter a pending stage (parent curates the questions, then runs it). */
  onStartStage: (stage: LoopStage) => void;
  /** Re-enter a stage already in progress — same questions, same clock. */
  onResumeStage: (stage: LoopStage, stageRun: LoopStageRun) => void;
  onBack: () => void;
  onViewResult: (resultId: string) => void;
  onDeleteRun: () => void;
  /** Stage id currently being curated (spinner on its button). */
  startingStageId?: string | null;
}

/**
 * The loop's board: every round, its status, its grade, and the one action
 * available on it. This is where a candidate lives between rounds — the run
 * persists, so closing the app and coming back tomorrow lands right here.
 */
export function LoopBoard({
  run,
  onChanged,
  onStartStage,
  onResumeStage,
  onBack,
  onViewResult,
  onDeleteRun,
  startingStageId,
}: LoopBoardProps) {
  const { selectedAIProvider, allAiProviders } = useApp();
  const blueprint = getLoopBlueprint(run.blueprintId);
  const [now, setNow] = useState(() => Date.now());
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<LoopStage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const verdictAttemptedRef = useRef<string | null>(null);

  // Only ticks while a round is actually running.
  const hasLive = run.stages.some((s) => s.status === "in_progress");
  useEffect(() => {
    if (!hasLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasLive]);

  const llmConfig = useMemo(
    () => ({
      provider: allAiProviders.find((p) => p.id === selectedAIProvider.provider),
      selectedProvider: selectedAIProvider,
    }),
    [allAiProviders, selectedAIProvider]
  );

  const finished = isLoopFinished(run);
  const progress = loopProgress(run);
  const avg = loopAverageScore(run);

  const runVerdict = useCallback(async () => {
    setVerdictLoading(true);
    setVerdictError(null);
    try {
      const verdict = await generateLoopVerdict({ config: llmConfig, run });
      const saved = saveLoopVerdict(run.id, verdict);
      if (saved) onChanged(saved);
    } catch (err) {
      setVerdictError(
        err instanceof Error ? err.message : "Couldn't reach the committee."
      );
    } finally {
      setVerdictLoading(false);
    }
  }, [llmConfig, run, onChanged]);

  // The whole point of a loop: as soon as every round has an outcome, the
  // committee meets. No button to press.
  useEffect(() => {
    if (!finished || run.verdict || verdictLoading) return;
    if (verdictAttemptedRef.current === run.id) return;
    verdictAttemptedRef.current = run.id;
    void runVerdict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, run.id, run.verdict]);

  const stages: { stage: LoopStage; state: LoopStageRun }[] = run.stages
    .map((state) => {
      const stage = blueprint?.stages.find((s) => s.id === state.stageId);
      return stage ? { stage, state } : null;
    })
    .filter((x): x is { stage: LoopStage; state: LoopStageRun } => x !== null);

  const totalMinutes = loopTotalMinutes(stages.map((s) => s.stage));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button size="sm" variant="ghost" className="-ml-2" onClick={onBack}>
            <ArrowLeft className="size-4" />
            All loops
          </Button>
          <h2 className="text-base font-semibold">
            {run.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {run.level}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="tabular-nums">
              {progress.done} of {progress.total} rounds done
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              <Clock className="size-3" />
              {formatLoopDuration(totalMinutes)} total
            </Badge>
            {avg !== null ? (
              <Badge variant="outline" className="tabular-nums">
                Avg {avg.toFixed(1)}/5
              </Badge>
            ) : null}
            <span className="text-2xs text-muted-foreground">
              Started {moment(run.createdAt).fromNow()}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" />
          Delete loop
        </Button>
      </div>

      <ol className="space-y-2">
        {stages.map(({ stage, state }, i) => {
          const msLeft = state.endsAt ? state.endsAt - now : 0;
          const live = state.status === "in_progress";
          return (
            <li key={stage.id}>
              <Card
                className={cn(
                  "gap-2 p-3.5",
                  live && "border-primary/50 bg-primary/5",
                  state.status === "cancelled" && "opacity-80"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        Round {i + 1}
                      </span>
                      <span className="text-sm font-medium">{stage.title}</span>
                      <Badge variant="outline">
                        {LOOP_STAGE_KIND_LABELS[stage.kind]}
                      </Badge>
                      <Badge variant="secondary" className="tabular-nums">
                        {stage.minutes} min
                      </Badge>
                      <StatusBadge state={state} msLeft={msLeft} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {state.summary || stage.signal}
                    </p>
                    {state.status === "cancelled" ? (
                      <p className="text-2xs text-destructive">
                        {state.cancelReason === "time"
                          ? "The clock ran out on this round; it counts as no signal."
                          : "You cancelled this round; it counts as no signal."}{" "}
                        Retake it to clear that.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {typeof state.score === "number" ? (
                      <Badge
                        variant={state.score >= 4 ? "default" : "secondary"}
                        className="tabular-nums"
                      >
                        {state.score}/5
                      </Badge>
                    ) : null}
                    {state.resultId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewResult(state.resultId as string)}
                      >
                        <Eye className="size-4" />
                        Report
                      </Button>
                    ) : null}
                    {live ? (
                      <>
                        <Button size="sm" onClick={() => onResumeStage(stage, state)}>
                          <Play className="size-4" />
                          Back in the room
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingCancel(stage)}
                        >
                          <Ban className="size-4" />
                          Cancel round
                        </Button>
                      </>
                    ) : state.status === "pending" ? (
                      <Button
                        size="sm"
                        disabled={!!startingStageId}
                        onClick={() => onStartStage(stage)}
                      >
                        {startingStageId === stage.id ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            Curating…
                          </>
                        ) : (
                          <>
                            <Play className="size-4" />
                            Start round
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const next = resetLoopStage(run.id, stage.id);
                          if (next) onChanged(next);
                        }}
                      >
                        <RotateCcw className="size-4" />
                        Retake
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      {finished ? (
        <VerdictSection
          run={run}
          loading={verdictLoading}
          error={verdictError}
          onRetry={() => void runVerdict()}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Finish every round and the hiring committee makes its call (hire or no
          hire) across the whole loop. Stop for as long as you like between
          rounds; the loop is waiting when you come back.
        </p>
      )}

      <ConfirmDialog
        open={!!pendingCancel}
        onOpenChange={(open) => !open && setPendingCancel(null)}
        title={`Cancel "${pendingCancel?.title ?? "this round"}"?`}
        description="You can't pause a round; cancelling ends it now and it counts as no signal in the final decision. You can retake it afterwards, but the committee sees that you didn't finish it the first time."
        confirmLabel="Cancel the round"
        onConfirm={() => {
          if (!pendingCancel) return;
          const next = cancelLoopStage(run.id, pendingCancel.id, "user");
          setPendingCancel(null);
          if (next) onChanged(next);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this loop?"
        description="The loop and its progress are removed. Individual round reports stay in Results."
        confirmLabel="Delete loop"
        onConfirm={() => {
          setConfirmDelete(false);
          onDeleteRun();
        }}
      />
    </div>
  );
}

function StatusBadge({
  state,
  msLeft,
}: {
  state: LoopStageRun;
  msLeft: number;
}) {
  if (state.status === "in_progress") {
    const secs = Math.max(0, Math.ceil(msLeft / 1000));
    const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return (
      <Badge
        variant={msLeft <= 5 * 60_000 ? "destructive" : "default"}
        className="tabular-nums"
      >
        <Clock className="size-3" />
        {label} left
      </Badge>
    );
  }
  if (state.status === "completed") {
    return (
      <Badge variant="secondary">
        <CheckCircle2 className="size-3" />
        Done
      </Badge>
    );
  }
  if (state.status === "cancelled") {
    return (
      <Badge variant="outline" className="text-destructive">
        <XCircle className="size-3" />
        {state.cancelReason === "time" ? "Out of time" : "Cancelled"}
      </Badge>
    );
  }
  return <Badge variant="outline">Not started</Badge>;
}

function VerdictSection({
  run,
  loading,
  error,
  onRetry,
}: {
  run: InterviewLoopRun;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const verdict = run.verdict;

  if (loading && !verdict) {
    return (
      <Card className="items-center gap-2 p-6 text-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium">The committee is debriefing…</p>
        <p className="text-xs text-muted-foreground">
          Reading every round's write-up before making the call.
        </p>
      </Card>
    );
  }

  if (!verdict) {
    return (
      <Card className="gap-2 p-4">
        <p className="text-sm font-medium">Loop complete</p>
        <p className="text-xs text-muted-foreground">
          {error ?? "The committee hasn't made its call yet."}
        </p>
        <Button size="sm" className="w-fit" onClick={onRetry}>
          Get the decision
        </Button>
      </Card>
    );
  }

  const offer = isOffer(verdict.decision);
  return (
    <Card
      className={cn(
        "gap-3 p-5",
        offer
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-destructive/40 bg-destructive/5"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={offer ? "default" : "destructive"}>
          {LOOP_DECISION_LABELS[verdict.decision]}
        </Badge>
        {verdict.level ? (
          <Badge variant="outline">{verdict.level}</Badge>
        ) : null}
        {verdict.offline ? (
          <Badge variant="outline" title="Generated from your round scores without the model">
            Offline debrief
          </Badge>
        ) : null}
        <span className="text-2xs text-muted-foreground">
          {moment(verdict.createdAt).format("MMM D, h:mm a")}
        </span>
      </div>

      <h3 className="text-base font-semibold">{verdict.headline}</h3>
      <p className="text-sm text-muted-foreground">{verdict.summary}</p>

      <div className="space-y-1.5">
        {verdict.stages.map((s) => (
          <div
            key={s.stageId}
            className="flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5"
          >
            <Badge
              variant={s.score === null ? "outline" : "secondary"}
              className="shrink-0 tabular-nums"
            >
              {s.score === null ? "–" : `${s.score}/5`}
            </Badge>
            <div className="min-w-0">
              <p className="text-xs font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <VerdictList title="Strengths" items={verdict.strengths} />
        <VerdictList title="What cost you" items={verdict.gaps} />
        <VerdictList title="Before you interview again" items={verdict.nextSteps} />
      </div>
    </Card>
  );
}

function VerdictList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-4 text-xs">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
