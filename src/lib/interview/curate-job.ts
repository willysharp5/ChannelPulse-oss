import { toast } from "@/components/ui/toaster";
import type { LlmConfig } from "@/lib/llm";
import {
  generateInterviewDraftFromJobPosting,
  type JobPostingResearchInput,
} from "./generate";
import { saveInterviewTemplate } from "./templates";
import type { InterviewTemplate } from "./templates";

/** Fired on window when a background curation finishes and is saved. */
export const CURATION_DONE_EVENT = "interview-curation-done";
/** Fired on window whenever the active-job count changes. */
export const CURATION_CHANGED_EVENT = "interview-curation-changed";

let activeCount = 0;
const listeners = new Set<() => void>();

function emitChanged() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      // ignore listener errors
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(CURATION_CHANGED_EVENT));
  } catch {
    // non-DOM env
  }
}

/** How many curation research jobs are currently running. */
export function getActiveCurationCount(): number {
  return activeCount;
}

/** Subscribe to active-job count changes (returns an unsubscribe fn). */
export function subscribeCuration(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Fire-and-forget: run the Firecrawl research + drafting job in the background,
 * auto-save the tailored interview, and notify the user (toast) when it's done.
 * Survives the user leaving the create screen.
 */
export function runInterviewCurationInBackground(params: {
  config: LlmConfig;
  input: JobPostingResearchInput;
}): void {
  activeCount += 1;
  emitChanged();

  void (async () => {
    let saved: InterviewTemplate | null = null;
    try {
      const { draft, researchBrief } =
        await generateInterviewDraftFromJobPosting({
          config: params.config,
          input: params.input,
        });

      // Persist the research brief with the interview so it's viewable later.
      const withBrief =
        researchBrief && researchBrief.trim()
          ? {
              ...draft,
              notes: [
                draft.notes,
                `---\n\n### Research brief\n\n${researchBrief.trim()}`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            }
          : draft;

      saved = saveInterviewTemplate(withBrief);

      toast("Interview ready", {
        description: `“${saved.title}”: research done. Find it under Personalized.`,
        variant: "success",
      });
      try {
        window.dispatchEvent(
          new CustomEvent(CURATION_DONE_EVENT, {
            detail: { id: saved.id, title: saved.title },
          })
        );
      } catch {
        // ignore
      }
    } catch (err) {
      toast("Interview research failed", {
        description:
          err instanceof Error ? err.message.slice(0, 140) : String(err),
        variant: "error",
      });
    } finally {
      activeCount = Math.max(0, activeCount - 1);
      emitChanged();
    }
  })();
}
