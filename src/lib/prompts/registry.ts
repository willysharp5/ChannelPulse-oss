/**
 * Registry of every app prompt that is DB-overridable. Single source of the
 * DEFAULT text (imported from where each prompt lives) + metadata for the admin
 * console (label, category, where it's used). The store seeds `app_prompts` from
 * these defaults and the admin edits them; use-sites resolve via px(key, default).
 */
import {
  COPILOT_TRIAGE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  GENERIC_COPILOT_GUIDANCE,
  INTERVIEW_COPILOT_PROMPT,
  INTERVIEW_LENGTH_AUTO,
  INTERVIEW_LENGTH_MEDIUM,
  INTERVIEW_LENGTH_SHORT,
  CHAT_ANALYSIS_SYSTEM_PROMPT,
  MARKDOWN_FORMATTING_INSTRUCTIONS,
  DEFAULT_QUICK_ACTIONS,
  QUICK_ACTION_PROMPTS,
  quickActionKey,
} from "@/config/constants";
import {
  MODEL_ANSWER_FORMAT_RULES,
  SYSTEM_DESIGN_SOLUTION_FORMAT,
} from "@/lib/interview/model-answer-format";
import {
  INTERVIEWER_SPOKEN_TEMPLATE,
  ASSESSMENT_SPOKEN_RUBRIC,
} from "@/lib/interview/prompts";
import { PLAYBOOKS } from "@/lib/interview/playbooks";
import {
  SCORECARD_CLASSIFY_PROMPT,
  SCORECARD_DIGEST_PROMPT,
  SCORECARD_INTERVIEW_PROMPT,
  SCORECARD_MEETING_PROMPT,
} from "@/lib/scorecard/prompts";

export interface PromptDef {
  key: string;
  /** Grouping for the admin UI. */
  category: string;
  label: string;
  /** Where this prompt is used in the product (shown in admin). */
  usedIn: string;
  /** Code default — offline fallback + seed. */
  default: string;
}

const quickActionDefs: PromptDef[] = DEFAULT_QUICK_ACTIONS.map((label) => ({
  key: `quick_action.${quickActionKey(label)}`,
  category: "Live copilot",
  label: `Quick action: “${label}”`,
  usedIn: "Overlay quick-action buttons (Chat with data / copilot)",
  default: QUICK_ACTION_PROMPTS[label] ?? label,
}));

export const PROMPT_DEFS: PromptDef[] = [
  // ── Live copilot ──────────────────────────────────────────────────────────
  {
    key: "copilot.base",
    category: "Live copilot",
    label: "Copilot base system prompt",
    usedIn: "Live overlay copilot (buildCopilotSystemPrompt), the core behavior for “Suggested reply”.",
    default: DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: "copilot.triage",
    category: "Live copilot",
    label: "Copilot triage (when to speak vs stay quiet)",
    usedIn:
      "Appended LAST to both copilot prompts for captured-speech turns. Defines the [ANSWER]/[NOTE]/[ASK]/[SKIP] contract parsed by src/lib/live/triage.ts. This is what stops the copilot replying to every utterance. Not used for “Answer now”, quick actions, or typed questions (those always answer). Keep the four tags and their exact spelling.",
    default: COPILOT_TRIAGE_PROMPT,
  },
  {
    key: "copilot.generic_guidance",
    category: "Live copilot",
    label: "Copilot generic guidance (no persona)",
    usedIn: "Live copilot when no persona/scenario is selected.",
    default: GENERIC_COPILOT_GUIDANCE,
  },
  {
    key: "copilot.interview_base",
    category: "Live copilot",
    label: "Interview copilot base",
    usedIn: "Live copilot in interview mode (buildInterviewSystemPrompt).",
    default: INTERVIEW_COPILOT_PROMPT,
  },
  {
    key: "copilot.interview_length_auto",
    category: "Live copilot",
    label: "Interview copilot length: auto",
    usedIn: "Interview copilot when response length = auto (default).",
    default: INTERVIEW_LENGTH_AUTO,
  },
  {
    key: "copilot.interview_length_medium",
    category: "Live copilot",
    label: "Interview copilot length: medium",
    usedIn: "Interview copilot when response length = medium.",
    default: INTERVIEW_LENGTH_MEDIUM,
  },
  {
    key: "copilot.interview_length_short",
    category: "Live copilot",
    label: "Interview copilot length: short",
    usedIn: "Interview copilot when response length = short.",
    default: INTERVIEW_LENGTH_SHORT,
  },
  ...quickActionDefs,

  // ── Chat with data ─────────────────────────────────────────────────────────
  {
    key: "chat.analysis",
    category: "Chat with data",
    label: "Transcript analysis system prompt",
    usedIn: "“Chat with data” panel + chat completions (analyzes the transcript, answers questions).",
    default: CHAT_ANALYSIS_SYSTEM_PROMPT,
  },
  {
    key: "format.markdown",
    category: "Chat with data",
    label: "Markdown formatting instructions",
    usedIn: "Appended to AI responses (ai-response.function) to enforce formatting/diagrams.",
    default: MARKDOWN_FORMATTING_INSTRUCTIONS,
  },

  // ── Interview practice ──────────────────────────────────────────────────────
  {
    key: "interview.interviewer_spoken",
    category: "Interview practice",
    label: "Interviewer: spoken interview (asks the questions)",
    usedIn:
      "The live AI interviewer for behavioral / role-fit practice (buildInterviewerSystemPrompt). This is what generates each question. Setup values are injected: {roleLevel}, {focus}, {difficulty}, {questionCount}, {notes}, {customBlock} — keep those tokens. Coding & system-design rounds branch in code and are not edited here.",
    default: INTERVIEWER_SPOKEN_TEMPLATE,
  },
  {
    key: "interview.assessment_scoring",
    category: "Interview practice",
    label: "Assessment: spoken scoring rubric (1–5 anchors)",
    usedIn:
      "The 4-dimension rubric + score anchors used when grading a spoken practice interview (buildAssessmentPrompt). {roleLevel} and {difficulty} are injected. The JSON shape and model-answer rules live in their own keys.",
    default: ASSESSMENT_SPOKEN_RUBRIC,
  },
  {
    key: "interview.model_answer_rules",
    category: "Interview practice",
    label: "Model-answer format rules",
    usedIn: "Interview assessment (coding/behavioral/technical model answers).",
    default: MODEL_ANSWER_FORMAT_RULES,
  },
  {
    key: "interview.model_answer_system_design",
    category: "Interview practice",
    label: "System-design solution format",
    usedIn: "System-design grading + assessment model answers (design-eval, assessment).",
    default: SYSTEM_DESIGN_SOLUTION_FORMAT,
  },

  // ── Coaching playbooks (grounding) ─────────────────────────────────────────
  {
    key: "playbook.system_design",
    category: "Coaching playbooks",
    label: "Playbook: System design",
    usedIn: "Grounds system-design hints/grading/model answers (references.ts).",
    default: PLAYBOOKS.system_design.guidance,
  },
  {
    key: "playbook.coding",
    category: "Coaching playbooks",
    label: "Playbook: Coding",
    usedIn: "Grounds coding hints/grading/model answers.",
    default: PLAYBOOKS.coding.guidance,
  },
  {
    key: "playbook.behavioral",
    category: "Coaching playbooks",
    label: "Playbook: Behavioral",
    usedIn: "Grounds behavioral hints/grading/model answers.",
    default: PLAYBOOKS.behavioral.guidance,
  },
  {
    key: "playbook.technical",
    category: "Coaching playbooks",
    label: "Playbook: Technical",
    usedIn: "Grounds technical Q&A coaching.",
    default: PLAYBOOKS.technical.guidance,
  },
  {
    key: "playbook.engineering_manager",
    category: "Coaching playbooks",
    label: "Playbook: Engineering manager",
    usedIn: "Grounds EM coaching + the EM lens overlay.",
    default: PLAYBOOKS.engineering_manager.guidance,
  },
  {
    key: "playbook.product",
    category: "Coaching playbooks",
    label: "Playbook: Product (PM)",
    usedIn: "Grounds product-management coaching.",
    default: PLAYBOOKS.product.guidance,
  },
  {
    key: "playbook.consulting_case",
    category: "Coaching playbooks",
    label: "Playbook: Consulting case",
    usedIn: "Grounds consulting case coaching + the consulting lens overlay.",
    default: PLAYBOOKS.consulting_case.guidance,
  },
  {
    key: "playbook.finance",
    category: "Coaching playbooks",
    label: "Playbook: Finance & banking",
    usedIn: "Grounds finance/IB coaching + the finance lens overlay.",
    default: PLAYBOOKS.finance.guidance,
  },
  {
    key: "playbook.data_science",
    category: "Coaching playbooks",
    label: "Playbook: Data science",
    usedIn: "Grounds data-science coaching + the data-science lens overlay.",
    default: PLAYBOOKS.data_science.guidance,
  },
  {
    key: "playbook.general",
    category: "Coaching playbooks",
    label: "Playbook: General",
    usedIn: "Fallback coaching playbook.",
    default: PLAYBOOKS.general.guidance,
  },

  // NOTE: the nine `tutorial.*.walkthrough` prompts used to live here. They fed
  // the guided curriculum, which is a hosted-app feature and no longer part of
  // this edition, so both the prompts and the course content are gone.

  // ── Scorecards (post-conversation review) ───────────────────────────────────
  {
    key: "scorecard.classify",
    category: "Scorecards",
    label: "Scorecard: interview vs meeting classifier",
    usedIn: "Recaps > conversation view, before grading (skipped for Interview Practice sessions, which are detected by id).",
    default: SCORECARD_CLASSIFY_PROMPT,
  },
  {
    key: "scorecard.interview",
    category: "Scorecards",
    label: "Scorecard: interview review (scores + feedback)",
    usedIn: "Recaps > conversation view, when the conversation is an interview.",
    default: SCORECARD_INTERVIEW_PROMPT,
  },
  {
    key: "scorecard.meeting",
    category: "Scorecards",
    label: "Scorecard: meeting summary + key points",
    usedIn: "Recaps > conversation view, when the conversation is a meeting or call.",
    default: SCORECARD_MEETING_PROMPT,
  },
  {
    key: "scorecard.digest",
    category: "Scorecards",
    label: "Scorecard: long-conversation section notes",
    usedIn: "Recaps > conversation view, only for conversations too long to grade in one call: each section is digested with this, then the notes are graded by the interview/meeting prompt above.",
    default: SCORECARD_DIGEST_PROMPT,
  },
];

export const PROMPT_DEF_BY_KEY: Record<string, PromptDef> = Object.fromEntries(
  PROMPT_DEFS.map((d) => [d.key, d])
);
