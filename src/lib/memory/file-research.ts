import { toast } from "@/components/ui/toaster";
import { firecrawlScrape, firecrawlSearch } from "./firecrawl";
import { ingestTextDocument } from "./files";
import { fetchAIResponse } from "@/lib/functions/ai-response.function";
import { shouldUseChannelPulseAPI } from "@/lib/functions/channelpulse.api";
import type { TYPE_PROVIDER } from "@/types";

export const FILE_RESEARCH_DONE_EVENT = "file-research-done";
export const FILE_RESEARCH_CHANGED_EVENT = "file-research-changed";

export type FileResearchSubject =
  | "myself"
  | "person"
  | "interview"
  | "other";

export interface FileResearchInput {
  subject: FileResearchSubject;
  /** Display name for the resulting file. */
  name: string;
  role?: string;
  company?: string;
  /** Interviewer / HM / recruiter / peer — for person briefings. */
  relationship?: string;
  /** e.g. phone screen, onsite, system design — for interview prep. */
  stage?: string;
  /** e.g. senior, staff — for interview / myself. */
  seniority?: string;
  /** Years / background highlight — for myself. */
  experience?: string;
  /** Strengths, domains, stack — for myself. */
  strengths?: string;
  /** What the assistant should help with. */
  goal?: string;
  notes?: string;
  /** Pasted LinkedIn / bio / JD / notes (LinkedIn URLs are not crawlable). */
  pastedText?: string;
  /** Up to 4 http(s) URLs to crawl (LinkedIn URLs are skipped). */
  urls?: string[];
}

let activeCount = 0;
const listeners = new Set<() => void>();

function emitChanged() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      // ignore
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(FILE_RESEARCH_CHANGED_EVENT));
  } catch {
    // non-DOM
  }
}

export function getActiveFileResearchCount(): number {
  return activeCount;
}

export function subscribeFileResearch(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isLinkedInUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return /linkedin\.com/i.test(url);
  }
}

function subjectLabel(subject: FileResearchSubject): string {
  switch (subject) {
    case "myself":
      return "About me";
    case "person":
      return "Person briefing";
    case "interview":
      return "Interview prep";
    default:
      return "Research notes";
  }
}

/** Build Firecrawl queries tailored to what an interview copilot needs. */
export function buildFileResearchQueries(input: FileResearchInput): string[] {
  const name = input.name.trim();
  const role = (input.role || "").trim();
  const company = (input.company || "").trim();
  const stage = (input.stage || "").trim();
  const seniority = (input.seniority || "").trim();
  const rolePhrase = [seniority, role].filter(Boolean).join(" ").trim();

  switch (input.subject) {
    case "myself": {
      const qs: string[] = [];
      if (company && rolePhrase) {
        qs.push(
          `${company} ${rolePhrase} interview process what to expect culture`
        );
        qs.push(
          `${company} ${rolePhrase} interview questions site:teamblind.com OR site:glassdoor.com OR site:levels.fyi`
        );
      } else if (company) {
        qs.push(`${company} company overview products culture interview process`);
      } else if (rolePhrase) {
        qs.push(`${rolePhrase} interview questions what to expect`);
      }
      if (name && name.toLowerCase() !== "myself" && name.toLowerCase() !== "my background") {
        // Optional public footprint — skip generic labels.
        qs.push(`"${name}" ${company || rolePhrase || ""}`.trim());
      }
      return qs.slice(0, 4);
    }
    case "person": {
      const qs: string[] = [];
      if (name) {
        qs.push(
          `"${name}" ${company} ${role}`.trim().replace(/\s+/g, " ")
        );
        qs.push(`"${name}" ${company} interview OR speaker OR bio OR profile`.trim());
      }
      if (company) {
        qs.push(`${company} company overview products leadership culture`);
        if (role) {
          qs.push(`${company} ${role} interview process hiring`);
        }
      }
      return qs.slice(0, 4);
    }
    case "interview": {
      const qs: string[] = [];
      if (company) {
        qs.push(
          `${company} company overview products culture funding interview process`
        );
        qs.push(
          `${company} ${rolePhrase || "interview"} interview process stages loop what to expect`
        );
        qs.push(
          `${company} ${rolePhrase || "software"} interview questions site:teamblind.com OR site:glassdoor.com OR site:levels.fyi`
        );
        qs.push(
          `${company} ${rolePhrase || ""} interview questions ${stage || "behavioral system design coding"}`.trim()
        );
      } else if (rolePhrase) {
        qs.push(`${rolePhrase} interview process what to expect`);
        qs.push(
          `${rolePhrase} interview questions site:teamblind.com OR site:glassdoor.com`
        );
      }
      return qs.slice(0, 4);
    }
    default: {
      const topic = [name, company, role].filter(Boolean).join(" ");
      if (!topic) return [];
      const goalBit = (input.goal || "").trim().slice(0, 80);
      return [
        `${topic} ${goalBit}`.trim(),
        `${topic} overview background`,
      ].slice(0, 3);
    }
  }
}

function formatSearchBlock(
  title: string,
  results: Awaited<ReturnType<typeof firecrawlSearch>>
): string {
  if (!results.length) return "";
  const lines = results.slice(0, 6).map((r) => {
    const body = (r.markdown || r.description || "").trim().slice(0, 3500);
    return `### ${r.title || r.url}\nSource: ${r.url}\n\n${body}`;
  });
  return `## ${title}\n\n${lines.join("\n\n")}`;
}

function buildRawBrief(
  input: FileResearchInput,
  crawled: { url: string; markdown: string }[],
  searchBlocks: string[]
): string {
  const parts: string[] = [];
  parts.push(`# ${subjectLabel(input.subject)}: ${input.name.trim() || "Untitled"}`);

  const meta: string[] = [];
  if (input.role?.trim()) meta.push(`- **Role:** ${input.role.trim()}`);
  if (input.seniority?.trim())
    meta.push(`- **Seniority:** ${input.seniority.trim()}`);
  if (input.company?.trim()) meta.push(`- **Company:** ${input.company.trim()}`);
  if (input.relationship?.trim())
    meta.push(`- **Relationship:** ${input.relationship.trim()}`);
  if (input.stage?.trim()) meta.push(`- **Stage / focus:** ${input.stage.trim()}`);
  if (input.experience?.trim())
    meta.push(`- **Experience:** ${input.experience.trim()}`);
  if (input.strengths?.trim())
    meta.push(`- **Strengths / domains:** ${input.strengths.trim()}`);
  if (meta.length) parts.push(meta.join("\n"));

  if (input.goal?.trim())
    parts.push(`## What to use this for\n\n${input.goal.trim()}`);
  if (input.notes?.trim()) parts.push(`## Notes\n\n${input.notes.trim()}`);
  if (input.pastedText?.trim()) {
    const pasteLabel =
      input.subject === "interview"
        ? "Job description / pasted materials"
        : input.subject === "myself"
          ? "Resume / LinkedIn / pasted profile"
          : "Pasted profile / notes";
    parts.push(`## ${pasteLabel}\n\n${input.pastedText.trim()}`);
  }
  for (const c of crawled) {
    if (!c.markdown.trim()) continue;
    parts.push(`## From ${c.url}\n\n${c.markdown.trim().slice(0, 12000)}`);
  }
  for (const block of searchBlocks) {
    if (block.trim()) parts.push(block);
  }
  return parts.join("\n\n").trim();
}

function polishSystemPrompt(subject: FileResearchSubject): string {
  const shared =
    "Write clean Markdown for a rich-text editor: # / ## headings, short paragraphs, - bullet lists. " +
    "Keep concrete facts, names, companies, dates, links, and quotes. Drop nav chrome and duplicates. " +
    "Do NOT invent facts. If research is thin, say what's unknown. " +
    "Reply with only the markdown briefing (no wrapping code fences).";

  switch (subject) {
    case "myself":
      return (
        "You build a personal interview-prep briefing the user's AI copilot will use during live interviews and practice. " +
        "Sections (use these headings):\n" +
        "## Snapshot\n## Experience & strengths\n## Stories & talking points\n## Target role / company signals\n## Gaps & how to handle them\n## Sources\n" +
        "Pull STAR-ready themes from resume/LinkedIn paste. Map strengths to the target role when known. " +
        shared
      );
    case "person":
      return (
        "You build a briefing about someone the user will meet (interviewer, hiring manager, recruiter, customer). " +
        "The AI copilot will use this mid-conversation. Sections:\n" +
        "## Who they are\n## Role & company context\n## Background & interests\n## Likely interview focus\n## Rapport & talking points\n## Questions to ask them\n## Sources\n" +
        "Emphasize what helps the user answer well and connect, not gossip. " +
        shared
      );
    case "interview":
      return (
        "You build an interview / company prep briefing for a live AI interview copilot and practice mode. Sections:\n" +
        "## Company snapshot\n## Role & what they look for\n## Interview process & stages\n## Common questions & themes\n## How to prepare\n## Sources\n" +
        "Ground questions and process notes in research (Blind/Glassdoor/web) and the job description when provided. " +
        shared
      );
    default:
      return (
        "You build a clear research briefing for an AI meeting/interview assistant. Sections:\n" +
        "## Overview\n## Key facts\n## Why it matters\n## Talking points\n## Sources\n" +
        shared
      );
  }
}

async function polishBrief(
  raw: string,
  input: FileResearchInput,
  config: {
    provider?: TYPE_PROVIDER;
    selectedProvider: { provider: string; variables: Record<string, string> };
  }
): Promise<string> {
  const systemPrompt = polishSystemPrompt(input.subject);
  const userMessage =
    `Subject type: ${input.subject}\n` +
    `Name/label: ${input.name}\n` +
    (input.role ? `Role: ${input.role}\n` : "") +
    (input.company ? `Company: ${input.company}\n` : "") +
    (input.relationship ? `Relationship: ${input.relationship}\n` : "") +
    (input.stage ? `Stage: ${input.stage}\n` : "") +
    (input.goal ? `User goal: ${input.goal}\n` : "") +
    `\nRaw research (answers + paste + crawled pages + web search):\n"""\n${raw.slice(0, 28000)}\n"""`;

  let out = "";
  try {
    for await (const chunk of fetchAIResponse({
      provider: config.provider,
      selectedProvider: config.selectedProvider,
      systemPrompt,
      userMessage,
      disableMemory: true,
      structured: true,
      maxTokens: 3200,
    })) {
      out += chunk;
    }
  } catch (err) {
    console.warn("File research polish failed:", err);
    return raw;
  }
  const cleaned = out.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "");
  return cleaned.length > 80 ? cleaned : raw;
}

/**
 * Fire-and-forget: crawl URLs + subject-specific web search, combine with
 * answers/paste, polish into an interview-useful briefing, index as Files.
 */
export function runFileResearchInBackground(params: {
  input: FileResearchInput;
  provider?: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
}): void {
  activeCount += 1;
  emitChanged();

  void (async () => {
    const labelBase = params.input.name.trim() || "Research";
    const label = `${subjectLabel(params.input.subject)} · ${labelBase}`;
    const source = `research:${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    try {
      const urls = (params.input.urls ?? [])
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .filter((u) => !isLinkedInUrl(u))
        .slice(0, 4);

      const crawled: { url: string; markdown: string }[] = [];
      for (const url of urls) {
        const md = await firecrawlScrape(url, { simple: true });
        crawled.push({ url, markdown: md });
      }

      const queries = buildFileResearchQueries(params.input);
      const excludeUrls = urls;
      const searchBlocks: string[] = [];
      const searchTitles =
        params.input.subject === "interview"
          ? [
              "Company & role web research",
              "Interview process research",
              "Interview question research",
              "Additional research",
            ]
          : params.input.subject === "person"
            ? [
                "Person web research",
                "Background & mentions",
                "Company context",
                "Hiring / interview context",
              ]
            : params.input.subject === "myself"
              ? [
                  "Target company / role research",
                  "Interview questions research",
                  "Additional research",
                  "Additional research",
                ]
              : [
                  "Web research",
                  "Background research",
                  "Additional research",
                  "Additional research",
                ];

      for (let i = 0; i < queries.length; i++) {
        const results = await firecrawlSearch(queries[i], 5, {
          scrape: true,
          excludeUrls,
        });
        const block = formatSearchBlock(
          searchTitles[i] || `Web research ${i + 1}`,
          results
        );
        if (block) searchBlocks.push(block);
      }

      const raw = buildRawBrief(params.input, crawled, searchBlocks);
      // Soft floor: allow paste-only or search-only if we got something useful.
      if (!raw || raw.length < 60) {
        throw new Error(
          "Not enough to research yet. Add a name + company/role, paste a profile or JD, or include crawlable links."
        );
      }

      const useManaged = await shouldUseChannelPulseAPI();
      const polished =
        useManaged || params.provider
          ? await polishBrief(raw, params.input, {
              provider: useManaged ? undefined : params.provider,
              selectedProvider: params.selectedProvider,
            })
          : raw;

      const result = await ingestTextDocument({
        source,
        label,
        text: polished,
      });
      if (result.error) throw new Error(result.error);

      toast("Research ready", {
        description: `“${label}” is in Files. Open it to review what was gathered.`,
        variant: "success",
      });
      try {
        window.dispatchEvent(
          new CustomEvent(FILE_RESEARCH_DONE_EVENT, {
            detail: { source, label },
          })
        );
      } catch {
        // ignore
      }
    } catch (err) {
      toast("Research failed", {
        description:
          err instanceof Error ? err.message.slice(0, 160) : String(err),
        variant: "error",
      });
    } finally {
      activeCount = Math.max(0, activeCount - 1);
      emitChanged();
    }
  })();
}
