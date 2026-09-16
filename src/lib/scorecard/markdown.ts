import type {
  Evidence,
  InterviewScorecard,
  KeyPoint,
  MeetingScorecard,
  Scorecard,
} from "./types";

/**
 * Renders a scorecard as markdown for Copy / Download. Deliberately shaped like
 * formatAssessmentAsMarkdown() in lib/interview/session.ts so a copied
 * scorecard and a copied practice assessment read the same.
 */

// Word labels rather than coloured circles: the export is plain markdown, so a
// label survives copy/paste into any editor and reads the same in a diff.
const SEVERITY_MARK: Record<Evidence["severity"], string> = {
  red: "[risk]",
  yellow: "[watch]",
  green: "[strong]",
};

function evidenceLines(evidence: Evidence[], indent = "  "): string[] {
  return evidence.map((e) => {
    const who = e.speaker ? `${e.speaker}: ` : "";
    const note = e.note ? ` · ${e.note}` : "";
    return `${indent}- ${SEVERITY_MARK[e.severity]} ${who}"${e.quote}"${note}`;
  });
}

function keyPointLines(points: KeyPoint[]): string[] {
  const lines: string[] = [];
  for (const point of points) {
    lines.push(`- ${point.text}`);
    lines.push(...evidenceLines(point.evidence));
  }
  return lines;
}

function bulletSection(title: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return ["", `### ${title}`, ...items.map((s) => `- ${s}`)];
}

function interviewMarkdown(card: InterviewScorecard): string {
  const lines: string[] = [
    `## ${card.headline}`,
    "",
    `**Overall score:** ${card.overallScore}/5`,
  ];
  if (card.verdict) lines.push("", `**Bottom line:** ${card.verdict}`);
  if (card.summary) lines.push("", card.summary);

  if (card.dimensions.length) {
    lines.push("", "### Scores");
    for (const d of card.dimensions) {
      lines.push(
        `- **${d.label}** · ${d.score}/5${d.comment ? `: ${d.comment}` : ""}`
      );
    }
  }

  if (card.keyPoints.length) {
    lines.push("", "### Key points", ...keyPointLines(card.keyPoints));
  }

  lines.push(...bulletSection("Strengths", card.strengths));
  lines.push(...bulletSection("Areas to improve", card.improvements));
  lines.push(...bulletSection("Recommendations", card.recommendations));

  if (card.moments.length) {
    lines.push("", "### Flagged moments", ...evidenceLines(card.moments, ""));
  }

  if (card.questions.length) {
    lines.push("", "### Question by question");
    card.questions.forEach((q, i) => {
      lines.push("", `#### Q${i + 1} · ${q.score}/5`);
      lines.push(`**Question:** ${q.question}`);
      if (q.answerSummary) lines.push(`**Your answer:** ${q.answerSummary}`);
      lines.push(
        `**Answered what was asked:** ${q.answeredWhatWasAsked} · **Made sense:** ${q.madeSense}`
      );
      if (q.strengths.length) {
        lines.push(`**What worked:** ${q.strengths.join("; ")}`);
      }
      if (q.improvements.length) {
        lines.push(`**Improve:** ${q.improvements.join("; ")}`);
      }
      if (q.evidence.length) {
        lines.push("", "**From the transcript:**");
        lines.push(...evidenceLines(q.evidence, ""));
      }
      if (q.strongerAnswer) {
        lines.push("", "**A stronger answer:**", "", q.strongerAnswer);
      }
    });
  }

  return lines.join("\n");
}

function meetingMarkdown(card: MeetingScorecard): string {
  const lines: string[] = [`## ${card.headline}`];
  if (card.summary) lines.push("", card.summary);
  if (card.topics.length) {
    lines.push("", `**Topics:** ${card.topics.join(" · ")}`);
  }

  if (card.keyPoints.length) {
    lines.push("", "### Key points", ...keyPointLines(card.keyPoints));
  }
  if (card.decisions.length) {
    lines.push("", "### Decisions", ...keyPointLines(card.decisions));
  }
  if (card.actionItems.length) {
    lines.push("", "### Action items");
    for (const item of card.actionItems) {
      lines.push(`- ${item.text}${item.owner ? ` · **${item.owner}**` : ""}`);
      lines.push(...evidenceLines(item.evidence));
    }
  }
  if (card.openQuestions.length) {
    lines.push("", "### Open questions", ...keyPointLines(card.openQuestions));
  }
  if (card.moments.length) {
    lines.push("", "### Needs attention", ...evidenceLines(card.moments, ""));
  }

  return lines.join("\n");
}

export function scorecardToMarkdown(card: Scorecard): string {
  return card.kind === "interview"
    ? interviewMarkdown(card)
    : meetingMarkdown(card);
}
