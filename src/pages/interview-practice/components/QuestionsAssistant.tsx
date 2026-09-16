import { useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@/components";
import { useApp } from "@/contexts";
import {
  assistInterviewQuestions,
  updateInterviewTemplateSettings,
  type AssistQuestion,
  type InterviewTemplate,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  Globe,
  Link2,
  Square,
} from "lucide-react";

const CATEGORY_OPTIONS = [
  { id: "behavioral", label: "Behavioral" },
  { id: "technical", label: "Technical" },
  { id: "coding", label: "Coding" },
  { id: "system_design", label: "System design" },
] as const;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuestionsAssistantProps {
  template: InterviewTemplate;
  onClose: () => void;
  onChanged?: () => void;
}

/** Guess a company name from a "Role at Company" style title. */
function guessCompany(title: string): string | undefined {
  const m = title.match(/\bat\s+(.+)$/i);
  return m?.[1]?.trim() || undefined;
}

export function QuestionsAssistant({
  template,
  onClose,
  onChanged,
}: QuestionsAssistantProps) {
  const { allAiProviders, selectedAIProvider } = useApp();
  const llmConfig = {
    provider: allAiProviders.find((p) => p.id === selectedAIProvider.provider),
    selectedProvider: selectedAIProvider,
  };

  const initialQuestions = useMemo<AssistQuestion[]>(
    () =>
      (template.customQuestions ?? []).map((q, i) => ({
        question: q,
        category: template.customQuestionCategories?.[i] || "behavioral",
      })),
    [template.customQuestions, template.customQuestionCategories]
  );

  const [questions, setQuestions] = useState<AssistQuestion[]>(
    initialQuestions.length ? initialQuestions : []
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Tell me how to improve this interview, e.g. “add 3 more system-design questions”, “find real questions online”, “paste a URL to crawl for questions”, or “make them harder”. You can also edit any question directly.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const company = guessCompany(template.title);

  const persist = (next: AssistQuestion[]) => {
    const capped = next.slice(0, 20);
    setQuestions(capped);
    // Keep the two arrays index-aligned: drop blank rows before saving.
    const nonEmpty = capped.filter((q) => q.question.trim());
    updateInterviewTemplateSettings(template.id, {
      customQuestions: nonEmpty.map((q) => q.question.trim()),
      customQuestionCategories: nonEmpty.map((q) => q.category),
    });
    onChanged?.();
  };

  const scrollLog = () => {
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  };

  const send = async (text?: string) => {
    const instruction = (text ?? input).trim();
    if (!instruction || busy) return;
    if (!llmConfig.provider || !selectedAIProvider?.provider) {
      toast("No AI provider configured", { variant: "error" });
      return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content: instruction }]);
    scrollLog();
    setBusy(true);
    setProgress(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await assistInterviewQuestions({
        config: llmConfig,
        instruction,
        current: questions,
        role: template.roleLevel,
        company,
        onProgress: setProgress,
        signal: ac.signal,
      });
      persist(res.questions);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            res.summary + (res.researchNote ? `\n\n· ${res.researchNote}` : ""),
        },
      ]);
    } catch (e) {
      const aborted =
        ac.signal.aborted ||
        (e instanceof DOMException && e.name === "AbortError");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: aborted
            ? "Stopped."
            : `Sorry, that didn't work: ${
                e instanceof Error ? e.message : String(e)
              }`,
        },
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
      scrollLog();
    }
  };

  const stop = () => abortRef.current?.abort();

  const chips: { label: string; icon: typeof Wand2; run: () => void }[] = [
    {
      label: "Add 3 more",
      icon: Plus,
      run: () => void send("Add 3 more high-signal questions for this role."),
    },
    {
      label: "Find questions online",
      icon: Globe,
      run: () =>
        void send(
          "Search the web (Blind / Glassdoor / Levels) for real interview questions this company/role asks and add the best ones."
        ),
    },
    {
      label: "Crawl a URL…",
      icon: Link2,
      run: () => {
        setInput("Crawl this URL and add questions: https://");
        inputRef.current?.focus();
      },
    },
    {
      label: "Make harder",
      icon: Wand2,
      run: () => void send("Make the questions harder / more senior."),
    },
    {
      label: "More system design",
      icon: Wand2,
      run: () => void send("Add 2 more system design questions."),
    },
    {
      label: "More behavioral",
      icon: Wand2,
      run: () => void send("Add 2 more behavioral questions."),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose} title="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Refine with AI
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {template.title} · {questions.length} question
            {questions.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* Live, editable question list */}
        <Card className="gap-0 p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <p className="text-sm font-medium">Questions</p>
            <Badge variant="outline" className="tabular-nums">
              {questions.length}/20
            </Badge>
          </div>
          <div className="max-h-[min(60vh,540px)] space-y-2 overflow-y-auto p-3">
            {questions.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                No questions yet. Ask the assistant to add some, or add one
                manually below.
              </p>
            ) : (
              questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-2xs tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Textarea
                      value={q.question}
                      rows={1}
                      placeholder="Question…"
                      className="max-h-48 min-h-9 resize-y field-sizing-content py-1.5 text-sm"
                      onChange={(e) => {
                        const next = [...questions];
                        next[i] = { ...next[i], question: e.target.value };
                        setQuestions(next);
                      }}
                      onBlur={() => persist(questions)}
                    />
                    <Select
                      value={q.category}
                      onValueChange={(v) => {
                        const next = [...questions];
                        next[i] = { ...next[i], category: v };
                        persist(next);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[10.5rem] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((o) => (
                          <SelectItem
                            key={o.id}
                            value={o.id}
                            className="text-xs"
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="mt-0.5 h-9 w-9 shrink-0"
                    title="Remove"
                    onClick={() =>
                      persist(questions.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
            {questions.length < 20 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() =>
                  setQuestions((prev) => [
                    ...prev,
                    { question: "", category: "behavioral" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add question
              </Button>
            ) : null}
          </div>
        </Card>

        {/* Chat / command bar */}
        <Card className="flex max-h-[min(60vh,540px)] flex-col gap-0 p-0">
          <div
            ref={logRef}
            className="flex-1 space-y-2 overflow-y-auto p-3"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                  m.role === "assistant"
                    ? "bg-muted/50"
                    : "ml-6 bg-primary/10"
                )}
              >
                {m.content}
              </div>
            ))}
            {busy ? (
              <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress || "Working…"}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-border/60 p-3">
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onClick={c.run}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  <c.icon className="h-3 w-3" />
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask for more, paste a URL to crawl, or edit…  (Enter to send · Shift+Enter for a new line)"
                rows={2}
                className="max-h-48 min-h-[2.5rem] flex-1 resize-y field-sizing-content text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  onClick={stop}
                  title="Stop the run"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  title="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
