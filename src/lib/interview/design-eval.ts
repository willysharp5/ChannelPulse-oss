import { parseJsonFromLLM, runLLM, type LlmConfig } from "@/lib/llm";
import { SYSTEM_DESIGN_SOLUTION_FORMAT } from "./model-answer-format";
import type { CodingVerdict } from "./coding-eval";
import { referenceBlock } from "./references";
import { px } from "@/lib/prompts/overrides";

export type DesignVerdict = CodingVerdict;

export interface DesignSubmission {
  /** PNG of the canvas (raw base64, no data: prefix). */
  imageBase64: string | null;
  /** Short text inventory of drawn shapes / labels. */
  elementSummary: string;
  /**
   * Text the candidate wrote on the canvas — sticky notes, comments, captions,
   * arrow labels, and free text — treated as part of their spoken answer.
   */
  notesAndComments: string;
  /** Serialized Excalidraw scene JSON (truncated for storage). */
  sceneJson: string;
}

/**
 * Grade a system-design diagram against the problem statement.
 * Prefers the canvas PNG (vision) and falls back to the element summary.
 * Notes / comments on the diagram count as part of the answer.
 */
export async function evaluateDesignSubmission(params: {
  config: LlmConfig;
  question: string;
  submission: DesignSubmission;
  /** Selects the role lens on top of the system-design playbook (EM…). */
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<DesignVerdict> {
  const { config, question, submission } = params;

  const systemPrompt =
    `You are a strict but fair system-design interviewer grading a practice diagram.\n` +
    `The candidate drew an architecture on a whiteboard (image and/or shape inventory) ` +
    `and may have written NOTES / COMMENTS / LABELS on the canvas; treat those notes as ` +
    `part of their answer (assumptions, trade-offs, APIs, data model, failure modes).\n` +
    `Decide PASS or FAIL for this single question.\n` +
    `PASS means: covers main components, data flow, and tradeoffs appropriate to the prompt ` +
    `(missing polish is OK). Score 4–5.\n` +
    `FAIL means: empty/near-empty canvas, irrelevant shapes, or missing the core of the problem. Score 1–3.\n` +
    `Score 5 only if the diagram AND notes cover the core architecture, main data flows, ` +
    `key trade-offs, and at least one realistic scale/failure consideration.\n` +
    `When giving feedback, refer to what IS and ISN'T in THEIR diagram and notes ` +
    `(components, connections, labels, written comments) and point to concrete additions ` +
    `(e.g. "add a load balancer before the app tier", "your note mentions caching but the ` +
    `read path isn't drawn", "annotate the write path with the queue").\n` +
    `strengths: concrete things they DID well (diagram pieces + notes). Use checkmark-ready phrases.\n` +
    `improvements: the specific gaps that kept them from a 5/5; each item should explain ` +
    `what is missing or weak and why it costs points. Even a 5/5 can have 1 stretch improvement.\n` +
    `Also produce PROGRESSIVE HINTS that coach the candidate to improve THEIR OWN diagram, ` +
    `ordered from a gentle nudge, to a more specific pointer, to a concrete step. ` +
    `Hints must NOT reveal the whole architecture; that belongs only in modelAnswer. ` +
    `Give 2-4 hints even when the design passes (edge cases, scale, failure modes).\n` +
    `For EACH hint, also provide a small mermaid "flowchart" diagram that visualizes just ` +
    `that hint (the components/connections it's about), aligned by index in "hintDiagrams". ` +
    `Keep each diagram tiny and VALID mermaid: start with "flowchart LR" or "flowchart TD", ` +
    `use simple node ids (letters/underscore only), quoted labels when using (), /, :, ` +
    `NO styling/classDef, and NO backticks. Prefer NO subgraphs in hint diagrams. ` +
    `Use an empty string when a diagram wouldn't help.\n\n` +
    `CRITICAL: modelAnswer must be a FULL editorial solution guide for THIS problem ` +
    `(PracHub / Educative depth), not a short summary:\n` +
    px("interview.model_answer_system_design", SYSTEM_DESIGN_SOLUTION_FORMAT) +
    `\n\n` +
    `Return ONLY JSON (no markdown fences around the whole JSON) with this shape:\n` +
    `{\n` +
    `  "passed": <boolean>,\n` +
    `  "score": <1-5>,\n` +
    `  "feedback": "<2-4 sentences summarizing the grade and why this score>",\n` +
    `  "strengths": ["<what they did well>", "..."],\n` +
    `  "improvements": ["<gap that kept them from 5/5, be specific>", "..."],\n` +
    `  "hints": ["<gentle nudge>", "<more specific>", "<concrete step, not the whole design>"],\n` +
    `  "hintDiagrams": ["flowchart LR\\n  Client[Client] --> LB[Load balancer]", "", "..."],\n` +
    `  "modelAnswer": "<DETAILED markdown guide with required ## sections and a Mermaid diagram; escape newlines as \\n>"\n` +
    `}`;

  const grounding = await referenceBlock({
    category: "system_design",
    query: question,
    roleLevel: params.roleLevel,
    signal: params.signal,
  });

  const notes = submission.notesAndComments?.trim() || "";
  const userMessage =
    (grounding ? `${grounding}\n\n` : "") +
    `PROBLEM:\n"""\n${question.slice(0, 6000)}\n"""\n\n` +
    `DIAGRAM SHAPE INVENTORY:\n"""\n${submission.elementSummary.slice(0, 6000) || "(empty)"}\n"""\n\n` +
    `NOTES / COMMENTS / LABELS WRITTEN ON THE CANVAS:\n"""\n${notes.slice(0, 6000) || "(none)"}\n"""\n\n` +
    (submission.imageBase64
      ? `A PNG of the candidate's whiteboard is attached. Use it as the primary evidence, ` +
        `including any handwritten or typed notes visible in the image.\n`
      : `No image was attached. Grade from the shape inventory and notes only.\n`) +
    `\nGrade the diagram + notes together as the full answer, then write the DETAILED modelAnswer guide.`;

  const images = submission.imageBase64 ? [submission.imageBase64] : undefined;

  const raw = await runLLM(config, systemPrompt, userMessage, {
    imagesBase64: images,
    signal: params.signal,
    structured: true,
    maxTokens: 8192,
  });

  return normalizeVerdict(raw);
}

export function formatDesignAnswer(submission: DesignSubmission): string {
  const parts: string[] = ["### System design diagram", ""];
  if (submission.elementSummary.trim()) {
    parts.push(submission.elementSummary.trim());
  } else {
    parts.push("_(Empty or nearly empty canvas)_");
  }
  if (submission.notesAndComments?.trim()) {
    parts.push("");
    parts.push("### Notes on the diagram");
    parts.push(submission.notesAndComments.trim());
  }
  if (submission.imageBase64) {
    parts.push("");
    parts.push("_(Diagram image attached.)_");
  }
  return parts.join("\n");
}

/**
 * Turn Excalidraw elements into a readable architecture inventory for grading
 * and results — labeled components + connections, not a dump of "rectangle".
 */
export function summarizeExcalidrawElements(elements: readonly any[]): {
  elementSummary: string;
  notesAndComments: string;
  components: string[];
  connections: string[];
} {
  const live = elements.filter((e) => e && !e.isDeleted);
  const byId = new Map<string, any>(live.map((e) => [e.id, e]));

  const clean = (v: unknown) =>
    typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";

  const labelOf = (el: any): string => {
    if (!el) return "";
    const direct = clean(el.text) || clean(el.originalText) || clean(el.label?.text);
    if (direct) return direct;
    const bound = Array.isArray(el.boundElements) ? el.boundElements : [];
    for (const b of bound) {
      if (b?.type === "text" && b.id) {
        const te = byId.get(b.id);
        const t = clean(te?.text) || clean(te?.originalText);
        if (t) return t;
      }
    }
    return "";
  };

  const components: string[] = [];
  const seenComp = new Set<string>();
  const pushComp = (label: string) => {
    const key = label.toLowerCase();
    if (!label || seenComp.has(key)) return;
    seenComp.add(key);
    components.push(label);
  };

  for (const el of live) {
    if (
      el.type === "rectangle" ||
      el.type === "ellipse" ||
      el.type === "diamond" ||
      el.type === "embeddable" ||
      el.type === "frame"
    ) {
      const label = labelOf(el);
      if (label) pushComp(label);
    }
  }

  // Standalone short text near the diagram often labels a box — include if not
  // already captured via a container binding.
  for (const el of live) {
    if (el.type !== "text") continue;
    if (el.containerId) continue; // already counted via bound shape
    const label = labelOf(el);
    if (!label) continue;
    // Long prose = a real note, not a component name.
    if (label.length > 40 || /[.!?]\s|[.!?]$/.test(label)) continue;
    pushComp(label);
  }

  const connections: string[] = [];
  const seenConn = new Set<string>();
  for (const el of live) {
    if (el.type !== "arrow" && el.type !== "line") continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    const from = labelOf(startId ? byId.get(startId) : null) || "…";
    const to = labelOf(endId ? byId.get(endId) : null) || "…";
    const arrowLabel = labelOf(el);
    if (from === "…" && to === "…" && !arrowLabel) continue;
    const line =
      from !== "…" || to !== "…"
        ? `${from} → ${to}${arrowLabel ? ` (${arrowLabel})` : ""}`
        : arrowLabel;
    const key = line.toLowerCase();
    if (seenConn.has(key)) continue;
    seenConn.add(key);
    connections.push(line);
  }

  // Real notes only: custom comments, or longer free text (not component labels).
  const notes: string[] = [];
  const seenNote = new Set<string>();
  const pushNote = (n: string) => {
    const key = n.toLowerCase();
    if (!n || seenNote.has(key) || seenComp.has(key)) return;
    seenNote.add(key);
    notes.push(n);
  };

  for (const el of live) {
    const custom =
      clean(el.customData?.comment) ||
      clean(el.customData?.note) ||
      clean(el.customData?.text);
    if (custom) pushNote(custom);

    if (el.type === "text" && !el.containerId) {
      const t = labelOf(el);
      // Paragraph-style canvas notes only — skip short labels already in components.
      if (
        t &&
        (t.length > 40 ||
          /[.!?]\s|[.!?]$/.test(t) ||
          /\b(assume|trade-?off|scale|fail|latency|throughput|note:)\b/i.test(t))
      ) {
        pushNote(t);
      }
    }
  }

  const lines: string[] = [];
  if (components.length) {
    lines.push("Components:");
    for (const c of components.slice(0, 40)) lines.push(`- ${c}`);
  }
  if (connections.length) {
    if (lines.length) lines.push("");
    lines.push("Connections:");
    for (const c of connections.slice(0, 40)) lines.push(`- ${c}`);
  }
  if (!lines.length) {
    lines.push(
      live.length
        ? "(Shapes drawn, but no readable labels; grade from the diagram image.)"
        : "(Empty canvas)"
    );
  }

  return {
    elementSummary: lines.join("\n"),
    notesAndComments: notes
      .slice(0, 30)
      .map((n, i) => `${i + 1}. ${n}`)
      .join("\n"),
    components,
    connections,
  };
}

function normalizeVerdict(rawText: string): DesignVerdict {
  const raw = parseJsonFromLLM<Partial<DesignVerdict>>(rawText);
  const scoreRaw = Number(raw?.score);
  const score = Number.isFinite(scoreRaw)
    ? Math.min(5, Math.max(1, Math.round(scoreRaw)))
    : 3;
  const passed =
    typeof raw?.passed === "boolean" ? raw.passed : score >= 4;
  const improvements = asStringArray(raw?.improvements).map(stripLeadingMark);
  const modelHints = asStringArray(raw?.hints).map(stripLeadingMark);
  const hints = modelHints.length ? modelHints : improvements;
  // Keep hint diagrams aligned by index with the (model-provided) hints.
  const hintDiagrams = modelHints.length
    ? alignedStrings(raw?.hintDiagrams, hints.length)
    : [];
  const feedback = cleanFeedback(String(raw?.feedback || "").trim(), rawText);
  return {
    passed,
    score,
    feedback,
    strengths: asStringArray(raw?.strengths).map(stripLeadingMark),
    improvements,
    // Fall back to improvements so there's always something to reveal step-by-step.
    hints,
    hintDiagrams,
    modelAnswer: String(raw?.modelAnswer || "").trim(),
  };
}

/** Never dump raw JSON into the Feedback panel. */
function cleanFeedback(parsed: string, rawText: string): string {
  if (parsed && !looksLikeJsonBlob(parsed)) return parsed;
  if (looksLikeJsonBlob(rawText)) {
    return "Couldn’t fully parse the grade (response was cut off). Try Check again. Your score fields may still be partial.";
  }
  const fallback = rawText.trim().slice(0, 400);
  return (
    fallback ||
    "Could not parse a full grade. Review the diagram and try again."
  );
}

function looksLikeJsonBlob(s: string): boolean {
  const t = s.trim();
  return (
    (t.startsWith("{") || t.startsWith("```")) &&
    /"passed"\s*:|"score"\s*:|"feedback"\s*:/.test(t)
  );
}

function stripLeadingMark(s: string): string {
  return s.replace(/^[✓✔✗✘→\-•\*]+\s*/, "").trim();
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/** Map to strings WITHOUT dropping empties, padded/truncated to `len`. */
function alignedStrings(v: unknown, len: number): string[] {
  const arr = Array.isArray(v) ? v.map((x) => String(x ?? "").trim()) : [];
  const out: string[] = [];
  for (let i = 0; i < len; i++) out.push(arr[i] ?? "");
  return out;
}
