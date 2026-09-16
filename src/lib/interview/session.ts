import { fetchAIResponse } from "@/lib/functions";
import { retrieveContext } from "@/lib/memory";
import { parseJsonFromLLM, type LlmConfig } from "@/lib/llm";
import { createConversation, saveConversation } from "@/lib/database";
import type { ChatConversation, ChatMessage, Message } from "@/types";
import type { Citation } from "@/types/completion";
import type { InterviewTemplate } from "./templates";
import {
  getEffectiveQuestionCount,
  isCodingInterview,
  isSystemDesignInterview,
} from "./templates";
import type { ReferenceCategory } from "./references";
import {
  buildAssessmentPrompt,
  buildAssessmentUserMessage,
  buildFirstTurnUserMessage,
  buildInterviewerSystemPrompt,
  buildNextTurnUserMessage,
} from "./prompts";

import type { CodingVerdict } from "./coding-eval";
import type { DesignVerdict } from "./design-eval";
import { referenceBlock } from "./references";

export interface InterviewTurn {
  question: string;
  answer: string;
  /** Present when the candidate answered in the coding workbench. */
  coding?: {
    language: string;
    code: string;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
    verdict?: CodingVerdict;
  };
  /** Present when the candidate answered on the system-design canvas. */
  design?: {
    elementSummary: string;
    sceneJson: string;
    hasImage: boolean;
    /** PNG base64 for results UI (may be omitted on older saved results). */
    imageBase64?: string | null;
    verdict?: DesignVerdict;
  };
}

export interface QuestionAssessment {
  question: string;
  answer: string;
  score: number;
  strengths: string[];
  improvements: string[];
  /** Short headline of what a strong answer covers. */
  modelAnswerHint: string;
  /** Full sample answer in markdown (may include ```mermaid diagrams). */
  modelAnswer: string;
  /** Diagram PNG (raw base64) when this was a system-design answer. */
  designImageBase64?: string | null;
}

export interface InterviewAssessment {
  overallScore: number;
  overallSummary: string;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  questions: QuestionAssessment[];
}

export interface InterviewHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

async function* streamInterviewLLM(params: {
  config: LlmConfig;
  systemPrompt: string;
  userMessage: string;
  history?: InterviewHistoryMessage[];
  disableMemory?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const history: Message[] | undefined = params.history?.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for await (const chunk of fetchAIResponse({
    provider: params.config.provider,
    selectedProvider: params.config.selectedProvider,
    systemPrompt: params.systemPrompt,
    history,
    userMessage: params.userMessage,
    disableMemory: params.disableMemory ?? false,
    useWeb: false,
    signal: params.signal,
  })) {
    if (chunk) yield chunk;
  }
}

async function runInterviewLLM(params: {
  config: LlmConfig;
  systemPrompt: string;
  userMessage: string;
  history?: InterviewHistoryMessage[];
  disableMemory?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  let full = "";
  for await (const chunk of streamInterviewLLM(params)) {
    full += chunk;
  }
  return full.trim();
}

function resolveQuestionTurn(params: {
  template: InterviewTemplate;
  history: InterviewHistoryMessage[];
  answeredCount: number;
}): {
  systemPrompt: string;
  effectiveUserMessage: string;
  effectiveHistory: InterviewHistoryMessage[];
  /** When set, skip the LLM and speak this question directly. */
  directQuestion?: string;
} {
  const { template, history, answeredCount } = params;
  const total = getEffectiveQuestionCount(template);
  const remaining = Math.max(0, total - answeredCount - 1);
  const systemPrompt = buildInterviewerSystemPrompt(template);
  const custom = (template.customQuestions ?? []).filter(Boolean);

  // Prefer the user's prepared questions verbatim for speed + fidelity.
  if (answeredCount < custom.length) {
    const q = custom[answeredCount];
    // Go straight to the question — no greeting/preamble.
    const spoken = q;
    return {
      systemPrompt,
      effectiveUserMessage: spoken,
      effectiveHistory: history,
      directQuestion: spoken,
    };
  }

  let effectiveUserMessage =
    history.length === 0
      ? buildFirstTurnUserMessage(template)
      : buildNextTurnUserMessage(
          history.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "",
          remaining,
          null
        );
  let effectiveHistory = history;

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === "user") {
      effectiveHistory = history.slice(0, -1);
      effectiveUserMessage = buildNextTurnUserMessage(
        last.content,
        remaining,
        null
      );
    }
  }

  return { systemPrompt, effectiveUserMessage, effectiveHistory };
}

/**
 * Stream the next interviewer question. Yields text deltas as they arrive so
 * the UI can render + speak sentence-by-sentence without waiting for the full
 * response. Prepared (custom) questions are returned immediately without an LLM call.
 */
export async function* streamNextQuestion(params: {
  config: LlmConfig;
  template: InterviewTemplate;
  history: InterviewHistoryMessage[];
  answeredCount: number;
  signal?: AbortSignal;
}): AsyncGenerator<{ delta: string; full: string }> {
  const { systemPrompt, effectiveUserMessage, effectiveHistory, directQuestion } =
    resolveQuestionTurn(params);

  if (directQuestion) {
    yield { delta: directQuestion, full: directQuestion };
    return;
  }

  let full = "";
  for await (const delta of streamInterviewLLM({
    config: params.config,
    systemPrompt,
    userMessage: effectiveUserMessage,
    history: effectiveHistory,
    disableMemory: false,
    signal: params.signal,
  })) {
    full += delta;
    yield { delta, full };
  }
}

/**
 * Generate the next interviewer question. Pass an empty history to start;
 * otherwise include prior user/assistant turns (candidate answers as user,
 * interviewer questions as assistant).
 */
export async function nextQuestion(params: {
  config: LlmConfig;
  template: InterviewTemplate;
  history: InterviewHistoryMessage[];
  /** How many Q&A pairs are already complete. */
  answeredCount: number;
  signal?: AbortSignal;
}): Promise<{ question: string; userMessage: string }> {
  const { systemPrompt, effectiveUserMessage, effectiveHistory, directQuestion } =
    resolveQuestionTurn(params);

  if (directQuestion) {
    return { question: directQuestion, userMessage: effectiveUserMessage };
  }

  const question = await runInterviewLLM({
    config: params.config,
    systemPrompt,
    userMessage: effectiveUserMessage,
    history: effectiveHistory,
    disableMemory: false,
    signal: params.signal,
  });

  return { question, userMessage: effectiveUserMessage };
}

/**
 * The reference-library category to ground a SPOKEN interview assessment in.
 * Coding/design have their own grounding in their eval functions; a spoken
 * round maps to the closest interview-craft playbook, and the role lens (EM,
 * consulting, data science…) is layered on from `roleLevel` by resolvePlaybook.
 */
function spokenReferenceCategory(
  template: InterviewTemplate
): ReferenceCategory {
  switch (template.category) {
    case "product":
      return "product";
    case "finance":
      return "finance";
    default:
      return "behavioral";
  }
}

/**
 * Produce a structured assessment of the completed Q&A transcript.
 */
export async function generateAssessment(params: {
  config: LlmConfig;
  template: InterviewTemplate;
  turns: InterviewTurn[];
  signal?: AbortSignal;
}): Promise<InterviewAssessment> {
  const { config, template, turns, signal } = params;

  // Ground the SPOKEN rubric in the same reference library the coding/design
  // graders use, so scores are anchored to how top companies actually grade
  // rather than the model's priors. Never blocks grading — degrades to "".
  let grounding = "";
  if (!isCodingInterview(template) && !isSystemDesignInterview(template)) {
    grounding = await referenceBlock({
      category: spokenReferenceCategory(template),
      query: turns.map((t) => t.question).join("\n").slice(0, 6000),
      roleLevel: template.roleLevel,
      signal,
    });
  }

  const baseUserMessage = buildAssessmentUserMessage(turns);
  const raw = await runInterviewLLM({
    config,
    systemPrompt: buildAssessmentPrompt(template),
    userMessage: grounding ? `${grounding}\n\n${baseUserMessage}` : baseUserMessage,
    // Assessment should judge the transcript itself; memory is still useful
    // for grounding "model answer" hints in the candidate's real background.
    disableMemory: false,
    signal,
  });

  const parsed = parseJsonFromLLM<InterviewAssessment>(raw);
  if (parsed && typeof parsed === "object") {
    return normalizeAssessment(parsed, turns);
  }

  // Fallback if the model returned prose instead of JSON.
  return {
    overallScore: 3,
    overallSummary:
      raw ||
      "Assessment could not be fully parsed. Review the transcript and try again.",
    strengths: [],
    improvements: [],
    recommendations: [],
    questions: turns.map((t) => ({
      question: t.question,
      answer: t.answer,
      score: 3,
      strengths: [],
      improvements: [],
      modelAnswerHint: "",
      modelAnswer: "",
    })),
  };
}

/**
 * On-demand coaching for a BEHAVIORAL question, grounded in Profile + uploaded
 * Files (resume/docs). Returns progressive STAR steps + a first-person model
 * answer built from THEIR real experience.
 *
 * Enforces "never without context": if there's nothing to ground on, returns
 * hasContext=false so the UI can prompt them to add Files/Profile instead of
 * fabricating experience.
 */
export async function generateBehavioralHints(params: {
  config: LlmConfig;
  question: string;
  /** Selects the role lens on top of the behavioral playbook (EM, consulting…). */
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<{
  hints: string[];
  modelAnswer: string;
  hasContext: boolean;
  citations?: Citation[];
}> {
  const { config, question, roleLevel, signal } = params;

  let context = "";
  let citations: Citation[] = [];
  try {
    const r = await retrieveContext(question, { skipMemory: false, useWeb: false });
    context = (r.text || "").trim();
    citations = r.citations ?? [];
  } catch {
    context = "";
  }
  // Require real substance beyond an empty "About the user:" header.
  const substantive = context.replace(/about the user:/i, "").trim();
  if (substantive.length < 40) {
    return { hints: [], modelAnswer: "", hasContext: false };
  }

  const systemPrompt =
    `You are a behavioral-interview coach. Use ONLY the candidate's real background provided below to help ` +
    `them answer THIS question with the STAR method. Ground everything in their actual experience: companies, ` +
    `projects, roles, and metrics that appear in the context. NEVER invent experience that is not in the context.\n\n` +
    `Return ONLY JSON (no markdown fences): {"hints": ["..."], "modelAnswer": "..."}.\n` +
    `- "hints": 3–5 PROGRESSIVE steps that walk the candidate through structuring THEIR answer. Each step is one ` +
    `sentence and should reference a specific, relevant piece of their background where possible ` +
    `(e.g. "Open with the migration you led at <their company>, set the scale/stakes").\n` +
    `- "modelAnswer": a DETAILED, speakable STAR answer built from their real background, long enough to ` +
    `speak in about 2–3 minutes (roughly 250–400 words). It must feel like a strong candidate actually ` +
    `telling the story, with specifics, not a 4-line summary. Use these labeled sections:\n` +
    `  1. **Situation** 2–3 sentences painting the concrete context: their role, the team/company, the ` +
    `scale and stakes (team size, users, timeline, business impact), and why it mattered.\n` +
    `  2. **Task** 1–2 sentences on the specific goal they owned and the key constraints or tension.\n` +
    `  3. **Action** 4–6 bullets of the SPECIFIC steps THEY took, the decisions and trade-offs they made ` +
    `and WHY, how they influenced/aligned people, and a concrete example or two. First person ("I …"), ` +
    `showing judgment, not generic verbs.\n` +
    `  4. **Result** 2–3 sentences with quantified outcomes (metrics from their background), the team/business ` +
    `impact, and a brief reflection on what they learned or would do differently.\n` +
    `Only use companies, projects, and numbers that appear in their context; never invent them, but do ` +
    `expand authentically on what's there so the answer is rich and specific.`;

  const grounding = await referenceBlock({
    category: "behavioral",
    query: question,
    roleLevel,
    signal,
  });

  const userMessage =
    (grounding ? `${grounding}\n\n` : "") +
    `CANDIDATE BACKGROUND (Profile + resume/files, ground everything here):\n"""\n${substantive.slice(
      0,
      6000
    )}\n"""\n\n` +
    `BEHAVIORAL QUESTION:\n"""\n${question.slice(0, 2000)}\n"""\n\n` +
    `Give the progressive hints and the model answer now.`;

  const raw = await runInterviewLLM({
    config,
    systemPrompt,
    userMessage,
    // We already injected their context explicitly above.
    disableMemory: true,
    signal,
  });

  const parsed = parseJsonFromLLM<{ hints?: unknown; modelAnswer?: unknown }>(raw);
  return {
    hints: asStringArray(parsed?.hints),
    modelAnswer: String(parsed?.modelAnswer || "").trim(),
    hasContext: true,
    citations: citations.length ? citations : undefined,
  };
}

export interface BehavioralFeedback {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  /** A stronger version of THEIR answer (grounded in what they said). */
  modelAnswer: string;
}

/**
 * Grade a single BEHAVIORAL answer (like the coding/design graders): score +
 * strengths + improvements + a stronger rewrite grounded in what they actually
 * said and their real background. Does not advance the session.
 */
export async function evaluateBehavioralAnswer(params: {
  config: LlmConfig;
  question: string;
  answer: string;
  /** Selects the role lens on top of the behavioral playbook (EM, consulting…). */
  roleLevel?: string | null;
  signal?: AbortSignal;
}): Promise<BehavioralFeedback> {
  const { config, question, answer, roleLevel, signal } = params;

  const systemPrompt =
    `You are a supportive but honest behavioral-interview coach. Grade the candidate's answer to the ` +
    `question below using the STAR method (Situation, Task, Action, Result). Judge structure, specificity, ` +
    `ownership ("I" vs "we"), impact/metrics, and conciseness.\n` +
    `You may use the candidate's real background (provided via context) to ground suggestions, but NEVER ` +
    `invent experience they didn't mention.\n\n` +
    `Return ONLY JSON (no markdown fences):\n` +
    `{\n` +
    `  "score": <number 1-5>,\n` +
    `  "summary": "<1-2 sentences on how strong the answer is>",\n` +
    `  "strengths": ["..."],\n` +
    `  "improvements": ["<specific, actionable fixes>"],\n` +
    `  "modelAnswer": "<a STRONGER version of THEIR answer, ~250-400 words, first person, as labeled STAR ` +
    `steps (**Situation** 2-3 sentences, **Task**, **Action** 4-6 bullets, **Result** with a metric), built ` +
    `from what they said plus their background; do not fabricate>"\n` +
    `}`;

  const grounding = await referenceBlock({
    category: "behavioral",
    query: question,
    roleLevel,
    signal,
  });

  const userMessage =
    (grounding ? `${grounding}\n\n` : "") +
    `QUESTION:\n"""\n${question.slice(0, 2000)}\n"""\n\n` +
    `CANDIDATE'S ANSWER:\n"""\n${answer.slice(0, 6000)}\n"""\n\n` +
    `Grade it now.`;

  const raw = await runInterviewLLM({
    config,
    systemPrompt,
    userMessage,
    // Allow grounding suggestions in the candidate's résumé/work history.
    disableMemory: false,
    signal,
  });

  const parsed = parseJsonFromLLM<Partial<BehavioralFeedback>>(raw);
  const scoreRaw = Number(parsed?.score);
  return {
    score: Number.isFinite(scoreRaw)
      ? Math.min(5, Math.max(1, Math.round(scoreRaw)))
      : 3,
    summary: String(parsed?.summary || "").trim(),
    strengths: asStringArray(parsed?.strengths),
    improvements: asStringArray(parsed?.improvements),
    modelAnswer: String(parsed?.modelAnswer || "").trim(),
  };
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function normalizeAssessment(
  raw: InterviewAssessment,
  turns: InterviewTurn[]
): InterviewAssessment {
  const questions: QuestionAssessment[] = Array.isArray(raw.questions)
    ? raw.questions.map((q: any, i) => {
        const turn = turns[i];
        const designV = turn?.design?.verdict;
        const codingV = turn?.coding?.verdict;
        const workbench = designV || codingV;
        const hint = String(q?.modelAnswerHint || "").trim();
        const modelAnswer = String(
          workbench?.modelAnswer ||
            q?.modelAnswer ||
            q?.idealAnswer ||
            q?.sampleAnswer ||
            hint ||
            ""
        ).trim();
        const strengths = workbench?.strengths?.length
          ? workbench.strengths
          : asStringArray(q?.strengths);
        const improvements = workbench?.improvements?.length
          ? workbench.improvements
          : asStringArray(q?.improvements);
        // Prefer the live Check / Grade verdict over a re-score from text dump.
        const score = workbench
          ? clampScore(workbench.score)
          : clampScore(q?.score);
        return {
          question: String(q?.question || turn?.question || "").trim(),
          answer: String(turn?.answer || q?.answer || "").trim(),
          score,
          strengths,
          improvements,
          modelAnswerHint: hint || String(workbench?.feedback || "").trim(),
          modelAnswer,
          designImageBase64: turn?.design?.imageBase64 ?? null,
        };
      })
    : turns.map((t) => ({
        question: t.question,
        answer: t.answer,
        score: clampScore(t.design?.verdict?.score ?? t.coding?.verdict?.score ?? 3),
        strengths: t.design?.verdict?.strengths ?? t.coding?.verdict?.strengths ?? [],
        improvements:
          t.design?.verdict?.improvements ?? t.coding?.verdict?.improvements ?? [],
        modelAnswerHint: t.design?.verdict?.feedback ?? t.coding?.verdict?.feedback ?? "",
        modelAnswer:
          t.design?.verdict?.modelAnswer ?? t.coding?.verdict?.modelAnswer ?? "",
        designImageBase64: t.design?.imageBase64 ?? null,
      }));

  const hasWorkbench = turns.some((t) => t.design?.verdict || t.coding?.verdict);
  const overallScore = hasWorkbench && questions.length
    ? clampScore(
        questions.reduce((sum, q) => sum + q.score, 0) / questions.length
      )
    : clampScore(raw.overallScore);

  return {
    overallScore,
    overallSummary: String(raw.overallSummary || "").trim(),
    strengths: asStringArray(raw.strengths),
    improvements: asStringArray(raw.improvements),
    recommendations: asStringArray(raw.recommendations),
    questions,
  };
}

/**
 * Persist a finished practice session as a chat conversation so it appears in
 * Chats and can be summarized into memory.
 */
export async function persistPracticeSession(params: {
  template: InterviewTemplate;
  turns: InterviewTurn[];
  assessment: InterviewAssessment | null;
  conversationId?: string;
}): Promise<ChatConversation> {
  const { template, turns, assessment } = params;
  const now = Date.now();
  const id =
    params.conversationId ||
    `interview-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    messages.push({
      id: `${id}-q-${messages.length}`,
      role: "assistant",
      content: turn.question,
      timestamp: now + messages.length,
      speaker: "Interviewer",
      origin: "chat",
    });
    messages.push({
      id: `${id}-a-${messages.length}`,
      role: "user",
      content: turn.answer,
      timestamp: now + messages.length,
      speaker: "You",
      origin: "chat",
    });
  }

  if (assessment) {
    const report = formatAssessmentAsMarkdown(assessment);
    messages.push({
      id: `${id}-assessment`,
      role: "assistant",
      content: report,
      timestamp: now + messages.length,
      displayLabel: "Interview assessment",
      origin: "chat",
    });
  }

  const conversation: ChatConversation = {
    id,
    title: `Interview Practice: ${template.title}`,
    messages,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createConversation(conversation);
  } catch {
    // If it already exists (retry), overwrite.
    await saveConversation(conversation);
  }
  return conversation;
}

export function formatAssessmentAsMarkdown(
  assessment: InterviewAssessment
): string {
  const lines: string[] = [
    `## Interview assessment`,
    ``,
    `**Overall score:** ${assessment.overallScore}/5`,
    ``,
    assessment.overallSummary,
  ];

  if (assessment.strengths.length) {
    lines.push(``, `### Strengths`);
    for (const s of assessment.strengths) lines.push(`- ${s}`);
  }
  if (assessment.improvements.length) {
    lines.push(``, `### Areas to improve`);
    for (const s of assessment.improvements) lines.push(`- ${s}`);
  }
  if (assessment.recommendations.length) {
    lines.push(``, `### Recommendations`);
    for (const s of assessment.recommendations) lines.push(`- ${s}`);
  }

  if (assessment.questions.length) {
    lines.push(``, `### Per-question feedback`);
    assessment.questions.forEach((q, i) => {
      lines.push(``, `#### Q${i + 1} · ${q.score}/5`);
      lines.push(`**Question:** ${q.question}`);
      lines.push(`**Your answer:** ${q.answer}`);
      if (q.strengths.length) {
        lines.push(`**Strengths:** ${q.strengths.join("; ")}`);
      }
      if (q.improvements.length) {
        lines.push(`**Improve:** ${q.improvements.join("; ")}`);
      }
      if (q.modelAnswerHint) {
        lines.push(`**Stronger answer would cover:** ${q.modelAnswerHint}`);
      }
      if (q.modelAnswer) {
        lines.push(``, `**Answer:**`, ``, q.modelAnswer);
      }
    });
  }

  return lines.join("\n");
}
