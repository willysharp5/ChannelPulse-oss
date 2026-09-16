import { useState } from "react";
import { Badge, Button, Card } from "@/components";
import {
  createLoopRun,
  formatLoopDuration,
  loopBlueprintsByFamily,
  loopTotalMinutes,
  LOOP_STAGE_KIND_LABELS,
  type InterviewLoopRun,
  type LoopBlueprint,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, Clock, Play } from "lucide-react";

interface LoopPickerProps {
  onStarted: (run: InterviewLoopRun) => void;
  onCancel: () => void;
}

/**
 * Two steps: pick the role you're interviewing for, then pick which rounds of
 * that loop you want to sit. The full flow is always shown first — seeing that a
 * senior loop is seven rounds and most of a working day is half the point.
 */
export function LoopPicker({ onStarted, onCancel }: LoopPickerProps) {
  const [blueprint, setBlueprint] = useState<LoopBlueprint | null>(null);

  if (blueprint) {
    return (
      <StageBuilder
        blueprint={blueprint}
        onBack={() => setBlueprint(null)}
        onStarted={onStarted}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">
            What are you interviewing for?
          </h2>
          <p className="text-sm text-muted-foreground">
            Pick a role and you'll see the full loop that companies actually run
            for it. Then choose the rounds you want to sit; the AI curates the
            questions for each one.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {loopBlueprintsByFamily().map((group) =>
        group.blueprints.length === 0 ? null : (
          <div key={group.family} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.blueprints.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBlueprint(b)}
                  className="text-left"
                >
                  <Card className="h-full gap-2 p-4 transition-colors !bg-muted/40 border-border/60 hover:border-primary/40 hover:bg-muted/60">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{b.title}</span>
                      <Badge variant="outline" className="shrink-0">
                        {b.level}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{b.summary}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="tabular-nums">
                        {b.stages.length} rounds
                      </Badge>
                      <Badge variant="secondary" className="tabular-nums">
                        <Clock className="size-3" />
                        {formatLoopDuration(loopTotalMinutes(b.stages))}
                      </Badge>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function StageBuilder({
  blueprint,
  onBack,
  onStarted,
}: {
  blueprint: LoopBlueprint;
  onBack: () => void;
  onStarted: (run: InterviewLoopRun) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(blueprint.stages.map((s) => s.id))
  );

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = blueprint.stages.filter((s) => picked.has(s.id));
  const minutes = loopTotalMinutes(chosen);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button size="sm" variant="ghost" className="-ml-2" onClick={onBack}>
            <ArrowLeft className="size-4" />
            All roles
          </Button>
          <h2 className="text-base font-semibold">
            {blueprint.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {blueprint.level}
            </span>
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {blueprint.summary}
          </p>
          <p className="max-w-2xl text-2xs text-muted-foreground">
            Modeled on: {blueprint.modeledOn}. Representative of how these loops
            are run, not any one company's process.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="tabular-nums">
              {chosen.length} of {blueprint.stages.length} rounds
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              <Clock className="size-3" />
              {formatLoopDuration(minutes)}
            </Badge>
          </div>
          <Button
            size="sm"
            disabled={chosen.length === 0}
            onClick={() =>
              onStarted(
                createLoopRun({
                  blueprint,
                  stageIds: chosen.map((s) => s.id),
                })
              )
            }
          >
            <Play className="size-4" />
            Start this loop
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Uncheck any round you don't want to sit. You take them one at a time and
        can stop between rounds for as long as you like, but once a round
        starts, its clock runs whether the app is open or not.
      </p>

      <ol className="space-y-2">
        {blueprint.stages.map((stage, i) => {
          const on = picked.has(stage.id);
          return (
            <li key={stage.id}>
              <button
                type="button"
                onClick={() => toggle(stage.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  on
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 bg-background hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40"
                  )}
                >
                  {on ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Round {i + 1}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium",
                        !on && "text-muted-foreground"
                      )}
                    >
                      {stage.title}
                    </span>
                    <Badge variant="outline">
                      {LOOP_STAGE_KIND_LABELS[stage.kind]}
                    </Badge>
                    <Badge variant="secondary" className="tabular-nums">
                      {stage.minutes} min
                    </Badge>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {stage.signal}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
