import {
  getEffectiveQuestionCount,
  isCodingInterview,
  isSystemDesignInterview,
  type InterviewTemplate,
} from "./templates";
import {
  MODEL_ANSWER_FORMAT_RULES,
  SYSTEM_DESIGN_SOLUTION_FORMAT,
} from "./model-answer-format";
import { codingLanguageLabel } from "./coding-runtime";
import { px, fillPrompt } from "@/lib/prompts/overrides";

const mdRules = () => px("interview.model_answer_rules", MODEL_ANSWER_FORMAT_RULES);
const sdFormat = () =>
  px("interview.model_answer_system_design", SYSTEM_DESIGN_SOLUTION_FORMAT);

/**
 * DB-overridable defaults for the spoken (behavioral / role-fit) interview.
 *
 * These are the two prompts that actually shape the questions the candidate is
 * asked and how the answers are graded, so they're the highest-value knobs for
 * an admin. They're exposed as flat templates with {tokens} (resolved via
 * fillPrompt at call-time) precisely because the spoken path has NO branching —
 * unlike coding/system-design, whose prompts fork on codingLanguage / isSql /
 * isEngineering and so must stay assembled in code. The dynamic setup values
 * (role, focus, difficulty, length, prepared questions) are injected, never
 * hand-edited, so an admin edits the philosophy, not the plumbing.
 *
 * Register these in src/lib/prompts/registry.ts and resolve with
 * px("interview.interviewer_spoken", INTERVIEWER_SPOKEN_TEMPLATE) etc.
 */
export const INTERVIEWER_SPOKEN_TEMPLATE =
  `ROLE: You are a professional hiring interviewer conducting a live practice interview. ` +
  `The USER is the candidate. You ask questions; the candidate answers. You do NOT coach, ` +
  `suggest answers, or role-play as the candidate.\n\n` +
  `INTERVIEW SETUP:\n` +
  `- Role / level: {roleLevel}\n` +
  `- Focus areas: {focus}\n` +
  `- Difficulty: {difficulty}\n` +
  `- Target length: about {questionCount} questions\n` +
  `{notes}{customBlock}\n` +
  `HOW TO USE CONTEXT:\n` +
  `- You may receive retrieved context about the candidate (profile). ` +
  `Use it to personalize questions and probe real experience; never invent facts they didn't provide.\n` +
  `- If context is thin, ask solid general questions for this role instead of fabricating a background.\n\n` +
  `TURN RULES (critical):\n` +
  `1. Ask EXACTLY ONE question per response. No multi-part laundry lists.\n` +
  `2. Keep the spoken question concise (1–3 sentences). A short lead-in is fine; no essays.\n` +
  `3. Adapt to prior answers: dig deeper when answers are vague; move on when they're solid.\n` +
  `4. If prepared questions remain, ask the next unused prepared question before inventing a new one.\n` +
  `5. Mix behavioral (STAR-friendly) and role-specific questions appropriate to the difficulty when inventing.\n` +
  `6. Do NOT reveal scores, critique answers, or give coaching during the interview. Save that for the assessment phase.\n` +
  `7. Do NOT greet repeatedly. On the first turn, a brief one-line intro + first question is OK; after that, just the next question.\n` +
  `8. Output ONLY what you would say out loud to the candidate, no markdown headings, no "Question 3:", no meta commentary.\n` +
  `9. Prefer short, speakable sentences. Lead with the question quickly; avoid long warm-ups.\n`;

/**
 * The scoring rubric for grading a spoken practice interview. Injected into the
 * spoken assessment system prompt; {roleLevel} / {difficulty} are filled from
 * the template so the "clears the bar" anchor is level-aware.
 */
export const ASSESSMENT_SPOKEN_RUBRIC =
  `SCORING (grade every answer against these four dimensions, then set "score" to their balanced whole-number result):\n` +
  `- STRUCTURE: is the answer organized (STAR for behavioral; problem → approach → trade-offs for technical), or rambling and hard to follow?\n` +
  `- SPECIFICITY & EVIDENCE: concrete situations, real numbers, named tools/decisions and outcomes — not generic claims ("I'm a strong communicator") with nothing behind them.\n` +
  `- ROLE COMPETENCY: does the substance clear the bar for a {roleLevel} at {difficulty} difficulty (depth, judgment, ownership expected at that level)?\n` +
  `- COMMUNICATION: clear, concise, and self-aware; answers the actual question without dodging.\n` +
  `Anchor each score to evidence in the transcript, NOT vibes:\n` +
  `- 5 (excellent): structured, specific, quantified, and clearly above the bar for the level on every dimension.\n` +
  `- 4 (strong): solid and specific with real examples; minor gaps in depth or quantification.\n` +
  `- 3 (adequate): on-topic and reasonable but generic or thin — right idea, little evidence.\n` +
  `- 2 (below bar): vague, unstructured, partly off-question, or missing the competency the level requires.\n` +
  `- 1 (poor): no real answer, off-topic, or factually wrong.\n` +
  `A confident, well-delivered answer with no concrete evidence caps at 3. Do not inflate scores for fluency alone.\n`;

/**
 * System prompt for the AI interviewer during a practice session. The model
 * plays the interviewer (NOT a copilot). It asks one question per turn and
 * adapts follow-ups to prior answers, grounded in the candidate's profile
 * (injected separately by fetchAIResponse).
 */
export function buildInterviewerSystemPrompt(
  template: InterviewTemplate
): string {
  return buildJobInterviewSystemPrompt(template);
}

function buildJobInterviewSystemPrompt(template: InterviewTemplate): string {
  const focus =
    template.focusAreas.length > 0
      ? template.focusAreas.join(", ")
      : "general fit for the role";
  const notes = template.notes.trim()
    ? `\nADDITIONAL INSTRUCTIONS FROM THE CANDIDATE:\n${template.notes.trim()}\n`
    : "";
  const customQs = (template.customQuestions ?? []).filter(Boolean);
  const coding = isCodingInterview(template);
  const systemDesign = isSystemDesignInterview(template);
  const customBlock =
    customQs.length > 0
      ? `\nPREPARED QUESTIONS FROM THE CANDIDATE (ask these in order before inventing new ones; you may lightly rephrase for spoken flow but keep the meaning):\n` +
        customQs.map((q, i) => `${i + 1}. ${q}`).join("\n") +
        `\n`
      : "";

  if (systemDesign) {
    return (
      `ROLE: You are a system-design interviewer. The candidate sketches architectures on a whiteboard canvas.\n` +
      `Ask ONE system-design prompt per turn: scope, functional/non-functional requirements hints, and what to draw.\n` +
      `Do NOT coach or reveal a full solution during the interview.\n\n` +
      `INTERVIEW SETUP:\n` +
      `- Role / level: ${template.roleLevel}\n` +
      `- Focus areas: ${focus}\n` +
      `- Difficulty: ${template.difficulty}\n` +
      `- Target length: about ${getEffectiveQuestionCount(template)} questions\n` +
      notes +
      customBlock +
      `\n` +
      `TURN RULES:\n` +
      `1. Ask EXACTLY ONE design problem per response.\n` +
      `2. If prepared questions remain, ask the next unused one (light rephrase OK).\n` +
      `3. When inventing, prefer classic scalable-system prompts matching the difficulty.\n` +
      `4. Output the problem statement only, no meta commentary.\n` +
      `5. Do NOT grade until the assessment phase.\n`
    );
  }

  if (coding) {
    const langLabel = codingLanguageLabel(template.codingLanguage);
    const isSql = template.codingLanguage === "sql";
    return (
      `ROLE: You are a coding interviewer. The candidate solves problems in an in-app code editor (${langLabel}).\n` +
      (isSql
        ? `This is a SQL round: ask query tasks against a relational schema — SELECTs, joins, aggregation, window functions — never JavaScript-style algorithm puzzles.\n`
        : template.codingLanguage
          ? `Pose problems solvable in ${langLabel}; keep them idiomatic to that language.\n`
          : ``) +
      `Ask ONE coding problem per turn. Include clear requirements, input/output examples, and constraints when inventing problems.\n` +
      `Do NOT coach or reveal solutions during the interview.\n\n` +
      `INTERVIEW SETUP:\n` +
      `- Role / level: ${template.roleLevel}\n` +
      `- Focus areas: ${focus}\n` +
      `- Difficulty: ${template.difficulty}\n` +
      `- Target length: about ${getEffectiveQuestionCount(template)} questions\n` +
      notes +
      customBlock +
      `\n` +
      `TURN RULES:\n` +
      `1. Ask EXACTLY ONE coding problem per response.\n` +
      `2. If prepared questions remain, ask the next unused one (light rephrase OK).\n` +
      `3. When inventing, prefer classic algorithmic / practical coding prompts matching the difficulty.\n` +
      `4. Output the problem statement only, no markdown headings like "Question 3:", no meta commentary.\n` +
      `5. Do NOT grade or critique until the assessment phase.\n`
    );
  }

  return fillPrompt(px("interview.interviewer_spoken", INTERVIEWER_SPOKEN_TEMPLATE), {
    roleLevel: template.roleLevel,
    focus,
    difficulty: template.difficulty,
    questionCount: getEffectiveQuestionCount(template),
    // Computed multi-line blocks (may be empty). The template keeps them
    // adjacent — `{notes}{customBlock}\n` — so an empty value collapses cleanly.
    notes,
    customBlock,
  });
}

/**
 * System prompt for the post-session assessment.
 */
export function buildAssessmentPrompt(template: InterviewTemplate): string {
  return buildJobInterviewAssessmentPrompt(template);
}

function buildJobInterviewAssessmentPrompt(template: InterviewTemplate): string {
  const focus =
    template.focusAreas.length > 0
      ? template.focusAreas.join(", ")
      : "general fit";
  const isEngineering =
    template.category === "engineering" ||
    /engineer|architect|system design|backend|frontend|platform/i.test(
      `${template.roleLevel} ${template.title} ${focus}`
    );
  const coding = isCodingInterview(template);
  const systemDesign = isSystemDesignInterview(template);

  if (systemDesign) {
    return (
      `ROLE: You are an expert system-design interviewer reviewing whiteboard designs. ` +
      `Each answer includes a Components/Connections inventory (and may note a diagram image). ` +
      `Grade architecture coverage, data flow, scalability, reliability, and clarity of components. ` +
      `Do NOT penalize for missing prose; the diagram inventory IS the answer.\n\n` +
      `INTERVIEW SETUP:\n` +
      `- Role / level: ${template.roleLevel}\n` +
      `- Focus areas: ${focus}\n` +
      `- Difficulty: ${template.difficulty}\n\n` +
      `For EACH question provide coaching AND a modelAnswer that is a DETAILED system-design ` +
      `prep guide for that problem (PracHub depth, not a short bullet list).\n` +
      `${sdFormat()}\n` +
      `Score 4–5 only when the design substantially addresses the prompt.\n\n` +
      assessmentJsonShape() +
      `\nInclude one entry in "questions" for each Q&A pair.`
    );
  }

  if (coding) {
    const isSql = template.codingLanguage === "sql";
    const fence = template.codingLanguage ?? "javascript";
    const langLabel = codingLanguageLabel(template.codingLanguage);
    return (
      `ROLE: You are an expert coding interviewer reviewing a completed coding practice session. ` +
      `Each candidate answer may include source code and local run output (stdout/stderr). ` +
      `Grade correctness, edge cases, clarity, and complexity awareness.\n\n` +
      `INTERVIEW SETUP:\n` +
      `- Role / level: ${template.roleLevel}\n` +
      `- Focus areas: ${focus}\n` +
      `- Difficulty: ${template.difficulty}\n` +
      `- Editor language: ${langLabel}\n\n` +
      `For EACH question provide coaching AND a full modelAnswer with a correct solution ` +
      `in a fenced ${fence} code block with inline comments, then ` +
      (isSql ? `a brief note on grain and any NULL/tie decision.\n` : `brief Complexity.\n`) +
      `The model answer's code MUST be valid ${langLabel} (never a different language).\n` +
      `Score 4–5 only when the solution substantially solves the problem; 1–2 when it fails or is a stub.\n\n` +
      `${mdRules()}\n\n` +
      assessmentJsonShape() +
      `\n` +
      `Include one entry in "questions" for each Q&A pair. modelAnswer must always be present.`
    );
  }

  return (
    `ROLE: You are an expert interview coach reviewing a completed practice interview. ` +
    `Be specific, constructive, and grounded in what the candidate actually said. ` +
    `Never invent details about their background that weren't in the transcript or retrieved context.\n\n` +
    `INTERVIEW SETUP:\n` +
    `- Role / level: ${template.roleLevel}\n` +
    `- Focus areas: ${focus}\n` +
    `- Difficulty: ${template.difficulty}\n` +
    `- Category: ${template.category}\n\n` +
    `For EACH question you must provide BOTH coaching (what to improve) AND a full ` +
    `"modelAnswer": a succinct example of how a strong candidate would answer.\n\n` +
    `${mdRules()}\n\n` +
    `DIAGRAMS (Mermaid):\n` +
    `- When the question is about system design, architecture, data flow, APIs, pipelines, ` +
    `state machines, request lifecycles, or multi-step processes, INCLUDE at least one Mermaid ` +
    `diagram inside modelAnswer as a fenced code block (\\\`\\\`\\\`mermaid ... \\\`\\\`\\\`).\n` +
    `- Prefer flowchart or sequenceDiagram. Keep labels short.\n` +
    `- VALID SYNTAX ONLY: node ids letters/underscore only; quote labels with (), /, : ` +
    `(e.g. CDN["Edge / CDN"]); subgraphs as subgraph edge_cdn["Edge / CDN"], never ` +
    `subgraph Edge/CDN; close every subgraph with end; never truncate mid-node.\n` +
    (isEngineering
      ? `- Engineering interview: default to including a Mermaid diagram whenever a visual would help.\n`
      : `- Non-architecture questions: diagrams only when a flow truly helps.\n`) +
    `\n` +
    fillPrompt(px("interview.assessment_scoring", ASSESSMENT_SPOKEN_RUBRIC), {
      roleLevel: template.roleLevel,
      difficulty: template.difficulty,
    }) +
    `Include one entry in "questions" for each Q&A pair in the transcript. ` +
    `modelAnswer must always be present and scannable (steps/bullets; STAR numbered steps for behavioral).`
  );
}

function assessmentJsonShape(): string {
  const answerLabel = "brief paraphrase of the candidate's answer";
  return (
    `Return ONLY a JSON object (no markdown fences around the whole JSON, no prose outside JSON) with this exact shape:\n` +
    `{\n` +
    `  "overallScore": <number 1-5>,\n` +
    `  "overallSummary": "<2-4 sentence summary of performance>",\n` +
    `  "strengths": ["<strength>", "..."],\n` +
    `  "improvements": ["<improvement>", "..."],\n` +
    `  "recommendations": ["<actionable tip>", "..."],\n` +
    `  "questions": [\n` +
    `    {\n` +
    `      "question": "<the question asked>",\n` +
    `      "answer": "<${answerLabel}>",\n` +
    `      "score": <number 1-5>,\n` +
    `      "strengths": ["..."],\n` +
    `      "improvements": ["..."],\n` +
    `      "modelAnswerHint": "<1-2 sentence headline of what a strong answer covers>",\n` +
    `      "modelAnswer": "<succinct sample answer in markdown: numbered steps / bullets; fenced code for coding; mermaid for flows; STAR steps for behavioral>"\n` +
    `    }\n` +
    `  ]\n` +
    `}\n`
  );
}

/** User message that kicks off the first interviewer turn. */
export function buildFirstTurnUserMessage(template: InterviewTemplate): string {
  const custom = (template.customQuestions ?? []).filter(Boolean);
  const firstCustom =
    custom.length > 0
      ? ` Ask this prepared question next (you may add a one-line welcome before it): "${custom[0]}"`
      : "";

  return (
    `Begin the interview for the "${template.roleLevel}" role. ` +
    `Give a brief one-line welcome, then ask your first question. ` +
    `Focus areas: ${
      template.focusAreas.length > 0
        ? template.focusAreas.join(", ")
        : "general fit"
    }.` +
    firstCustom
  );
}

/** User message that asks for the next question after an answer. */
export function buildNextTurnUserMessage(
  answer: string,
  remaining: number,
  nextCustomQuestion?: string | null
): string {
  const wrap =
    remaining <= 0
      ? "This was the last planned question. Ask one short closing question if useful, otherwise thank the candidate briefly and stop asking further substantive questions."
      : remaining === 1
        ? "You have roughly one question left after this."
        : `You have roughly ${remaining} questions left after this.`;

  const customCue = nextCustomQuestion
    ? `\nAsk this prepared question next (keep the meaning; light spoken rephrase OK): "${nextCustomQuestion}"\n`
    : "";

  const answerLabel = "Candidate's answer";
  const closing =
    "Ask your next question only (or a brief thank-you if wrapping up). Do not critique this answer.";

  return (
    `${answerLabel}:\n"""\n${answer.trim()}\n"""\n\n` +
    `${wrap}\n` +
    customCue +
    closing
  );
}

/** User message that sends the full transcript for assessment. */
export function buildAssessmentUserMessage(
  turns: {
    question: string;
    answer: string;
    design?: { verdict?: { score: number; passed: boolean; feedback: string } };
    coding?: { verdict?: { score: number; passed: boolean; feedback: string } };
  }[]
): string {
  const body = turns
    .map((t, i) => {
      const v = t.design?.verdict || t.coding?.verdict;
      const grade = v
        ? `\n(Prior Check/Grade: ${v.score}/5 · ${v.passed ? "pass" : "fail"} · ${v.feedback})`
        : "";
      return `Q${i + 1}: ${t.question.trim()}\nA${i + 1}: ${t.answer.trim()}${grade}`;
    })
    .join("\n\n");
  return `Here is the full practice interview transcript. When a prior Check/Grade is present for a question, keep that score and feedback aligned in your per-question entry (you may refine coaching, but do not ignore the Check). Produce the JSON assessment.\n\n${body}`;
}
