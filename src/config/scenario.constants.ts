// Conversation scenarios. Each new conversation is auto-classified from its
// transcript, and the matching addendum is appended to the system prompt so the
// assistant tailors its help to the situation (interview, support, meeting, ...).

export type ScenarioKey =
  | "interview_candidate"
  | "interview_interviewer"
  | "support"
  | "negotiation"
  | "meeting"
  | "lecture"
  | "casual"
  | "generic";

export const SCENARIO_PROMPTS: Record<
  ScenarioKey,
  { label: string; prompt: string }
> = {
  interview_candidate: {
    label: "Interview (you)",
    prompt:
      "SCENARIO: This is a job interview and you are helping the candidate (the user). Give crisp, confident answers they can say out loud, highlight relevant experience with concrete impact, and suggest one sharp question to ask.",
  },
  interview_interviewer: {
    label: "Interview (hiring)",
    prompt:
      "SCENARIO: This is a job interview and you are helping the interviewer (the user). Suggest strong probing follow-ups, signals to evaluate, and gaps worth digging into.",
  },
  support: {
    label: "Support",
    prompt:
      "SCENARIO: This is a customer support conversation and you are helping the agent. Surface likely root causes, the clearest next troubleshooting step, and calm, empathetic phrasing.",
  },
  negotiation: {
    label: "Negotiation",
    prompt:
      "SCENARIO: This is a negotiation. Surface leverage points, concrete counter-offers, and concessions to avoid, keeping the user's position strong.",
  },
  meeting: {
    label: "Meeting",
    prompt:
      "SCENARIO: This is a work meeting. Surface decisions, action items, risks, and the most useful point the user should make next.",
  },
  lecture: {
    label: "Lecture / talk",
    prompt:
      "SCENARIO: This is a lecture or presentation the user is listening to. Surface key points, definitions, and clarifying questions worth asking.",
  },
  casual: {
    label: "Casual chat",
    prompt:
      "SCENARIO: This is a casual conversation. Keep help light, relevant, and brief.",
  },
  generic: {
    label: "Conversation",
    prompt: "",
  },
};

export const SCENARIO_KEYS = Object.keys(SCENARIO_PROMPTS) as ScenarioKey[];

/** Map a free-form model classification to a known scenario key. */
export function normalizeScenario(raw: string): ScenarioKey {
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (SCENARIO_KEYS as string[]).includes(k)
    ? (k as ScenarioKey)
    : "generic";
}
