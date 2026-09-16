import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  Markdown,
} from "@/components";
import { scrollPageToTop } from "@/lib/utils";
import {
  blankInterviewTemplate,
  generateInterviewDraftFromJobPosting,
  INTERVIEW_CATEGORIES,
  INTERVIEW_VOICES,
  normalizeInterviewCategory,
  normalizeInterviewVoice,
  saveInterviewTemplate,
  type InterviewCategoryId,
  type InterviewDifficulty,
  type InterviewTemplate,
  type InterviewTemplateInput,
  type InterviewVoiceId,
} from "@/lib/interview";
import {
  ArrowLeft,
  Briefcase,
  Loader2,
  Plus,
  Save,
  Trash2,
  FileText,
  ChevronDown,
  Square,
} from "lucide-react";
import { useApp } from "@/contexts";

interface TemplateEditorProps {
  initial?: InterviewTemplate | null;
  /** Prefill from an AI-generated draft (always saves as a new personalized type). */
  seed?: InterviewTemplateInput | null;
  /** Shown after create-from-JD research (optional). */
  initialResearchNotes?: string[];
  /** Markdown research brief shown after create-from-JD research (optional). */
  initialResearchBrief?: string;
  onCancel: () => void;
  onSaved: (template: InterviewTemplate) => void;
}

export function TemplateEditor({
  initial,
  seed,
  initialResearchNotes,
  initialResearchBrief,
  onCancel,
  onSaved,
}: TemplateEditorProps) {
  // Editing a built-in always saves a personalized copy — the template stays put.
  const isCopyingBuiltin = !!initial?.builtIn;
  const source = initial ?? null;
  const seedSource = !initial && seed ? seed : null;

  const [form, setForm] = useState<InterviewTemplateInput>(() => {
    if (source) {
      return {
        // Omit builtin ids so save creates a new personalized entry.
        id: isCopyingBuiltin ? undefined : source.id,
        title: source.title,
        category: normalizeInterviewCategory(source.category),
        mode: "job_interview",
        roleLevel: source.roleLevel,
        focusAreas: source.focusAreas,
        difficulty: source.difficulty,
        voice: normalizeInterviewVoice(source.voice),
        notes: source.notes,
        productContext: source.productContext ?? "",
        customQuestions: source.customQuestions ?? [],
        answerMode:
          source.answerMode === "system_design"
            ? "system_design"
            : source.answerMode === "coding"
              ? "coding"
              : "spoken",
      };
    }
    if (seedSource) {
      return {
        ...seedSource,
        id: undefined,
        category: normalizeInterviewCategory(seedSource.category),
        mode: "job_interview",
        voice: normalizeInterviewVoice(seedSource.voice),
      };
    }
    return blankInterviewTemplate();
  });
  const [focusText, setFocusText] = useState(
    source?.focusAreas.join(", ") ?? seedSource?.focusAreas.join(", ") ?? ""
  );
  const [questionItems, setQuestionItems] = useState<string[]>(() => {
    const qs = source?.customQuestions ?? seedSource?.customQuestions ?? [];
    return qs.length > 0 ? qs : [""];
  });
  const [error, setError] = useState<string | null>(null);
  const { allAiProviders, selectedAIProvider } = useApp();

  // Job posting research (edit + create)
  const [showResearch, setShowResearch] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [companyProfile, setCompanyProfile] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchProgress, setResearchProgress] = useState<string | null>(null);
  const [researchNotes, setResearchNotes] = useState<string[]>(
    initialResearchNotes ?? []
  );
  const [researchBrief, setResearchBrief] = useState(
    initialResearchBrief ?? ""
  );
  const [showBrief, setShowBrief] = useState(true);
  const [researchError, setResearchError] = useState<string | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const stopResearch = () => researchAbortRef.current?.abort();
  const isAbort = (e: unknown) =>
    e instanceof DOMException && e.name === "AbortError";

  const applyDraftToForm = (draft: InterviewTemplateInput) => {
    setForm((prev) => ({
      ...prev,
      title: draft.title || prev.title,
      category: draft.category,
      mode: draft.mode,
      roleLevel: draft.roleLevel || prev.roleLevel,
      focusAreas: draft.focusAreas,
      difficulty: draft.difficulty,
      voice: draft.voice,
      notes: draft.notes,
      productContext: draft.productContext,
      customQuestions: draft.customQuestions,
      customQuestionCategories: draft.customQuestionCategories,
      answerMode:
        draft.answerMode === "system_design"
          ? "system_design"
          : draft.answerMode === "coding"
            ? "coding"
            : "spoken",
    }));
    setFocusText(draft.focusAreas.join(", "));
    setQuestionItems(
      draft.customQuestions.length > 0 ? draft.customQuestions : [""]
    );
  };

  const handleJobResearch = async () => {
    if (!jobDescription.trim()) {
      setResearchError("Paste a job description first.");
      return;
    }
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!provider || !selectedAIProvider?.provider) {
      setResearchError("No AI provider configured.");
      return;
    }
    setResearchBusy(true);
    setResearchError(null);
    setResearchProgress(null);
    setResearchNotes([]);
    const ac = new AbortController();
    researchAbortRef.current = ac;
    try {
      const { draft, researchNotes: notes, researchBrief: brief } =
        await generateInterviewDraftFromJobPosting({
          config: {
            provider,
            selectedProvider: selectedAIProvider,
          },
          input: {
            jobDescription,
            companyProfile,
            companyName: companyName || undefined,
            roleHint: form.roleLevel || undefined,
          },
          onProgress: setResearchProgress,
          signal: ac.signal,
        });
      applyDraftToForm(draft);
      setResearchNotes(notes);
      setResearchBrief(brief);
      setShowBrief(true);
      setShowResearch(false);
      toast("Draft updated from JD + research", { variant: "success" });
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) setResearchProgress(null);
      else setResearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setResearchBusy(false);
      setResearchProgress(null);
      researchAbortRef.current = null;
    }
  };

  // Research again and APPEND new questions (deduped) instead of replacing —
  // so curation isn't one-and-done.
  const handleResearchAppend = async () => {
    if (!jobDescription.trim()) {
      setResearchError("Paste a job description first.");
      return;
    }
    const provider = allAiProviders.find(
      (p) => p.id === selectedAIProvider.provider
    );
    if (!provider || !selectedAIProvider?.provider) {
      setResearchError("No AI provider configured.");
      return;
    }
    setResearchBusy(true);
    setResearchError(null);
    setResearchProgress(null);
    const ac = new AbortController();
    researchAbortRef.current = ac;
    try {
      const { draft, researchNotes: notes, researchBrief: brief } =
        await generateInterviewDraftFromJobPosting({
          config: { provider, selectedProvider: selectedAIProvider },
          input: {
            jobDescription,
            companyProfile,
            companyName: companyName || undefined,
            roleHint: form.roleLevel || undefined,
          },
          onProgress: setResearchProgress,
          signal: ac.signal,
        });
      const existingQ = form.customQuestions ?? [];
      const existingC = form.customQuestionCategories ?? [];
      const seen = new Set(existingQ.map((q) => q.trim().toLowerCase()));
      const mergedQ = [...existingQ];
      const mergedC = [...existingC];
      (draft.customQuestions ?? []).forEach((qq, i) => {
        const k = qq.trim().toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        mergedQ.push(qq);
        mergedC.push(draft.customQuestionCategories?.[i] ?? "behavioral");
      });
      const finalQ = mergedQ.slice(0, 20);
      const finalC = mergedC.slice(0, 20);
      const added = finalQ.length - existingQ.length;
      setForm((prev) => ({
        ...prev,
        customQuestions: finalQ,
        customQuestionCategories: finalC,
      }));
      setQuestionItems(finalQ.length > 0 ? finalQ : [""]);
      setResearchNotes(notes);
      setResearchBrief(brief);
      setShowBrief(true);
      setShowResearch(false);
      toast(
        added > 0
          ? `Added ${added} researched question${added === 1 ? "" : "s"}`
          : "No new questions to add",
        { variant: added > 0 ? "success" : "info" }
      );
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) setResearchProgress(null);
      else setResearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setResearchBusy(false);
      setResearchProgress(null);
      researchAbortRef.current = null;
    }
  };

  // Opening the editor should always start at the top of the page, even if the
  // list was scrolled down when the user clicked Create/Edit.
  useEffect(() => {
    scrollPageToTop("auto");
  }, []);

  const update = <K extends keyof InterviewTemplateInput>(
    key: K,
    value: InterviewTemplateInput[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const setCategory = (category: InterviewCategoryId) => {
    setForm((prev) => ({ ...prev, category }));
  };

  const handleSave = () => {
    const title = form.title.trim();
    const roleLevel = form.roleLevel.trim();
    if (!title) {
      setError("Give this interview type a name.");
      return;
    }
    if (!roleLevel) {
      setError("What role or level is this interview for?");
      return;
    }

    const focusAreas = focusText
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const customQuestions = questionItems
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    const saved = saveInterviewTemplate({
      ...form,
      // Built-in edits always create a new personalized entry.
      id: isCopyingBuiltin ? undefined : form.id,
      mode: "job_interview",
      title,
      roleLevel,
      focusAreas,
      customQuestions,
      productContext: "",
    });
    // Land back at the top of the list and confirm the save.
    scrollPageToTop();
    toast(
      isCopyingBuiltin ? "Saved to Personalized" : "Saved",
      { description: `“${saved.title}” is ready to practice.`, variant: "success" }
    );
    onSaved(saved);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={onCancel} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {isCopyingBuiltin
                ? "Customize interview type"
                : seedSource
                  ? "Review AI interview draft"
                  : initial
                    ? "Edit interview type"
                    : "Create your own interview type"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isCopyingBuiltin
                ? "Changes only affect your personalized copy; the template itself stays the same."
                : seedSource
                  ? "Review and tweak anything before saving to Personalized."
                  : "Tell the AI who it should interview for and what to focus on. The more specific you are, the better the questions."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setShowResearch((v) => !v);
            setResearchError(null);
          }}
          disabled={researchBusy}
        >
          <Briefcase className="h-4 w-4" />
          {showResearch ? "Hide research" : "From job posting"}
        </Button>
      </div>

      {researchBrief.trim() && !showResearch ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <button
            type="button"
            onClick={() => setShowBrief((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-sm font-semibold"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Research brief
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                showBrief ? "rotate-180" : ""
              }`}
            />
          </button>
          {showBrief ? (
            <div className="mt-2 text-sm leading-relaxed [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold">
              <Markdown>{researchBrief}</Markdown>
            </div>
          ) : null}
        </div>
      ) : null}

      {researchNotes.length > 0 && !showResearch ? (
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
          {researchNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {showResearch ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-4">
          <div>
            <p className="text-sm font-medium">Research from a job posting</p>
            <p className="text-xs text-muted-foreground mt-1">
              Paste the JD and optional company profile. We’ll search Blind,
              Glassdoor, and the web, then fill title, notes, focus areas, and
              practice questions.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Company name</Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Stripe"
            />
            <p className="text-2xs text-muted-foreground">
              Role is taken from the Role / level field below (or guessed from
              the JD).
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Job description</Label>
            <Textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={8}
              className="min-h-[10rem] max-h-72 resize-y overflow-y-auto field-sizing-fixed"
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
              rows={4}
              className="min-h-[5rem] max-h-40 resize-y overflow-y-auto field-sizing-fixed"
              placeholder="Paste an about page, careers blurb, or notes about the company…"
            />
          </div>

          {researchProgress ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {researchProgress}
            </div>
          ) : null}

          {researchError ? (
            <p className="text-sm text-destructive">{researchError}</p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {researchBusy ? (
              <Button variant="destructive" onClick={stopResearch}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => setShowResearch(false)}
              disabled={researchBusy}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleResearchAppend}
              disabled={researchBusy}
              title="Research again and add new questions to the current list"
            >
              {researchBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Research more (append)
            </Button>
            <Button onClick={handleJobResearch} disabled={researchBusy}>
              {researchBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Briefcase className="h-4 w-4" />
              )}
              {researchBusy ? "Researching…" : "Research & replace"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-muted/40 p-5 space-y-5">
        <Field
          label="Name"
          hint="A short label you’ll recognize in the list, e.g. “Staff EM at Series B”."
        >
          <Input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. Engineering Manager"
          />
        </Field>

        <Field
          label="Category"
          hint="Used for filtering on the practice types list."
        >
          <Select
            value={normalizeInterviewCategory(form.category)}
            onValueChange={(v) => setCategory(v as InterviewCategoryId)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_CATEGORIES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Role / level"
          hint="Who is the interviewer hiring for? Be specific: title, seniority, and domain help a lot."
        >
          <Input
            value={form.roleLevel}
            onChange={(e) => update("roleLevel", e.target.value)}
            placeholder="e.g. Senior Backend Engineer, Staff Product Manager"
          />
        </Field>

        <Field
          label="Focus areas"
          hint="Comma-separated topics the interviewer should probe. Example: leadership, system design, conflict resolution."
        >
          <Input
            value={focusText}
            onChange={(e) => setFocusText(e.target.value)}
            placeholder="leadership, prioritization, delivery"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Difficulty"
            hint="How hard should follow-ups feel?"
          >
            <Select
              value={form.difficulty}
              onValueChange={(v) =>
                update("difficulty", v as InterviewDifficulty)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Interviewer voice"
            hint="Who should the interviewer sound like?"
          >
            <Select
              value={normalizeInterviewVoice(form.voice)}
              onValueChange={(v) =>
                update("voice", v as InterviewVoiceId)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVIEW_VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Practice questions</Label>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {questionItems.filter((q) => q.trim()).length}/10
            </span>
          </div>
          <div className="space-y-2">
            {questionItems.map((q, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-2.5 w-4 shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <Textarea
                  value={q}
                  rows={1}
                  placeholder="e.g. Tell me about a time you led a difficult project."
                  className="max-h-48 min-h-9 resize-y field-sizing-content py-1.5 text-sm"
                  onChange={(e) => {
                    const next = [...questionItems];
                    next[i] = e.target.value;
                    setQuestionItems(next);
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="mt-0.5 h-9 w-9 shrink-0"
                  title="Remove question"
                  onClick={() => {
                    const next = questionItems.filter((_, idx) => idx !== i);
                    setQuestionItems(next.length > 0 ? next : [""]);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          {questionItems.length < 10 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setQuestionItems((prev) => [...prev, ""])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add question
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Asked in order. Leave empty and the AI will generate the session
            questions.
          </p>
        </div>

        <Field
          label="Extra notes (optional)"
          hint="Anything else the interviewer should keep in mind: company stage, specific skills, tone, or topics to avoid."
        >
          <Textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={4}
            placeholder="e.g. We’re a 40-person B2B SaaS. Dig into how I handle underperforming reports. Keep a warm but direct tone."
          />
        </Field>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4" />
            {isCopyingBuiltin
              ? "Save to Personalized"
              : seedSource
                ? "Save to Personalized"
                : initial
                  ? "Save changes"
                  : "Save interview type"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
