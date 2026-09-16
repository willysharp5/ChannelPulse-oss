import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Label,
  Textarea,
} from "@/components";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  SparklesIcon,
  UserIcon,
  BriefcaseIcon,
  TargetIcon,
  AwardIcon,
  MessageSquareIcon,
} from "lucide-react";
import {
  getStructuredProfile,
  setStructuredProfile,
  compileProfile,
  hasProfileContent,
  type StructuredProfile,
} from "@/lib/memory";
import { useApp } from "@/contexts";
import { fetchAIResponse } from "@/lib/functions/ai-response.function";
import { cn } from "@/lib/utils";

interface ProfileBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the compiled profile text after the user saves. */
  onSaved: (compiled: string) => void;
}

const STYLE_OPTIONS = [
  "Concise",
  "Detailed",
  "Direct, no fluff",
  "Casual tone",
  "Formal tone",
  "Use examples",
  "Step-by-step",
  "Bullet points",
];

const GOAL_SUGGESTIONS = [
  "Help me sound confident in interviews",
  "Prep me for behavioral questions",
  "Practice system design out loud",
  "Answer technical questions fast",
  "Catch things I miss and suggest replies",
];

const ERROR_PREFIXES = [
  "API request failed",
  "Network error",
  "Streaming not supported",
  "Failed to parse",
  "Error in fetchAIResponse",
  "ChannelPulse API Error",
  "Provider not provided",
  "Selected provider not provided",
];

type StepId = "basics" | "work" | "goals" | "expertise" | "style" | "review";

const STEPS: {
  id: StepId;
  title: string;
  subtitle: string;
  icon: typeof UserIcon;
}[] = [
  {
    id: "basics",
    title: "The basics",
    subtitle: "So the assistant knows who it's helping.",
    icon: UserIcon,
  },
  {
    id: "work",
    title: "What you do",
    subtitle: "Your work, and the product or company behind it.",
    icon: BriefcaseIcon,
  },
  {
    id: "goals",
    title: "What you want from it",
    subtitle: "How the assistant can be most useful to you.",
    icon: TargetIcon,
  },
  {
    id: "expertise",
    title: "Your background",
    subtitle: "Where you're an expert vs. where you want help.",
    icon: AwardIcon,
  },
  {
    id: "style",
    title: "How you like answers",
    subtitle: "Tune the tone and format to match you.",
    icon: MessageSquareIcon,
  },
  {
    id: "review",
    title: "Review & save",
    subtitle: "Here's what the assistant will remember about you.",
    icon: CheckIcon,
  },
];

export const ProfileBuilder = ({
  open,
  onOpenChange,
  onSaved,
}: ProfileBuilderProps) => {
  const { allAiProviders, selectedAIProvider } = useApp();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<StructuredProfile>(
    getStructuredProfile()
  );
  const [reviewText, setReviewText] = useState("");
  const [reviewEdited, setReviewEdited] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Reload fresh answers each time the dialog opens.
  useEffect(() => {
    if (open) {
      setProfile(getStructuredProfile());
      setStep(0);
      setReviewEdited(false);
      setAiError(null);
    }
  }, [open]);

  const compiled = useMemo(() => compileProfile(profile), [profile]);

  // Keep the review text synced with answers until the user edits it directly.
  useEffect(() => {
    if (!reviewEdited) setReviewText(compiled);
  }, [compiled, reviewEdited]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = current.icon;

  const set = (patch: Partial<StructuredProfile>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  const toggleStyle = (option: string) =>
    setProfile((prev) => ({
      ...prev,
      stylePrefs: prev.stylePrefs.includes(option)
        ? prev.stylePrefs.filter((s) => s !== option)
        : [...prev.stylePrefs, option],
    }));

  const appendGoal = (text: string) =>
    setProfile((prev) => {
      const existing = prev.goals.trim();
      if (existing.toLowerCase().includes(text.toLowerCase())) return prev;
      return {
        ...prev,
        goals: existing ? `${existing}\n${text}` : text,
      };
    });

  const handleSave = () => {
    setStructuredProfile(profile);
    const text = reviewEdited ? reviewText.trim() : compiled;
    onSaved(text);
    onOpenChange(false);
  };

  const handlePolish = async () => {
    const provider = allAiProviders?.find(
      (p) => p?.id === selectedAIProvider?.provider
    );
    if (!provider || !selectedAIProvider?.provider) {
      setAiError(
        "No AI provider configured. Set one up in Dev Space → AI Providers first."
      );
      return;
    }

    const base = (reviewEdited ? reviewText : compiled).trim();
    if (!base) {
      setAiError("Add a few details first, then I can polish them.");
      return;
    }

    try {
      setIsPolishing(true);
      setAiError(null);

      const instruction = `Rewrite the notes below into a clean, first-person profile the assistant will keep as permanent context about the user. Keep every concrete fact. Be compact (no more than ~120 words), plain sentences or short lines, no headings, no markdown, no preamble. Do not invent anything.\n\nNotes:\n${base}`;

      let full = "";
      for await (const chunk of fetchAIResponse({
        provider,
        selectedProvider: selectedAIProvider,
        systemPrompt:
          "You clean up personal profile notes into concise, factual, first-person context for an AI assistant. Reply with only the rewritten profile text, no commentary.",
        userMessage: instruction,
        disableMemory: true,
      })) {
        full += chunk;
      }

      const trimmed = full.trim();
      if (ERROR_PREFIXES.some((p) => trimmed.startsWith(p))) {
        throw new Error(trimmed);
      }
      if (!trimmed) {
        throw new Error("The model returned an empty response. Try again.");
      }

      setReviewText(trimmed);
      setReviewEdited(true);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : "Failed to polish the profile."
      );
    } finally {
      setIsPolishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{current.title}</DialogTitle>
              <DialogDescription>{current.subtitle}</DialogDescription>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-1 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto py-1 pr-1">
          {current.id === "basics" && (
            <>
              <Field
                label="What should the assistant call you?"
                hint="Your first name is enough."
              >
                <Input
                  autoFocus
                  value={profile.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="e.g. John"
                />
              </Field>
              <Field
                label="Your role or title"
                hint="Helps it frame answers for your job."
              >
                <Input
                  value={profile.role}
                  onChange={(e) => set({ role: e.target.value })}
                  placeholder="e.g. Software Engineer, Product Manager, Engineering Manager"
                />
              </Field>
              <Field
                label="Company, team, or school"
                hint="Optional, adds useful context."
              >
                <Input
                  value={profile.company}
                  onChange={(e) => set({ company: e.target.value })}
                  placeholder="e.g. Stripe"
                />
              </Field>
            </>
          )}

          {current.id === "work" && (
            <>
              <Field
                label="What do you do day-to-day, and what are you working on right now?"
                hint="A couple of sentences. Mention current projects, customers, or challenges."
              >
                <Textarea
                  autoFocus
                  value={profile.work}
                  onChange={(e) => set({ work: e.target.value })}
                  placeholder="e.g. I'm a senior backend engineer interviewing for staff roles at product companies. I want to get sharper on system design and leadership stories."
                  className="min-h-28 resize-y"
                />
              </Field>
              <Field
                label="Your product / company in a nutshell"
                hint="Real facts the assistant should ground answers in — what it does, key numbers, customers, competitors. This stops it inventing details when a question comes up live."
              >
                <Textarea
                  value={profile.product}
                  onChange={(e) => set({ product: e.target.value })}
                  placeholder="e.g. We sell a usage-based billing API to B2B SaaS companies. ~400 customers, $12M ARR, main competitors are Stripe Billing and Metronome. Differentiator is real-time metering and self-serve migration."
                  className="min-h-24 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "goals" && (
            <>
              <Field
                label="How do you want the assistant to help you?"
                hint="What would make it genuinely useful in your moment-to-moment work?"
              >
                <Textarea
                  autoFocus
                  value={profile.goals}
                  onChange={(e) => set({ goals: e.target.value })}
                  placeholder="e.g. Listen to my interview and feed me strong, concise answers and follow-ups as questions come up."
                  className="min-h-24 resize-y"
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {GOAL_SUGGESTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => appendGoal(g)}
                    className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    + {g}
                  </button>
                ))}
              </div>
            </>
          )}

          {current.id === "expertise" && (
            <Field
              label="What's your background and areas of expertise?"
              hint="Where you're strong, and where you'd like more help. This calibrates how deep answers go."
            >
              <Textarea
                autoFocus
                value={profile.expertise}
                onChange={(e) => set({ expertise: e.target.value })}
                placeholder="e.g. 8 years in backend engineering, strong on distributed systems and mentoring. Less confident on frontend and behavioral storytelling; go deeper there."
                className="min-h-28 resize-y"
              />
            </Field>
          )}

          {current.id === "style" && (
            <>
              <Field
                label="Pick how you like answers"
                hint="Choose any that fit; this shapes tone and format."
              >
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_OPTIONS.map((option) => {
                    const active = profile.stylePrefs.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleStyle(option)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/60 bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        )}
                      >
                        {active && (
                          <CheckIcon className="mr-1 inline size-3 align-[-1px]" />
                        )}
                        {option}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field
                label="Anything else it should always know?"
                hint="Dos and don'ts, sensitive topics, names it should recognize, etc."
              >
                <Textarea
                  value={profile.extra}
                  onChange={(e) => set({ extra: e.target.value })}
                  placeholder="e.g. Emphasize my backend and distributed systems experience. Prefer American English. Keep answers concise."
                  className="min-h-24 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "review" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Your profile</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePolish}
                  disabled={isPolishing || !compiled.trim()}
                  className="gap-1.5"
                  title="Use your AI provider to tidy this into clean prose"
                >
                  <SparklesIcon
                    className={cn("size-3.5", isPolishing && "animate-pulse")}
                  />
                  {isPolishing ? "Polishing…" : "Improve with AI"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This is injected into every response as background about you. Edit
                freely.
              </p>
              <Textarea
                value={reviewText}
                onChange={(e) => {
                  setReviewText(e.target.value);
                  setReviewEdited(true);
                }}
                placeholder="Fill in the earlier steps and your profile will appear here."
                className="min-h-40 resize-y text-sm"
              />
              {aiError && <p className="text-xs text-destructive">{aiError}</p>}
              {reviewEdited && (
                <button
                  type="button"
                  onClick={() => {
                    setReviewEdited(false);
                    setReviewText(compiled);
                    setAiError(null);
                  }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Reset to my answers
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
            className="gap-1.5"
          >
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeftIcon className="size-3.5" />
                Back
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            {!isLast && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(STEPS.length - 1)}
                className="text-muted-foreground"
              >
                Skip to review
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasProfileContent(profile) && !reviewText.trim()}
                className="gap-1.5"
              >
                <CheckIcon className="size-3.5" />
                Save profile
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep(step + 1)}
                className="gap-1.5"
              >
                Next
                <ArrowRightIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label className="text-sm">{label}</Label>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    {children}
  </div>
);
