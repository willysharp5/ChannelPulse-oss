import { SAMPLE_SYSTEM_PROMPTS } from "@/config/sample-prompts";
import { SCENARIO_PROMPTS, type ScenarioKey } from "@/config/scenario.constants";

/** Map curated persona template ids → live scenario. */
const PERSONA_ID_TO_SCENARIO: Record<string, ScenarioKey> = {
  "coding-interview": "interview_candidate",
  "job-interview": "interview_candidate",
  "meeting-assistant": "meeting",
  "customer-support": "support",
  negotiation: "negotiation",
};

/**
 * Infer a live scenario from the currently selected persona prompt text.
 * Exact template matches first; then light heuristics for custom personas.
 */
export function inferScenarioFromPersona(prompt?: string | null): ScenarioKey | null {
  const p = (prompt ?? "").trim();
  if (!p) return null;

  const sample = SAMPLE_SYSTEM_PROMPTS.find((s) => s.prompt.trim() === p);
  if (sample) {
    return PERSONA_ID_TO_SCENARIO[sample.id] ?? null;
  }

  const lower = p.toLowerCase();
  if (
    lower.includes("coding interview") ||
    lower.includes("job interview") ||
    lower.includes("interview coach") ||
    lower.includes("technical interview")
  ) {
    return "interview_candidate";
  }
  if (lower.includes("negotiat")) return "negotiation";
  if (lower.includes("customer support") || lower.includes("support assistant")) {
    return "support";
  }
  if (lower.includes("meeting assistant") || lower.includes("action items")) {
    return "meeting";
  }
  if (lower.includes("lecture") || lower.includes("presentation")) {
    return "lecture";
  }
  return null;
}

/**
 * Resolve which scenario drives the live copilot:
 * - Auto-detected (non-generic) wins once available
 * - Else persona-inferred scenario
 * - Else detected generic / fallback generic
 */
export function resolveLiveScenario(params: {
  detected: ScenarioKey | null;
  personaPrompt?: string | null;
  usePersona?: boolean;
}): ScenarioKey {
  const fromPersona = params.usePersona
    ? inferScenarioFromPersona(params.personaPrompt)
    : null;
  if (params.detected && params.detected !== "generic") {
    return params.detected;
  }
  return fromPersona ?? params.detected ?? "generic";
}

/** Quiet interview copilot (SKIP / STAR answers) only for candidate interviews. */
export function isInterviewCandidateScenario(scenario: ScenarioKey): boolean {
  return scenario === "interview_candidate";
}

export function scenarioLabel(scenario: ScenarioKey): string {
  return SCENARIO_PROMPTS[scenario]?.label ?? "Conversation";
}
