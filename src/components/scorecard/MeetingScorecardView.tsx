import {
  CheckSquare,
  HelpCircle,
  ListChecks,
  MessageSquareQuote,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { ScorecardLine } from "@/lib/scorecard/transcript";
import type { MeetingScorecard } from "@/lib/scorecard/types";
import { EvidenceList, EvidenceRow } from "./EvidenceText";

/**
 * The meeting scorecard: a summary, then the key points of what was actually
 * said — decisions, action items, open questions — each backed by hoverable
 * evidence so a claim can always be traced to the line it came from.
 */

interface Props {
  scorecard: MeetingScorecard;
  lines: ScorecardLine[];
  onJumpToTranscript?: (messageId: string) => void;
}

export function MeetingScorecardView({
  scorecard,
  lines,
  onJumpToTranscript,
}: Props) {
  return (
    <div className="space-y-4">
      <Card className="gap-3 py-5">
        <CardContent className="space-y-3 px-5">
          <h2 className="cp-display text-2xl leading-tight">
            {scorecard.headline}
          </h2>
          {scorecard.summary ? (
            <p className="text-base leading-relaxed">{scorecard.summary}</p>
          ) : null}
          {scorecard.topics.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {scorecard.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {topic}
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Section
        title="Key points"
        icon={<MessageSquareQuote className="h-3.5 w-3.5" />}
        hint="Hover an icon to see the transcript it came from."
      >
        <EvidenceList
          items={scorecard.keyPoints}
          lines={lines}
          onJumpToTranscript={onJumpToTranscript}
          empty="No specific points were pulled out of this conversation."
        />
      </Section>

      {scorecard.decisions.length > 0 ? (
        <Section
          title="Decisions"
          icon={<CheckSquare className="h-3.5 w-3.5" />}
        >
          <EvidenceList
            items={scorecard.decisions}
            lines={lines}
            onJumpToTranscript={onJumpToTranscript}
          />
        </Section>
      ) : null}

      {scorecard.actionItems.length > 0 ? (
        <Section
          title="Action items"
          icon={<ListChecks className="h-3.5 w-3.5" />}
        >
          <EvidenceList
            items={scorecard.actionItems.map((item) => ({
              text: item.text,
              evidence: item.evidence,
              trailing: item.owner ? (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-xs font-medium text-primary">
                  {item.owner}
                </span>
              ) : undefined,
            }))}
            lines={lines}
            onJumpToTranscript={onJumpToTranscript}
          />
        </Section>
      ) : null}

      {scorecard.openQuestions.length > 0 ? (
        <Section
          title="Open questions"
          icon={<HelpCircle className="h-3.5 w-3.5" />}
        >
          <EvidenceList
            items={scorecard.openQuestions}
            lines={lines}
            onJumpToTranscript={onJumpToTranscript}
          />
        </Section>
      ) : null}

      {scorecard.moments.length > 0 ? (
        <Section title="Needs attention">
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
    </div>
  );
}

function Section({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="flex items-center gap-1.5 text-base font-semibold">
          {icon}
          {title}
        </CardTitle>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}
