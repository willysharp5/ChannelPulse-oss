import { FileText, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import type { ScorecardLine } from "@/lib/scorecard/transcript";
import type { Scorecard as ScorecardData } from "@/lib/scorecard/types";
import { InterviewScorecardView } from "./InterviewScorecardView";
import { MeetingScorecardView } from "./MeetingScorecardView";

/**
 * Renders whichever scorecard came back, and owns the states around it —
 * generating, failed, and not-enough-said — so the page doesn't have to.
 */

interface ScorecardProps {
  scorecard: ScorecardData;
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
}

export function Scorecard({
  scorecard,
  lines,
  onJumpToTranscript,
}: ScorecardProps) {
  return (
    <div className="space-y-3">
      {scorecard.kind === "interview" ? (
        <InterviewScorecardView
          scorecard={scorecard}
          lines={lines}
          onJumpToTranscript={onJumpToTranscript}
        />
      ) : (
        <MeetingScorecardView
          scorecard={scorecard}
          lines={lines}
          onJumpToTranscript={onJumpToTranscript}
        />
      )}
    </div>
  );
}

/** While the grading call is in flight. */
export function ScorecardLoading({ kind }: { kind?: "interview" | "meeting" }) {
  return (
    <div className="space-y-4">
      <Card className="py-5">
        <CardContent className="px-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <div>
              <p className="text-base font-medium">
                {kind === "interview"
                  ? "Going through the interview…"
                  : kind === "meeting"
                    ? "Pulling out the key points…"
                    : "Reading the conversation…"}
              </p>
              <p className="text-sm text-muted-foreground">
                {kind === "interview"
                  ? "Scoring each answer against the question it was given."
                  : "This takes a few seconds."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="py-4">
          <CardContent className="space-y-2 px-4">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Named ...ErrorState, not ScorecardError: lib/scorecard/generate.ts already
 * exports a ScorecardError class that gets thrown, and both barrels are
 * imported side by side.
 */
export function ScorecardErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="py-6">
      <CardContent className="flex flex-col items-center gap-3 px-6 text-center">
        <p className="text-base font-medium">Couldn’t build the scorecard</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Nothing has been generated yet — either too little was said to review, or the
 * user needs to ask for it.
 */
export function ScorecardEmpty({
  reason,
  onGenerate,
  onViewTranscript,
}: {
  reason: "too-short" | "not-generated" | "signed-out";
  onGenerate?: () => void;
  onViewTranscript?: () => void;
}) {
  const copy = {
    "too-short": {
      title: "Not enough was said to review",
      body: "A scorecard needs a real back-and-forth to grade. Record or type a longer conversation and it'll show up here.",
    },
    "not-generated": {
      title: "No scorecard yet",
      body: "Build a summary of this conversation, with the key points of what was said, and scores on each answer if it was an interview.",
    },
    "signed-out": {
      title: "Sign in to build a scorecard",
      body: "Reviews run through your ChannelPulse account. The transcript is still here in the meantime.",
    },
  }[reason];

  return (
    <Card className="py-8">
      <CardContent className="flex flex-col items-center gap-3 px-6 text-center">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
        <p className="text-base font-medium">{copy.title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{copy.body}</p>
        <div className="flex gap-2">
          {reason === "not-generated" && onGenerate ? (
            <Button size="sm" onClick={onGenerate}>
              <Sparkles className="h-3.5 w-3.5" />
              Build scorecard
            </Button>
          ) : null}
          {onViewTranscript ? (
            <Button size="sm" variant="outline" onClick={onViewTranscript}>
              <FileText className="h-3.5 w-3.5" />
              View transcript
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
