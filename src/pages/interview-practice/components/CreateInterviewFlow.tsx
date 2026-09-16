import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import { toast } from "@/components";
import { useApp } from "@/contexts";
import {
  continueGuidedInterviewDraft,
  generateInterviewDraftFromDescription,
  runInterviewCurationInBackground,
  type GuidedTurn,
  type InterviewTemplate,
  type InterviewTemplateInput,
} from "@/lib/interview";
import { scrollPageToTop } from "@/lib/utils";
import {
  ArrowLeft,
  Briefcase,
  Loader2,
  MessageSquareText,
  PencilLine,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { TemplateEditor } from "./TemplateEditor";

type Step =
  | "choose"
  | "describe"
  | "guided"
  | "job_posting"
  | "manual"
  | "review";

interface CreateInterviewFlowProps {
  onCancel: () => void;
  onSaved: (template: InterviewTemplate) => void;
}

export function CreateInterviewFlow({
  onCancel,
  onSaved,
}: CreateInterviewFlowProps) {
  const { allAiProviders, selectedAIProvider } = useApp();
  const [step, setStep] = useState<Step>("choose");
  const [draft, setDraft] = useState<InterviewTemplateInput | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Job posting research
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [companyProfile, setCompanyProfile] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleHint, setRoleHint] = useState("");
  const [seniority, setSeniority] = useState("");
  const [stageFocus, setStageFocus] = useState("");
  const [questionCount, setQuestionCount] = useState("8");

  // Guided state
  const [history, setHistory] = useState<GuidedTurn[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    scrollPageToTop("auto");
  }, [step]);

  const llmConfig = {
    provider: allAiProviders.find((p) => p.id === selectedAIProvider.provider),
    selectedProvider: selectedAIProvider,
  };

  const ensureProvider = (): string | null => {
    if (!llmConfig.provider || !selectedAIProvider?.provider) {
      return "No AI provider configured. Set one up before using AI assist.";
    }
    return null;
  };

  const openReview = (next: InterviewTemplateInput) => {
    setDraft(next);
    setStep("review");
    setError(null);
  };

  const handleDescribeGenerate = async () => {
    if (!description.trim()) {
      setError("Describe the practice you want to create.");
      return;
    }
    const providerError = ensureProvider();
    if (providerError) {
      setError(providerError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const generated = await generateInterviewDraftFromDescription({
        config: llmConfig,
        description,
      });
      openReview(generated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startBackgroundResearch = () => {
    if (!jobDescription.trim() && !jobUrl.trim() && !companyName.trim()) {
      setError("Add a job posting URL, paste the description, or a company + role.");
      return;
    }
    const providerError = ensureProvider();
    if (providerError) {
      setError(providerError);
      return;
    }
    // Kick off the Firecrawl research + drafting job in the background; the user
    // gets a toast when it's ready and the interview appears under Personalized.
    runInterviewCurationInBackground({
      config: llmConfig,
      input: {
        jobDescription,
        jobUrl,
        companyProfile,
        companyName,
        roleHint,
        seniority,
        stageFocus,
        questionCount: Number(questionCount) || 8,
      },
    });
    toast("Researching in the background", {
      description:
        "We’ll research the company, the interview process and the questions, then notify you when your interview is ready.",
    });
    onCancel();
  };

  const startGuided = async () => {
    const providerError = ensureProvider();
    if (providerError) {
      setError(providerError);
      return;
    }
    setBusy(true);
    setError(null);
    setHistory([]);
    setAnswer("");
    try {
      const result = await continueGuidedInterviewDraft({
        config: llmConfig,
        history: [],
      });
      if (result.kind === "draft") {
        openReview(result.draft);
        return;
      }
      setCurrentQuestion(result.question);
      setHistory([{ role: "assistant", content: result.question }]);
      setStep("guided");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitGuidedAnswer = async () => {
    if (!answer.trim() || !currentQuestion) return;
    const providerError = ensureProvider();
    if (providerError) {
      setError(providerError);
      return;
    }

    const nextHistory: GuidedTurn[] = [
      ...history,
      { role: "user", content: answer.trim() },
    ];
    setHistory(nextHistory);
    setAnswer("");
    setBusy(true);
    setError(null);
    try {
      const result = await continueGuidedInterviewDraft({
        config: llmConfig,
        history: nextHistory,
      });
      if (result.kind === "draft") {
        openReview(result.draft);
        return;
      }
      setCurrentQuestion(result.question);
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: result.question },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "manual") {
    return (
      <TemplateEditor
        initial={null}
        onCancel={() => setStep("choose")}
        onSaved={onSaved}
      />
    );
  }

  if (step === "review" && draft) {
    return (
      <TemplateEditor
        seed={draft}
        onCancel={() => setStep("choose")}
        onSaved={onSaved}
      />
    );
  }

  if (step === "describe") {
    return (
      <div className="flex flex-col gap-5">
        <FlowHeader
          title="Describe your practice"
          description="Tell the AI what you want to practice: role, company, or tough questions. It drafts the full interview type for you to review."
          onBack={() => {
            setStep("choose");
            setError(null);
          }}
        />

        <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              className="min-h-[9rem] max-h-64 resize-y overflow-y-auto field-sizing-fixed"
              placeholder={
                "e.g. Staff EM interview for a Series B SaaS, focus on people management and delivery.\n\nor\n\nProduct Manager interview at a fintech, focus on prioritization, metrics, and stakeholder tradeoffs."
              }
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button onClick={handleDescribeGenerate} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {busy ? "Generating…" : "Generate draft"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "guided") {
    const answered = history.filter((h) => h.role === "user");
    return (
      <div className="flex flex-col gap-5">
        <FlowHeader
          title="Guided setup"
          description="Answer a few short questions. When there’s enough detail, the AI builds your practice draft to review."
          onBack={() => {
            setStep("choose");
            setError(null);
            setHistory([]);
            setCurrentQuestion(null);
          }}
        />

        <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-4">
          <div className="space-y-3 max-h-[22rem] overflow-y-auto pr-1">
            {history.map((turn, i) => (
              <div
                key={`${turn.role}-${i}`}
                className={
                  turn.role === "assistant"
                    ? "rounded-lg border border-border/50 bg-background px-3 py-2.5"
                    : "rounded-lg bg-primary/10 px-3 py-2.5 ml-6"
                }
              >
                <p className="text-3xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  {turn.role === "assistant" ? "AI coach" : "You"}
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {turn.content}
                </p>
              </div>
            ))}
          </div>

          {busy && !currentQuestion ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          ) : null}

          {currentQuestion && !busy ? (
            <div className="space-y-2 border-t border-border/50 pt-4">
              <Label className="text-sm font-medium">Your answer</Label>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="min-h-[4.5rem] max-h-32 resize-y overflow-y-auto field-sizing-fixed"
                placeholder="Type your answer…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submitGuidedAnswer();
                  }
                }}
              />
              <p className="text-2xs text-muted-foreground">
                Step {answered.length + 1} · ⌘/Ctrl+Enter to send
              </p>
            </div>
          ) : null}

          {busy && currentQuestion ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building next step…
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setStep("choose")}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitGuidedAnswer}
              disabled={busy || !answer.trim()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquareText className="h-4 w-4" />
              )}
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "job_posting") {
    return (
      <div className="flex flex-col gap-5">
        <FlowHeader
          title="Curate with research"
          description="Add the job details (or a posting URL), then we kick off a Firecrawl research job on the company, the interview process, and the questions they ask, and draft a tailored interview with a research brief."
          onBack={() => {
            setStep("choose");
            setError(null);
          }}
        />

        <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Job posting URL (optional)</Label>
            <Input
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              placeholder="https://… · we’ll fetch the description for you"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Company name</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Stripe"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Role (optional)</Label>
              <Input
                value={roleHint}
                onChange={(e) => setRoleHint(e.target.value)}
                placeholder="e.g. Backend Engineer"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seniority</Label>
              <Select value={seniority} onValueChange={setSeniority}>
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Intern">Intern</SelectItem>
                  <SelectItem value="Junior">Junior</SelectItem>
                  <SelectItem value="Mid-level">Mid-level</SelectItem>
                  <SelectItem value="Senior">Senior</SelectItem>
                  <SelectItem value="Staff / Principal">Staff / Principal</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                  <SelectItem value="Director">Director</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Stage / focus</Label>
              <Select value={stageFocus} onValueChange={setStageFocus}>
                <SelectTrigger>
                  <SelectValue placeholder="Balanced" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Recruiter screen">Recruiter screen</SelectItem>
                  <SelectItem value="Technical / coding">Technical / coding</SelectItem>
                  <SelectItem value="System design">System design</SelectItem>
                  <SelectItem value="Behavioral">Behavioral</SelectItem>
                  <SelectItem value="Hiring manager">Hiring manager</SelectItem>
                  <SelectItem value="Full loop">Full loop</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium"># Questions</Label>
              <Select value={questionCount} onValueChange={setQuestionCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Job description (paste, or leave blank if you gave a URL)
            </Label>
            <Textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={8}
              className="min-h-[10rem] max-h-80 resize-y overflow-y-auto field-sizing-fixed"
              placeholder="Paste the full job description here…"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Company profile (optional)
            </Label>
            <Textarea
              value={companyProfile}
              onChange={(e) => setCompanyProfile(e.target.value)}
              rows={5}
              className="min-h-[6rem] max-h-48 resize-y overflow-y-auto field-sizing-fixed"
              placeholder="Paste an about page, careers blurb, or notes about the company…"
            />
            <p className="text-2xs text-muted-foreground">
              We’ll research the company, the interview process, and the
              questions (Blind / Glassdoor / Levels / web); this runs in the
              background and you’ll be notified when your interview is ready.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button onClick={startBackgroundResearch}>
              <Briefcase className="h-4 w-4" />
              Start research in background
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // —— Choose ——
  return (
    <div className="flex flex-col gap-5">
      <FlowHeader
        title="Create your own"
        description="Build a job interview to practice. Use AI to draft it from a JD, a short description, guided questions, or fill everything in yourself."
        onBack={onCancel}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ChoiceCard
          icon={Briefcase}
          title="From job posting"
          description="Paste a JD + company profile. Research Blind/Glassdoor/web, then draft questions."
          onClick={() => {
            setError(null);
            setStep("job_posting");
          }}
          disabled={busy}
        />
        <ChoiceCard
          icon={Sparkles}
          title="Describe it"
          description="Write a short brief. AI drafts the full practice type for you to edit."
          onClick={() => {
            setError(null);
            setStep("describe");
          }}
          disabled={busy}
        />
        <ChoiceCard
          icon={WandSparkles}
          title="Guided by AI"
          description="AI asks you step-by-step questions, then builds the practice draft."
          onClick={() => void startGuided()}
          disabled={busy}
          busy={busy}
        />
        <ChoiceCard
          icon={PencilLine}
          title="Do it yourself"
          description="Open the full editor and set every field manually."
          onClick={() => {
            setError(null);
            setStep("manual");
          }}
          disabled={busy}
        />
      </div>
    </div>
  );
}

function FlowHeader({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} title="Back">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
  busy,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) onClick();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="relative border shadow-none p-5 gap-0 cursor-pointer transition-colors !bg-muted/40 border-border/60 hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
        {busy ? (
          <Loader2 className="size-4.5 animate-spin" />
        ) : (
          <Icon className="size-4.5" />
        )}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
        {description}
      </p>
    </Card>
  );
}
