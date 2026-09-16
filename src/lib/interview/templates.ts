import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import type { TtsVoice } from "@/lib/tts";
import type { CodingLanguage } from "./coding-runtime";

export type InterviewDifficulty = "easy" | "medium" | "hard";

/** Filterable interview categories shown in the setup UI. */
export const INTERVIEW_CATEGORIES = [
  { id: "engineering", label: "Engineering" },
  { id: "executive", label: "Executive" },
  { id: "product", label: "Product management" },
  { id: "marketing", label: "Marketing" },
  { id: "finance", label: "Finance" },
  { id: "customer_success", label: "Customer Success" },
  { id: "general", label: "General" },
] as const;

export type InterviewCategoryId = (typeof INTERVIEW_CATEGORIES)[number]["id"];

/** Session style. Interview practice only (kept as a field for stored data). */
export type InterviewMode = "job_interview";

export function normalizeInterviewMode(
  _mode?: string | null | undefined
): InterviewMode {
  return "job_interview";
}

const CATEGORY_IDS = new Set<string>(INTERVIEW_CATEGORIES.map((c) => c.id));

export function normalizeInterviewCategory(
  category: string | null | undefined
): InterviewCategoryId {
  if (category && CATEGORY_IDS.has(category)) {
    return category as InterviewCategoryId;
  }
  return "general";
}

export function getInterviewCategoryLabel(category: string): string {
  const id = normalizeInterviewCategory(category);
  return INTERVIEW_CATEGORIES.find((c) => c.id === id)?.label ?? "General";
}

/** The three interviewer voices offered in Interview Practice. */
export const INTERVIEW_VOICES = [
  {
    id: "nova" as const,
    label: "Becky",
    description: "Clear, professional female interviewer",
  },
  {
    id: "echo" as const,
    label: "John",
    description: "Warm male interviewer",
  },
  {
    id: "onyx" as const,
    label: "Brian",
    description: "Deep, resonant interviewer",
  },
] as const;

export type InterviewVoiceId = (typeof INTERVIEW_VOICES)[number]["id"];

const INTERVIEW_VOICE_IDS = new Set<string>(
  INTERVIEW_VOICES.map((v) => v.id)
);

/** Map any stored/legacy voice onto one of the three interview options. */
export function normalizeInterviewVoice(
  voice: string | null | undefined
): InterviewVoiceId {
  if (voice && INTERVIEW_VOICE_IDS.has(voice)) {
    return voice as InterviewVoiceId;
  }
  switch (voice) {
    case "shimmer":
    case "coral":
    case "sage":
    case "alloy":
      return "nova";
    case "fable":
    case "ash":
    case "verse":
    case "ballad":
      return "echo";
    case "onyx":
      return "onyx";
    default:
      return "nova";
  }
}

export function getInterviewVoiceLabel(voice: string): string {
  const id = normalizeInterviewVoice(voice);
  return INTERVIEW_VOICES.find((v) => v.id === id)?.label ?? "Becky";
}

/** How the candidate answers during practice. */
export type InterviewAnswerMode = "spoken" | "coding" | "system_design";

export interface InterviewTemplate {
  id: string;
  title: string;
  /** Filter category, e.g. engineering / product / executive. */
  category: InterviewCategoryId;
  /** Session style. Always "job_interview"; kept for stored-data compatibility. */
  mode: InterviewMode;
  /** Role / level the interviewer is hiring for, e.g. "Engineering Manager". */
  roleLevel: string;
  /** Topics the interviewer should probe, e.g. ["leadership", "system design"]. */
  focusAreas: string[];
  difficulty: InterviewDifficulty;
  /** Interviewer TTS voice (one of INTERVIEW_VOICES). */
  voice: InterviewVoiceId;
  /** Free-form notes the user wants the interviewer to keep in mind. */
  notes: string;
  /** Deprecated: retained only for stored-data compatibility. Always empty. */
  productContext: string;
  /**
   * Practice questions (max 10). Asked in order. When empty, the AI generates
   * a short session (see getEffectiveQuestionCount).
   */
  customQuestions: string[];
  /**
   * Optional model answers aligned 1:1 with `customQuestions` (e.g. from the
   * company question bank). Used on the system-design Tips tab so candidates
   * can step through a guide without submitting to AI first.
   */
  customModelAnswers?: string[];
  /**
   * Optional per-question answer categories aligned 1:1 with `customQuestions`
   * ("behavioral" | "technical" | "coding" | "system_design"). Drives which
   * answer workbench each prepared question uses during practice, so a mixed
   * interview can ask a behavioral question then a coding one.
   */
  customQuestionCategories?: string[];
  /**
   * Optional bank question ids aligned 1:1 with `customQuestions` when this
   * session was built from the company/role question bank.
   */
  bankQuestionIds?: string[];
  /**
   * spoken = voice/text (default).
   * coding = in-app JS editor + run + AI pass/fail.
   * system_design = problem + Excalidraw canvas + AI pass/fail.
   */
  answerMode: InterviewAnswerMode;
  /**
   * Which editor a coding round opens in, when the round itself knows. A SQL
   * round is a SQL round even when the interviewer improvises a question that
   * never says the word "SQL", and guessing from the question text can't know
   * that. Unset = infer from each question (`defaultCodingLanguage`).
   */
  codingLanguage?: CodingLanguage;
  /** True for the curated built-ins; false for user-created templates. */
  builtIn: boolean;
}

/** True when this practice session uses the coding workbench. */
export function isCodingInterview(
  template: Pick<InterviewTemplate, "answerMode" | "focusAreas" | "title">
): boolean {
  if (template.answerMode === "coding") return true;
  if (template.answerMode === "system_design") return false;
  const focus = (template.focusAreas ?? []).join(" ").toLowerCase();
  return (
    focus.includes("coding") ||
    /\bcoding\b/i.test(template.title || "")
  );
}

/** True when this practice session uses the system-design canvas. */
export function isSystemDesignInterview(
  template: Pick<InterviewTemplate, "answerMode" | "focusAreas" | "title">
): boolean {
  if (template.answerMode === "system_design") return true;
  const focus = (template.focusAreas ?? []).join(" ").toLowerCase();
  const title = template.title || "";
  return (
    focus.includes("system design") ||
    focus.includes("system_design") ||
    /system\s*design/i.test(title)
  );
}

export type InterviewTemplateInput = Omit<InterviewTemplate, "id" | "builtIn"> & {
  id?: string;
};

type BuiltinSeed = Omit<
  InterviewTemplate,
  | "builtIn"
  | "voice"
  | "customQuestions"
  | "mode"
  | "productContext"
  | "answerMode"
> & {
  voice?: InterviewVoiceId;
  customQuestions?: string[];
  mode?: InterviewMode;
  productContext?: string;
  answerMode?: InterviewAnswerMode;
};

function builtin(seed: BuiltinSeed): InterviewTemplate {
  return {
    ...seed,
    mode: "job_interview",
    productContext: seed.productContext ?? "",
    customQuestions: seed.customQuestions ?? [],
    voice: seed.voice ?? "nova",
    answerMode: seed.answerMode ?? "spoken",
    builtIn: true,
  };
}

export const BUILT_IN_TEMPLATES: InterviewTemplate[] = [
  // —— Engineering ——
  builtin({
    id: "builtin-engineering-manager",
    category: "engineering",
    title: "Engineering Manager",
    roleLevel: "Engineering Manager",
    focusAreas: [
      "leadership",
      "people management",
      "prioritization",
      "conflict resolution",
      "delivery & execution",
    ],
    difficulty: "medium",
    voice: "onyx",
    notes:
      "Probe how the candidate leads teams, coaches ICs, and balances delivery with people health.",
  }),
  builtin({
    id: "builtin-senior-staff-engineer",
    category: "engineering",
    title: "Senior / Staff Engineer",
    roleLevel: "Senior / Staff Software Engineer",
    focusAreas: [
      "system design",
      "technical depth",
      "cross-team influence",
      "mentorship",
      "trade-off reasoning",
    ],
    difficulty: "hard",
    voice: "echo",
    notes:
      "Ask architecture and design questions, then dig into past impact and technical leadership.",
  }),
  builtin({
    id: "builtin-frontend-engineer",
    category: "engineering",
    title: "Frontend Engineer",
    roleLevel: "Frontend / UI Engineer",
    focusAreas: [
      "React & component architecture",
      "performance",
      "accessibility",
      "design collaboration",
      "testing",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Mix UI craft, product sense for interfaces, and how they ship polished user experiences.",
  }),
  builtin({
    id: "builtin-backend-engineer",
    category: "engineering",
    title: "Backend Engineer",
    roleLevel: "Backend / Platform Engineer",
    focusAreas: [
      "APIs & data modeling",
      "scalability",
      "reliability",
      "debugging production issues",
      "security basics",
    ],
    difficulty: "medium",
    voice: "echo",
    notes:
      "Probe service design, failure modes, and how they reason about latency and correctness.",
  }),

  // —— Executive ——
  builtin({
    id: "builtin-ceo-founder",
    category: "executive",
    title: "CEO / Founder",
    roleLevel: "CEO / Founder",
    focusAreas: [
      "vision & strategy",
      "fundraising narrative",
      "hiring leaders",
      "board management",
      "culture",
    ],
    difficulty: "hard",
    voice: "onyx",
    notes:
      "Probe judgment under ambiguity, how they set priorities, and stories of hard calls.",
  }),
  builtin({
    id: "builtin-cto",
    category: "executive",
    title: "CTO / VP Engineering",
    roleLevel: "CTO / VP of Engineering",
    focusAreas: [
      "org design",
      "technical strategy",
      "scaling teams",
      "vendor & build-vs-buy",
      "executive communication",
    ],
    difficulty: "hard",
    voice: "echo",
    notes:
      "Focus on how they balance product speed with platform health and lead other leaders.",
  }),
  builtin({
    id: "builtin-coo",
    category: "executive",
    title: "COO / Operations Lead",
    roleLevel: "COO / Head of Operations",
    focusAreas: [
      "process design",
      "cross-functional alignment",
      "OKRs & metrics",
      "scaling operations",
      "crisis management",
    ],
    difficulty: "hard",
    voice: "nova",
    notes:
      "Ask how they turn strategy into operating rhythm and fix broken handoffs between teams.",
  }),

  // —— Product ——
  builtin({
    id: "builtin-product-manager",
    category: "product",
    title: "Product Manager",
    roleLevel: "Product Manager",
    focusAreas: [
      "product sense",
      "prioritization",
      "stakeholder management",
      "metrics & outcomes",
      "customer discovery",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Mix product sense, prioritization frameworks, and cross-functional collaboration stories.",
  }),
  builtin({
    id: "builtin-senior-pm",
    category: "product",
    title: "Senior / Group PM",
    roleLevel: "Senior / Group Product Manager",
    focusAreas: [
      "strategy & roadmap",
      "leading PMs",
      "platform thinking",
      "executive storytelling",
      "trade-offs at scale",
    ],
    difficulty: "hard",
    voice: "echo",
    notes:
      "Probe how they set product vision, influence without authority, and measure portfolio impact.",
  }),
  builtin({
    id: "builtin-product-designer",
    category: "product",
    title: "Product Designer",
    roleLevel: "Product Designer / UX Designer",
    focusAreas: [
      "user research",
      "interaction design",
      "design systems",
      "collaboration with eng & PM",
      "measuring design quality",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Walk through a portfolio case: problem framing, iteration, and how they handled constraints.",
  }),

  // —— Marketing ——
  builtin({
    id: "builtin-growth-marketer",
    category: "marketing",
    title: "Growth Marketer",
    roleLevel: "Growth / Performance Marketer",
    focusAreas: [
      "experimentation",
      "acquisition channels",
      "funnel metrics",
      "creative testing",
      "attribution",
    ],
    difficulty: "medium",
    voice: "echo",
    notes:
      "Ask for concrete experiments, what they learned when CAC rose, and how they prioritize bets.",
  }),
  builtin({
    id: "builtin-content-marketer",
    category: "marketing",
    title: "Content Marketer",
    roleLevel: "Content Marketing Manager",
    focusAreas: [
      "editorial strategy",
      "SEO",
      "brand voice",
      "distribution",
      "measuring content ROI",
    ],
    difficulty: "easy",
    voice: "nova",
    notes:
      "Probe how they pick topics, work with subject-matter experts, and tie content to pipeline.",
  }),
  builtin({
    id: "builtin-brand-marketing",
    category: "marketing",
    title: "Brand / Product Marketing",
    roleLevel: "Brand or Product Marketing Manager",
    focusAreas: [
      "positioning & messaging",
      "launches",
      "competitive intel",
      "go-to-market enablement",
      "narrative craft",
    ],
    difficulty: "medium",
    voice: "onyx",
    notes:
      "Dig into a launch they owned and how messaging shifted based on customer feedback.",
  }),

  // —— Finance ——
  builtin({
    id: "builtin-financial-analyst",
    category: "finance",
    title: "Financial Analyst",
    roleLevel: "Financial Analyst",
    focusAreas: [
      "modeling & forecasting",
      "variance analysis",
      "stakeholder communication",
      "data accuracy",
      "business partnering",
    ],
    difficulty: "medium",
    voice: "echo",
    notes:
      "Ask how they built a model under incomplete data and how they presented findings to leaders.",
  }),
  builtin({
    id: "builtin-fpna",
    category: "finance",
    title: "FP&A Manager",
    roleLevel: "FP&A Manager",
    focusAreas: [
      "budgeting & planning",
      "scenario analysis",
      "cross-functional influence",
      "KPI design",
      "board materials",
    ],
    difficulty: "hard",
    voice: "onyx",
    notes:
      "Probe planning cycles, hard trade-offs they recommended, and how they handle contested numbers.",
  }),
  builtin({
    id: "builtin-controller",
    category: "finance",
    title: "Controller / Accounting",
    roleLevel: "Controller / Senior Accountant",
    focusAreas: [
      "close process",
      "controls & compliance",
      "systems & automation",
      "audit readiness",
      "team leadership",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Focus on process rigor, how they caught or prevented errors, and improving the monthly close.",
  }),

  // —— Customer Success ——
  builtin({
    id: "builtin-customer-success-manager",
    category: "customer_success",
    title: "Customer Success Manager",
    roleLevel: "Customer Success Manager",
    focusAreas: [
      "retention & expansion",
      "onboarding",
      "health scores",
      "executive sponsorship",
      "escalation handling",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Ask about saving an at-risk account and how they drive adoption without being pushy.",
  }),
  builtin({
    id: "builtin-support-lead",
    category: "customer_success",
    title: "Support Lead",
    roleLevel: "Support Team Lead / Manager",
    focusAreas: [
      "ticket quality & SLAs",
      "coaching agents",
      "process improvement",
      "product feedback loops",
      "de-escalation",
    ],
    difficulty: "medium",
    voice: "echo",
    notes:
      "Probe how they balance speed vs quality and turn support insights into product change.",
  }),
  builtin({
    id: "builtin-solutions-consultant",
    category: "customer_success",
    title: "Solutions Consultant",
    roleLevel: "Solutions Consultant / Solutions Engineer",
    focusAreas: [
      "discovery demos",
      "technical objection handling",
      "POC design",
      "cross-functional partnering",
      "translating requirements",
    ],
    difficulty: "medium",
    voice: "onyx",
    notes:
      "Walk through a complex POC: scoping, risks, and how they influenced the customer's decision.",
  }),

  // —— General ——
  builtin({
    id: "builtin-general-behavioral",
    category: "general",
    title: "General Behavioral",
    roleLevel: "General role (behavioral focus)",
    focusAreas: [
      "teamwork",
      "ownership",
      "communication",
      "resilience",
      "learning from failure",
    ],
    difficulty: "easy",
    voice: "echo",
    notes:
      "Classic behavioral interview using STAR. Adapt questions to the candidate's background.",
  }),
  builtin({
    id: "builtin-career-switcher",
    category: "general",
    title: "Career Switcher",
    roleLevel: "Candidate changing industries or functions",
    focusAreas: [
      "transferable skills",
      "motivation for the switch",
      "learning agility",
      "gaps & honesty",
      "early impact plan",
    ],
    difficulty: "medium",
    voice: "nova",
    notes:
      "Be encouraging but rigorous; test whether they can map past wins onto this new role.",
  }),
  builtin({
    id: "builtin-internship",
    category: "general",
    title: "Internship / Early Career",
    roleLevel: "Intern or junior hire",
    focusAreas: [
      "curiosity & learning",
      "collaboration",
      "ownership on small projects",
      "communication",
      "handling feedback",
    ],
    difficulty: "easy",
    voice: "echo",
    notes:
      "Keep questions accessible. Look for hunger to learn, not years of experience.",
  }),
];

function normalizeDifficulty(d: unknown): InterviewDifficulty {
  return d === "easy" || d === "medium" || d === "hard" ? d : "medium";
}

/** Editable fields users can tweak on any interview type (including built-ins). */
export type InterviewTemplateSettingsPatch = {
  voice?: InterviewVoiceId;
  difficulty?: InterviewDifficulty;
  focusAreas?: string[];
  notes?: string;
  productContext?: string;
  customQuestions?: string[];
  customQuestionCategories?: string[];
};

function readTemplateOverrides(): Record<string, InterviewTemplateSettingsPatch> {
  try {
    // Prefer the richer overrides store.
    const raw = safeLocalStorage.getItem(
      STORAGE_KEYS.INTERVIEW_TEMPLATE_OVERRIDES
    );
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, InterviewTemplateSettingsPatch> = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        out[id] = normalizeSettingsPatch(value as InterviewTemplateSettingsPatch);
      }
      return out;
    }

    // Migrate legacy voice-only overrides.
    const legacy = safeLocalStorage.getItem(STORAGE_KEYS.INTERVIEW_VOICE_OVERRIDES);
    if (!legacy) return {};
    const parsed = JSON.parse(legacy);
    if (!parsed || typeof parsed !== "object") return {};
    const migrated: Record<string, InterviewTemplateSettingsPatch> = {};
    for (const [id, voice] of Object.entries(parsed)) {
      migrated[id] = { voice: normalizeInterviewVoice(String(voice)) };
    }
    writeTemplateOverrides(migrated);
    return migrated;
  } catch {
    return {};
  }
}

function normalizeSettingsPatch(
  patch: InterviewTemplateSettingsPatch
): InterviewTemplateSettingsPatch {
  const next: InterviewTemplateSettingsPatch = {};
  if (patch.voice != null) next.voice = normalizeInterviewVoice(patch.voice);
  if (patch.difficulty != null) next.difficulty = normalizeDifficulty(patch.difficulty);
  if (Array.isArray(patch.focusAreas)) {
    next.focusAreas = patch.focusAreas.map((a) => String(a).trim()).filter(Boolean);
  }
  if (typeof patch.notes === "string") next.notes = patch.notes;
  if (typeof patch.productContext === "string") {
    next.productContext = patch.productContext;
  }
  if (Array.isArray(patch.customQuestions)) {
    next.customQuestions = patch.customQuestions
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  if (Array.isArray(patch.customQuestionCategories)) {
    next.customQuestionCategories = patch.customQuestionCategories
      .slice(0, 20)
      .map((c) => normalizeQuestionCategory(c));
  }
  return next;
}

function writeTemplateOverrides(
  map: Record<string, InterviewTemplateSettingsPatch>
): void {
  // Synced across devices + the web app (see src/lib/sync/kv.ts).
  setSyncedItem(
    STORAGE_KEYS.INTERVIEW_TEMPLATE_OVERRIDES,
    JSON.stringify(map)
  );
}

function readCustom(): InterviewTemplate[] {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.INTERVIEW_TEMPLATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t === "object" && typeof t.id === "string")
      .map((t) => normalizeTemplate({ ...t, builtIn: false }));
  } catch {
    return [];
  }
}

function writeCustom(templates: InterviewTemplate[]): void {
  const customOnly = templates.filter((t) => !t.builtIn);
  // Synced across devices + the web app (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.INTERVIEW_TEMPLATES, JSON.stringify(customOnly));
}

function normalizeTemplate(
  input: Partial<InterviewTemplate> & { id: string }
): InterviewTemplate {
  const focusAreas = Array.isArray(input.focusAreas)
    ? input.focusAreas.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const customQuestions = Array.isArray(input.customQuestions)
    ? input.customQuestions
        .map((q) => String(q).trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const customModelAnswers = Array.isArray(input.customModelAnswers)
    ? input.customModelAnswers
        .slice(0, 10)
        .map((a) => String(a ?? "").trim())
    : [];
  const customQuestionCategories = Array.isArray(input.customQuestionCategories)
    ? input.customQuestionCategories
        .slice(0, customQuestions.length)
        .map((c) => normalizeQuestionCategory(c))
    : [];
  const category = normalizeInterviewCategory(input.category);
  const mode: InterviewMode = "job_interview";
  // Respect an explicit answerMode (incl. "spoken" for mixed interviews); only
  // fall back to the focus-area heuristic when none was provided.
  const answerMode: InterviewAnswerMode =
    input.answerMode === "spoken" ||
    input.answerMode === "coding" ||
    input.answerMode === "system_design"
      ? input.answerMode
      : focusAreas.some((a) => /system[_\s-]?design/i.test(a))
        ? "system_design"
        : focusAreas.some((a) => /coding/i.test(a))
          ? "coding"
          : "spoken";

  return {
    id: input.id,
    title: (input.title || "Untitled interview").trim() || "Untitled interview",
    category,
    mode,
    roleLevel: (input.roleLevel || "General role").trim() || "General role",
    focusAreas,
    difficulty: normalizeDifficulty(input.difficulty),
    voice: normalizeInterviewVoice(input.voice as TtsVoice | string),
    notes: (input.notes || "").trim(),
    productContext: (input.productContext || "").trim(),
    customQuestions,
    ...(customModelAnswers.some(Boolean)
      ? { customModelAnswers }
      : {}),
    ...(customQuestionCategories.length
      ? { customQuestionCategories }
      : {}),
    answerMode,
    builtIn: !!input.builtIn,
  };
}

const QUESTION_CATEGORIES = [
  "behavioral",
  "technical",
  "coding",
  "system_design",
] as const;

/** Coerce any value into a valid question category (defaults to behavioral). */
export function normalizeQuestionCategory(c: unknown): string {
  const s = String(c || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (QUESTION_CATEGORIES as readonly string[]).includes(s)
    ? s
    : "behavioral";
}

function applyOverrides(template: InterviewTemplate): InterviewTemplate {
  const patch = readTemplateOverrides()[template.id];
  if (!patch) return template;
  return {
    ...template,
    ...(patch.voice != null ? { voice: patch.voice } : {}),
    ...(patch.difficulty != null ? { difficulty: patch.difficulty } : {}),
    ...(patch.focusAreas != null ? { focusAreas: patch.focusAreas } : {}),
    ...(patch.notes != null ? { notes: patch.notes } : {}),
    ...(patch.productContext != null
      ? { productContext: patch.productContext }
      : {}),
    ...(patch.customQuestions != null
      ? { customQuestions: patch.customQuestions }
      : {}),
    ...(patch.customQuestionCategories != null
      ? { customQuestionCategories: patch.customQuestionCategories }
      : {}),
  };
}

/** Built-ins + user-created custom templates (with overrides applied). */
export function listInterviewTemplates(): InterviewTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...readCustom()].map(applyOverrides);
}

export function getInterviewTemplate(id: string): InterviewTemplate | null {
  return listInterviewTemplates().find((t) => t.id === id) ?? null;
}

/**
 * Update editable settings on a template. Custom templates are patched in
 * storage; built-ins store an override so the pick sticks across sessions.
 */
export function updateInterviewTemplateSettings(
  templateId: string,
  patch: InterviewTemplateSettingsPatch
): InterviewTemplate | null {
  const normalized = normalizeSettingsPatch(patch);
  if (Object.keys(normalized).length === 0) {
    return getInterviewTemplate(templateId);
  }

  if (templateId.startsWith("builtin-")) {
    const overrides = readTemplateOverrides();
    overrides[templateId] = {
      ...overrides[templateId],
      ...normalized,
    };
    writeTemplateOverrides(overrides);
    return getInterviewTemplate(templateId);
  }

  const custom = readCustom();
  const idx = custom.findIndex((t) => t.id === templateId);
  if (idx < 0) return null;
  custom[idx] = normalizeTemplate({
    ...custom[idx],
    ...normalized,
    id: templateId,
    builtIn: false,
  });
  writeCustom(custom);
  return applyOverrides(custom[idx]);
}

/**
 * Change the interviewer voice for a template.
 */
export function setInterviewTemplateVoice(
  templateId: string,
  voice: InterviewVoiceId
): InterviewTemplate | null {
  return updateInterviewTemplateSettings(templateId, { voice });
}

export function saveInterviewTemplate(
  input: InterviewTemplateInput
): InterviewTemplate {
  const custom = readCustom();
  const id =
    input.id && !input.id.startsWith("builtin-")
      ? input.id
      : `custom-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 7)}`;

  const next = normalizeTemplate({
    ...input,
    id,
    category: normalizeInterviewCategory(input.category),
    voice: normalizeInterviewVoice(input.voice),
    builtIn: false,
  });

  const idx = custom.findIndex((t) => t.id === id);
  if (idx >= 0) custom[idx] = next;
  else custom.push(next);

  writeCustom(custom);
  return next;
}

export function deleteInterviewTemplate(id: string): boolean {
  if (id.startsWith("builtin-")) return false;
  const custom = readCustom();
  const next = custom.filter((t) => t.id !== id);
  if (next.length === custom.length) return false;
  writeCustom(next);

  const overrides = readTemplateOverrides();
  if (overrides[id]) {
    delete overrides[id];
    writeTemplateOverrides(overrides);
  }
  return true;
}

/** Empty form defaults for the "Create your own" editor. */
export function blankInterviewTemplate(): InterviewTemplateInput {
  return {
    title: "",
    category: "general",
    mode: "job_interview",
    roleLevel: "",
    focusAreas: [],
    difficulty: "medium",
    voice: "nova",
    notes: "",
    productContext: "",
    customQuestions: [],
    customModelAnswers: [],
    answerMode: "spoken",
  };
}

/** Default session length when no prepared questions are set (AI-generated). */
export const DEFAULT_AI_QUESTION_COUNT = 5;

/** Session length = prepared questions, or a short AI-generated set if none. */
export function getEffectiveQuestionCount(template: InterviewTemplate): number {
  const prepared = (template.customQuestions ?? []).filter(Boolean).length;
  if (prepared > 0) return Math.min(20, prepared);
  return DEFAULT_AI_QUESTION_COUNT;
}

/** Page size for the interview type picker. */
export const INTERVIEW_PAGE_SIZE = 9;
