import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Textarea,
} from "@/components";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  GlobeIcon,
  LinkIcon,
  ClipboardPasteIcon,
  UserIcon,
  SparklesIcon,
} from "lucide-react";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import {
  isLinkedInUrl,
  runFileResearchInBackground,
  type FileResearchSubject,
} from "@/lib/memory";

interface FileResearchWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called right after the job is queued (not when crawl finishes). */
  onQueued?: () => void;
}

type StepId = "who" | "details" | "paste" | "links" | "review";

const STEPS: {
  id: StepId;
  title: string;
  subtitle: string;
  icon: typeof UserIcon;
}[] = [
  {
    id: "who",
    title: "Who is this about?",
    subtitle: "We'll tailor research for interviews & live conversations.",
    icon: UserIcon,
  },
  {
    id: "details",
    title: "Details that drive research",
    subtitle: "Name, company, and role power the web crawl. Be specific.",
    icon: SparklesIcon,
  },
  {
    id: "paste",
    title: "Paste source material",
    subtitle: "LinkedIn can't be crawled. Paste profiles, JDs, or notes here.",
    icon: ClipboardPasteIcon,
  },
  {
    id: "links",
    title: "Add up to 4 links",
    subtitle: "Job posts, company pages, bios, portfolios. We'll fetch them.",
    icon: LinkIcon,
  },
  {
    id: "review",
    title: "Start in the background",
    subtitle: "We'll search, crawl, and build a briefing for interviews.",
    icon: CheckIcon,
  },
];

const SUBJECT_OPTIONS: {
  id: FileResearchSubject;
  label: string;
  hint: string;
}[] = [
  {
    id: "myself",
    label: "Myself",
    hint: "Your background + target role, for answering as you",
  },
  {
    id: "person",
    label: "Someone I'm talking to",
    hint: "Interviewer, hiring manager, recruiter, or customer",
  },
  {
    id: "interview",
    label: "Interview / company prep",
    hint: "Company, role, process, and likely questions",
  },
  {
    id: "other",
    label: "Something else",
    hint: "Any topic you want grounded for conversations",
  },
];

const RELATIONSHIP_OPTIONS = [
  "Interviewer",
  "Hiring manager",
  "Recruiter",
  "Peer / panel",
  "Customer / prospect",
  "Other",
];

const STAGE_OPTIONS = [
  "Recruiter screen",
  "Hiring manager",
  "Technical / coding",
  "System design",
  "Behavioral",
  "Onsite / loop",
  "Final / exec",
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const emptyUrls = (): string[] => ["", "", "", ""];

export const FileResearchWizard = ({
  open,
  onOpenChange,
  onQueued,
}: FileResearchWizardProps) => {
  const { allAiProviders, selectedAIProvider } = useApp();
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState<FileResearchSubject>("interview");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [relationship, setRelationship] = useState("");
  const [stage, setStage] = useState("");
  const [seniority, setSeniority] = useState("");
  const [experience, setExperience] = useState("");
  const [strengths, setStrengths] = useState("");
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [urls, setUrls] = useState<string[]>(emptyUrls);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSubject("interview");
    setName("");
    setRole("");
    setCompany("");
    setRelationship("");
    setStage("");
    setSeniority("");
    setExperience("");
    setStrengths("");
    setGoal("");
    setNotes("");
    setPastedText("");
    setUrls(emptyUrls());
  }, [open]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = current.icon;

  const linkedInInUrls = useMemo(
    () => urls.some((u) => u.trim() && isLinkedInUrl(u.trim())),
    [urls]
  );

  const crawlableUrls = useMemo(
    () =>
      urls
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u) && !isLinkedInUrl(u)),
    [urls]
  );

  /** Enough signal for Firecrawl + LLM to produce a useful interview briefing. */
  const hasContent = useMemo(() => {
    const hasPaste = pastedText.trim().length >= 40;
    const hasLinks = crawlableUrls.length > 0;
    const hasName = name.trim().length >= 2;

    switch (subject) {
      case "myself":
        return (
          hasPaste ||
          hasLinks ||
          (hasName &&
            (company.trim().length >= 2 ||
              role.trim().length >= 2 ||
              strengths.trim().length >= 10 ||
              experience.trim().length >= 10))
        );
      case "person":
        return (
          (hasName && (company.trim().length >= 2 || hasPaste || hasLinks)) ||
          hasPaste ||
          hasLinks
        );
      case "interview":
        return (
          (company.trim().length >= 2 &&
            (role.trim().length >= 2 || hasPaste || hasLinks)) ||
          hasPaste ||
          hasLinks
        );
      default:
        return (
          hasPaste ||
          hasLinks ||
          (hasName &&
            (goal.trim().length >= 10 || notes.trim().length >= 20))
        );
    }
  }, [
    subject,
    name,
    company,
    role,
    strengths,
    experience,
    goal,
    notes,
    pastedText,
    crawlableUrls,
  ]);

  const setUrlAt = (index: number, value: string) => {
    setUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const pasteCopy = useMemo(() => {
    switch (subject) {
      case "myself":
        return {
          title: "Paste your LinkedIn / resume",
          body: "We can't crawl LinkedIn. Copy About, Experience, and Education (or paste a resume) so the briefing has real stories and facts to work with.",
          label: "Resume, LinkedIn text, or bio",
          placeholder:
            "Paste your LinkedIn profile text or resume here…",
        };
      case "person":
        return {
          title: "Paste their LinkedIn / bio",
          body: "LinkedIn can't be crawled. Copy their About + Experience, or any bio/email intro you have; this is often the best signal for rapport and likely focus areas.",
          label: "Their profile or notes",
          placeholder: "Paste their LinkedIn or bio text…",
        };
      case "interview":
        return {
          title: "Paste the job description",
          body: "Paste the full JD if you have it. We'll also search the company and common interview questions. LinkedIn job posts: copy the text rather than linking.",
          label: "Job description / posting text",
          placeholder: "Paste the job description here…",
        };
      default:
        return {
          title: "Paste source material",
          body: "Anything useful: articles, notes, bios. LinkedIn still can't be crawled; paste that text here.",
          label: "Notes or pasted text",
          placeholder: "Paste material here…",
        };
    }
  }, [subject]);

  const linksHint = useMemo(() => {
    switch (subject) {
      case "myself":
        return "Portfolio, personal site, GitHub, or the company's careers page for the role you're targeting.";
      case "person":
        return "Company bio page, blog posts, talks, or team pages (not LinkedIn; paste that on the previous step).";
      case "interview":
        return "Job posting URL, careers page, engineering blog, or about page, up to 4.";
      default:
        return "Public pages we can fetch. Skip LinkedIn URLs.";
    }
  }, [subject]);

  const handleStart = () => {
    if (!hasContent) return;
    const provider = allAiProviders?.find(
      (p) => p?.id === selectedAIProvider?.provider
    );
    const defaultName =
      subject === "myself"
        ? "My background"
        : subject === "interview"
          ? [company.trim(), role.trim()].filter(Boolean).join(" · ") ||
            "Interview prep"
          : "Untitled";

    runFileResearchInBackground({
      input: {
        subject,
        name: name.trim() || defaultName,
        role: role.trim() || undefined,
        company: company.trim() || undefined,
        relationship: relationship.trim() || undefined,
        stage: stage.trim() || undefined,
        seniority: seniority.trim() || undefined,
        experience: experience.trim() || undefined,
        strengths: strengths.trim() || undefined,
        goal: goal.trim() || undefined,
        notes: notes.trim() || undefined,
        pastedText: pastedText.trim() || undefined,
        urls: crawlableUrls,
      },
      provider,
      selectedProvider: selectedAIProvider ?? {
        provider: "",
        variables: {},
      },
    });
    onQueued?.();
    onOpenChange(false);
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
          {current.id === "who" && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUBJECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSubject(opt.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors",
                      subject === opt.id
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40"
                    )}
                  >
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {opt.hint}
                    </p>
                  </button>
                ))}
              </div>
              <Field
                label={
                  subject === "myself"
                    ? "Your name"
                    : subject === "interview"
                      ? "Label for this prep"
                      : subject === "person"
                        ? "Their full name"
                        : "Topic or label"
                }
                hint="Used in Files and to search the web when helpful."
              >
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    subject === "myself"
                      ? "e.g. Alex Rivera"
                      : subject === "interview"
                        ? "e.g. Staff Eng at Stripe"
                        : subject === "person"
                          ? "e.g. Jordan Lee"
                          : "e.g. Acme Series B"
                  }
                />
              </Field>
            </>
          )}

          {current.id === "details" && subject === "myself" && (
            <>
              <Field
                label="Target role"
                hint="What you're interviewing for; drives question research."
              >
                <Input
                  autoFocus
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Staff Software Engineer"
                />
              </Field>
              <Field label="Seniority" hint="Optional.">
                <Input
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  placeholder="e.g. Senior, Staff, Principal"
                />
              </Field>
              <Field
                label="Target company"
                hint="We'll research their process and culture when set."
              >
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Stripe"
                />
              </Field>
              <Field
                label="Experience highlight"
                hint="Years, domains, or standout roles."
              >
                <Input
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="e.g. 8 years backend, 3 at Scale AI"
                />
              </Field>
              <Field
                label="Strengths & stack"
                hint="What you want the assistant to lean on."
              >
                <Textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  placeholder="e.g. Distributed systems, Python, mentoring, ownership stories"
                  className="min-h-20 resize-y"
                />
              </Field>
              <Field label="What should the assistant help with?">
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Live interview answers that sound like me; surface my strongest stories."
                  className="min-h-20 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "details" && subject === "person" && (
            <>
              <Field label="Their role / title">
                <Input
                  autoFocus
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Engineering Manager"
                />
              </Field>
              <Field
                label="Their company"
                hint="Required for useful company + person search."
              >
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Notion"
                />
              </Field>
              <Field label="Who are they to you?">
                <div className="flex flex-wrap gap-1.5">
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setRelationship(opt)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                        relationship === opt
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:bg-muted/40"
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="What is this conversation for?">
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Onsite panel with this EM, help me connect to their background and answer crisply."
                  className="min-h-20 resize-y"
                />
              </Field>
              <Field
                label="Anything else you already know?"
                hint="Prior companies, interests, what they care about."
              >
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Ex-Stripe. Cares about ownership and mentorship."
                  className="min-h-20 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "details" && subject === "interview" && (
            <>
              <Field
                label="Company"
                hint="We search overview, culture, and interview process."
              >
                <Input
                  autoFocus
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Datadog"
                />
              </Field>
              <Field label="Role you're interviewing for">
                <Input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                />
              </Field>
              <Field label="Seniority" hint="Optional.">
                <Input
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  placeholder="e.g. Senior, Staff"
                />
              </Field>
              <Field label="Interview stage / focus">
                <div className="flex flex-wrap gap-1.5">
                  {STAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() =>
                        setStage((prev) => (prev === opt ? "" : opt))
                      }
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                        stage === opt
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:bg-muted/40"
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="What do you need from this briefing?">
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Company snapshot, process, and likely questions for a system-design round."
                  className="min-h-20 resize-y"
                />
              </Field>
              <Field label="Extra notes" hint="Optional.">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Recruiter said 4 rounds; focus on observability."
                  className="min-h-16 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "details" && subject === "other" && (
            <>
              <Field label="Role or context" hint="Optional.">
                <Input
                  autoFocus
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Competitor, market, product"
                />
              </Field>
              <Field label="Company or org" hint="Optional.">
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Acme"
                />
              </Field>
              <Field label="What should the assistant use this for?">
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Ground answers in this market when the topic comes up."
                  className="min-h-20 resize-y"
                />
              </Field>
              <Field label="What you already know">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key facts, angles, or questions…"
                  className="min-h-24 resize-y"
                />
              </Field>
            </>
          )}

          {current.id === "paste" && (
            <>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{pasteCopy.title}</p>
                <p className="mt-1">{pasteCopy.body}</p>
              </div>
              <Field label={pasteCopy.label}>
                <Textarea
                  autoFocus
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={pasteCopy.placeholder}
                  className="min-h-40 resize-y font-mono text-xs"
                />
              </Field>
            </>
          )}

          {current.id === "links" && (
            <>
              <p className="text-xs text-muted-foreground">{linksHint}</p>
              {urls.map((url, i) => (
                <Field key={i} label={`Link ${i + 1}`}>
                  <div className="relative">
                    <GlobeIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={url}
                      onChange={(e) => setUrlAt(i, e.target.value)}
                      placeholder="https://"
                      className="pl-8"
                      autoFocus={i === 0}
                    />
                  </div>
                  {url.trim() && isLinkedInUrl(url.trim()) ? (
                    <p className="mt-1 text-2xs text-amber-600 dark:text-amber-400">
                      LinkedIn won't be fetched. Paste the text instead.
                    </p>
                  ) : null}
                </Field>
              ))}
              {linkedInInUrls ? (
                <p className="text-xs text-muted-foreground">
                  LinkedIn links above will be ignored when research starts.
                </p>
              ) : null}
            </>
          )}

          {current.id === "review" && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3 space-y-2">
                <p>
                  <span className="text-muted-foreground">About · </span>
                  {SUBJECT_OPTIONS.find((o) => o.id === subject)?.label}
                  {name.trim() ? ` · ${name.trim()}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    role.trim(),
                    seniority.trim(),
                    company.trim(),
                    relationship.trim(),
                    stage.trim(),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No role/company yet"}
                </p>
                {goal.trim() ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Use for · </span>
                    {goal.trim()}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {pastedText.trim()
                    ? `Pasted · ~${pastedText.trim().length} chars`
                    : "No paste"}
                  {" · "}
                  {crawlableUrls.length} link
                  {crawlableUrls.length === 1 ? "" : "s"}
                  {" · "}
                  Web search for interview-useful sources
                </p>
              </div>
              {!hasContent ? (
                <p className="text-xs text-destructive">
                  {subject === "person"
                    ? "Add their name plus company, a pasted profile, or a link."
                    : subject === "interview"
                      ? "Add company + role, paste a JD, or include at least one link."
                      : subject === "myself"
                        ? "Add your name with target role/company, paste a resume/LinkedIn, or add links."
                        : "Add notes, paste material, or at least one crawlable link."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  We'll crawl your links, run targeted web search (company,
                  process, questions / person background), then write a
                  briefing for chats and interviews. You can leave this page;
                  you'll get a notification when it's ready.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="gap-1"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Button>
          {isLast ? (
            <Button
              type="button"
              size="sm"
              disabled={!hasContent}
              onClick={handleStart}
              className="gap-1.5"
            >
              <SparklesIcon className="size-3.5" />
              Start research
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="gap-1"
            >
              Next
              <ArrowRightIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
