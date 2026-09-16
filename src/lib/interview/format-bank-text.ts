/**
 * Display-time cleanup for bank question text (escaped markdown + scraped scaffolds).
 * DB should already be formatted; this is a safety net for leftover / newly ingested rows.
 */

/** Unescape over-escaped markdown (\###, \-, \`\`\`, \*, \.). */
export function unescapeMarkdown(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/\\`\\`\\`/g, "```");
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1");
  return s;
}

function stripScaffold(text: string): string {
  let s = String(text ?? "");

  // Convert ```hint fences (closed or unclosed) into readable callouts.
  const hintToCallout = (title: string, body: string) => {
    const t = String(title || "").trim();
    const b = String(body || "")
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    if (!b) return "";
    return t ? `> **Hint: ${t}**\n${b}` : `> **Hint**\n${b}`;
  };
  s = s.replace(/```hint[ \t]*([^\n]*)\n([\s\S]*?)```/gi, (_, title, body) =>
    hintToCallout(title, body)
  );
  s = s.replace(
    /\\`\\`\\`hint[ \t]*([^\n]*)\n([\s\S]*?)\\`\\`\\`/gi,
    (_, title, body) => hintToCallout(title, body)
  );
  s = s.replace(
    /```hint[ \t]*([^\n]*)\n([\s\S]*?)(?=(?:\n```hint\b|\n#{1,3}\s|\n---\s*$|$))/gi,
    (_, title, body) => hintToCallout(title, body) + "\n\n"
  );
  s = s.replace(
    /\\`\\`\\`hint[ \t]*([^\n]*)\n([\s\S]*?)(?=(?:\n\\`\\`\\`hint\b|\n\\?#{1,3}\s|\n---\s*$|$))/gi,
    (_, title, body) => hintToCallout(title, body) + "\n\n"
  );

  // Drop truncated trailing hint openers
  s = s.replace(/\n?```hint[^\n]*$/gi, "");
  s = s.replace(/\n?\\`\\`\\`hint[^\n]*$/gi, "");

  s = s.replace(
    /```(?:premium-lock|premium|locked|unlock)[^\n]*\n[\s\S]*?```/gi,
    ""
  );
  s = s.replace(
    /\\`\\`\\`(?:premium-lock|premium|locked|unlock)[\s\S]*?\\`\\`\\`/gi,
    ""
  );

  const cutPatterns = [
    /(?:^|\n)\s*\\?#{1,3}\s*Constraints\s*&\s*Assumptions\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*Clarifying Questions(?:\s+to Ask)?\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*What a Strong Answer(?:\s+Covers)?\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*Follow[- ]up Questions?\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*Hints?\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*Solution Preview\b/i,
    /(?:^|\n)\s*\\?#{1,3}\s*Premium\b/i,
  ];
  let cutAt = -1;
  for (const re of cutPatterns) {
    const m = s.match(re);
    if (m && m.index != null) {
      cutAt = cutAt === -1 ? m.index : Math.min(cutAt, m.index);
    }
  }
  if (cutAt > 40) s = s.slice(0, cutAt);

  s = s.replace(/`{0,3}premium-lock`{0,3}/gi, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Clean bank question text for rendering. */
export function formatBankQuestion(raw: string): string {
  let s = stripScaffold(String(raw ?? ""));
  s = unescapeMarkdown(s);
  s = stripScaffold(s);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Tighten markdown so lists render with proper indentation:
 * blank line before bullets after headings/labels, indent STAR Action bullets.
 */
export function normalizeAnswerMarkdown(markdown: string): string {
  let s = String(markdown ?? "").replace(/\r\n/g, "\n");

  s = s.replace(
    /(^|\n)(\d+\.\s+\*\*[^*\n]+\*\*[^\n]*)\n(?=[-*]\s+)/g,
    "$1$2\n\n"
  );
  s = s.replace(/(^|\n)(#{1,6}\s+[^\n]+)\n(?=[-*]\s+)/g, "$1$2\n\n");
  s = s.replace(/(^|\n)(\*\*[^*\n]+\*\*)\s*\n(?=[-*]\s+)/g, "$1$2\n\n");

  s = s.replace(
    /(^|\n)(\d+\.\s+\*\*Action\*\*[^\n]*)\n\n((?:[-*]\s+[^\n]+\n?)+)/gi,
    (_full, lead, head, block: string) => {
      const indented = block
        .trimEnd()
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!t) return "";
          if (/^[-*]\s+/.test(t) && !/^\s/.test(line)) return `   ${t}`;
          return line;
        })
        .join("\n");
      return `${lead}${head}\n\n${indented}\n`;
    }
  );

  return s.replace(/\n{3,}/g, "\n\n").trim();
}
