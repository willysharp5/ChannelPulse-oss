import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  AlertBanner,
  Badge,
  Button,
  CopyButton,
  Markdown,
  Select,
  SpeakButton,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import {
  defaultCodingLanguage,
  defaultCodingStarter,
  preloadPython,
  preloadSql,
  runCode,
  SQL_FIXTURE_TABLES,
  type CodeRunResult,
  type CodingLanguage,
  type CodingVerdict,
} from "@/lib/interview";
import { setupMonaco } from "@/lib/monaco/setup";
import { SpeechControl } from "./SpeechControl";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Play,
  Send,
  RotateCcw,
  Lightbulb,
  Code2,
  ClipboardPaste,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  CheckCircle2,
  CircleX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";

setupMonaco();

export interface CodeSubmission {
  language: CodingLanguage;
  code: string;
  run: CodeRunResult | null;
}

interface CodeWorkbenchProps {
  question: string;
  /** Follow-along highlight range (into `question`) while it's read aloud. */
  highlight?: { start: number; end: number } | null;
  /** Interviewer speech controls (icon shown next to the question). */
  speaking?: boolean;
  paused?: boolean;
  onPauseSpeech?: () => void;
  onResumeSpeech?: () => void;
  onReplaySpeech?: () => void;
  canReplay?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (submission: CodeSubmission) => void;
  /** Latest AI grade for the current attempt (null before the first submit). */
  feedback?: CodingVerdict | null;
  /** Request on-demand coaching hints (no grade). Passes the current code. */
  onRequestHints?: (code: string) => void;
  /** Whether a hints request is in flight. */
  hintsLoading?: boolean;
  /** Live draft (auto-saved when advancing without grading). Null = nothing. */
  onDraft?: (submission: CodeSubmission | null) => void;
  /** Prefill when revisiting a past attempt (pair with remount `key`). */
  initialCode?: string;
  initialLanguage?: CodingLanguage;
  /**
   * The round's own language, when the round has one (a SQL round). Beats
   * guessing from the question text, which can't tell that an improvised
   * question in a SQL round is still a SQL question.
   */
  roundLanguage?: CodingLanguage;
}

/** Pull the first fenced code block out of a markdown model answer. */
function extractSolutionCode(markdown: string): string {
  const m = markdown.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m ? m[1] : markdown).trim();
}

function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function CodeWorkbench({
  question,
  highlight,
  speaking,
  paused,
  onPauseSpeech,
  onResumeSpeech,
  onReplaySpeech,
  canReplay,
  disabled,
  busy,
  onSubmit,
  feedback,
  onRequestHints,
  hintsLoading,
  onDraft,
  initialCode,
  initialLanguage,
  roundLanguage,
}: CodeWorkbenchProps) {
  const tipsOnly = !!feedback?.tipsOnly;
  // A real pass/fail grade (as opposed to on-demand tips).
  const graded = !!feedback && !tipsOnly;
  // Which editor this question wants. A round that declares its language wins:
  // a SQL round is a SQL round even when the interviewer improvises a question
  // that never says "SQL", and the question text is all `defaultCodingLanguage`
  // has to go on.
  const languageFor = (q: string): CodingLanguage =>
    roundLanguage ?? defaultCodingLanguage(q);
  // A SQL round has to open in SQL — a JavaScript file with SQL in it can't run.
  const [language, setLanguage] = useState<CodingLanguage>(
    initialLanguage ?? languageFor(question)
  );
  const starter = useMemo(
    () => defaultCodingStarter(question, language),
    [question, language]
  );
  const [code, setCode] = useState(initialCode ?? starter);
  const [run, setRun] = useState<CodeRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"problem" | "hints" | "feedback">("problem");
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Collapsible "How to use the editor" inside the Get hints tab.
  const [showHowTo, setShowHowTo] = useState(false);
  // Dismissible "passed" message shown in the Feedback panel.
  const [passDismissed, setPassDismissed] = useState(false);

  // Push the current code up as a live draft so "Next" auto-saves it. Treat an
  // untouched starter template as "nothing to save".
  useEffect(() => {
    if (!onDraft) return;
    const trimmed = code.trim();
    const isStarter = trimmed === defaultCodingStarter(question, language).trim();
    onDraft(trimmed && !isStarter ? { language, code, run } : null);
  }, [code, language, run, question, onDraft]);
  const dark = useIsDarkTheme();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => void>(() => {});

  const getValue = () => editorRef.current?.getValue() ?? code;
  const hints = feedback?.hints ?? [];
  const stepsRemaining = Math.max(0, hints.length - revealedSteps);
  const locked = disabled || busy;

  // Reset when the problem changes (or when remounted for a different slot).
  useEffect(() => {
    const detected = languageFor(question);
    // Keep a manual JavaScript/Python choice across questions, but never leave
    // the editor in the wrong family: a SQL question needs SQL, and a coding
    // question can't be answered in SQL.
    const next =
      initialLanguage ??
      (detected === "sql" || language === "sql" ? detected : language);
    setLanguage(next);
    if (next === "sql") preloadSql();
    if (next === "python") preloadPython();
    setCode(initialCode ?? defaultCodingStarter(question, next));
    setRun(null);
    setError(null);
    setRevealedSteps(0);
    setShowSolution(false);
    setTab("problem");
    setPassDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  // Switch language: swap the editor language + starter template.
  const changeLanguage = (l: CodingLanguage) => {
    if (l === language) return;
    setLanguage(l);
    setCode(defaultCodingStarter(question, l));
    setRun(null);
    setError(null);
    // Warm up the wasm sandboxes (each downloads once) so the first run is fast.
    if (l === "python") preloadPython();
    if (l === "sql") preloadSql();
  };

  // When new feedback arrives: on-demand tips → Get hints tab; a real grade →
  // Feedback tab.
  useEffect(() => {
    if (feedback) {
      // Keep revealed hints/solution across re-grades (only reset on a new
      // question, handled by the question effect above) so the data persists.
      setTab(feedback.tipsOnly ? "hints" : "feedback");
      setPassDismissed(false);
    }
  }, [feedback]);

  /** Insert code at the current cursor line in the editor. */
  const insertIntoEditor = (text: string) => {
    const ed = editorRef.current;
    if (!ed || locked) return;
    const sel = ed.getSelection();
    if (!sel) return;
    ed.executeEdits("insert-code", [
      { range: sel, text: text.replace(/\s+$/, "") + "\n", forceMoveMarkers: true },
    ]);
    ed.pushUndoStop();
    ed.focus();
  };

  const handleRun = async () => {
    if (locked || running) return;
    const source = getValue();
    setRunning(true);
    setError(null);
    try {
      setRun(await runCode(language, source));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  runRef.current = () => void handleRun();

  const handleSubmit = () => {
    const source = getValue();
    if (locked || !source.trim()) return;
    onSubmit({ language, code: source, run });
  };

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    ed.addAction({
      id: "interview-run-code",
      label: "Run code",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => runRef.current(),
    });
    ed.focus();
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "rounded-t-md px-3 py-2 text-xs font-medium transition-colors",
        tab === id
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-[min(78vh,840px)] min-h-[32.5rem] overflow-hidden rounded-xl border border-border/60 bg-background">
      {/* Problem / Tips / Feedback panel */}
      {panelCollapsed ? null : (
        <aside className="flex w-full max-w-md shrink-0 flex-col border-r border-border/60 sm:w-[38%]">
          <div className="flex items-center gap-1 border-b border-border/60 px-3 pt-2">
            {tabBtn("problem", "Problem")}
            {tabBtn("hints", "Tips & solution")}
            {graded ? tabBtn("feedback", "Feedback") : null}
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              title="Collapse panel: more room for the editor"
              className="ml-auto rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {tab === "problem" ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SpeechControl
                    speaking={speaking}
                    paused={paused}
                    onPause={onPauseSpeech}
                    onResume={onResumeSpeech}
                    onReplay={onReplaySpeech}
                    canReplay={canReplay}
                    className="ml-auto"
                  />
                </div>
                <p className="whitespace-pre-wrap text-base leading-relaxed">
                  {highlight ? (
                    <>
                      <span className="text-muted-foreground/70">
                        {question.slice(0, highlight.start)}
                      </span>
                      <mark className="rounded bg-primary/20 px-0.5 font-medium text-foreground">
                        {question.slice(highlight.start, highlight.end)}
                      </mark>
                      <span className="text-muted-foreground/50">
                        {question.slice(highlight.end)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{question}</span>
                  )}
                </p>
                {language === "sql" ? (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sample database (SQLite)
                    </p>
                    <ul className="space-y-1.5 text-xs">
                      {SQL_FIXTURE_TABLES.map((t) => (
                        <li key={t.name}>
                          <code className="font-mono text-foreground">
                            {t.name}({t.columns})
                          </code>
                          <span className="block text-muted-foreground">
                            {t.note}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : tab === "hints" ? (
              <div className="space-y-3 text-sm">
                {hints.length ? (
                  <>
                    {revealedSteps > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Steps
                        </p>
                        <ol className="list-decimal space-y-3 pl-4">
                          {hints.slice(0, revealedSteps).map((h, i) => {
                            const snippet = extractSolutionCode(h);
                            const hasCode = /```/.test(h);
                            return (
                              <li key={i} className="space-y-1.5">
                                <span>
                                  {hasCode ? h.split("```")[0].trim() : h}
                                </span>
                                {hasCode && snippet ? (
                                  <div className="space-y-1">
                                    <div className="overflow-x-auto rounded-lg border border-border/60 bg-background p-2">
                                      <Markdown>
                                        {"```" + language + "\n" + snippet + "\n```"}
                                      </Markdown>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => insertIntoEditor(snippet)}
                                      disabled={locked}
                                    >
                                      <ClipboardPaste className="h-3.5 w-3.5" />
                                      Insert into editor
                                    </Button>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        Reveal hints one step at a time, or jump to the full
                        solution.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRevealedSteps((s) => Math.max(0, s - 1))
                        }
                        disabled={revealedSteps === 0}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Back
                      </Button>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {revealedSteps === 0
                          ? `${hints.length} steps`
                          : `Step ${revealedSteps} of ${hints.length}`}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRevealedSteps((s) => Math.min(s + 1, hints.length))
                        }
                        disabled={stepsRemaining === 0}
                      >
                        Next step
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={showSolution ? "outline" : "default"}
                        className="ml-auto"
                        onClick={() => setShowSolution((v) => !v)}
                      >
                        {showSolution ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" />
                            Hide answer
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            Show answer
                          </>
                        )}
                      </Button>
                    </div>
                    {showSolution && feedback?.modelAnswer ? (
                      <div className="space-y-1 rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                            Answer
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                insertIntoEditor(
                                  extractSolutionCode(feedback.modelAnswer)
                                )
                              }
                              disabled={locked}
                            >
                              <ClipboardPaste className="h-3.5 w-3.5" />
                              Insert into editor
                            </Button>
                            <SpeakButton content={feedback.modelAnswer} skipCode />
                            <CopyButton
                              content={extractSolutionCode(feedback.modelAnswer)}
                              copyMessage="Answer copied"
                            />
                          </div>
                        </div>
                        <div className="leading-relaxed">
                          <Markdown>{feedback.modelAnswer}</Markdown>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      Stuck? Get step-by-step hints (and the full solution), no
                      grade needed.
                    </p>
                    {onRequestHints ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onRequestHints(getValue())}
                        disabled={locked || !!hintsLoading}
                      >
                        {hintsLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Lightbulb className="h-4 w-4" />
                        )}
                        {hintsLoading ? "Getting hints…" : "Get hints"}
                      </Button>
                    ) : null}
                  </div>
                )}

                <div className="border-t border-border/50 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowHowTo((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>How to use the editor</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        showHowTo && "rotate-180"
                      )}
                    />
                  </button>
                  {showHowTo ? (
                    <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                      {language === "sql" ? (
                        <li>
                          Write your query on the right and Run it; it executes
                          against the sample tables, which are reset before every
                          run.
                        </li>
                      ) : (
                        <li>Write your solution on the right, then Run it in the sandbox.</li>
                      )}
                      <li>Tap <strong>Get hints</strong> for step-by-step tips and a solution, no grade required.</li>
                      <li>Tap <strong>Grade</strong> for a pass/fail.</li>
                      <li>Use <strong>Insert into editor</strong> to drop a hint or the answer at your cursor.</li>
                      <li>Press ⌘/Ctrl+Enter to run.</li>
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : feedback ? (
              <div className="space-y-3 text-sm">
                {graded && feedback.passed && !passDismissed ? (
                  <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <p className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Passed: score {feedback.score}/5. Nice work!
                    </p>
                    <button
                      type="button"
                      onClick={() => setPassDismissed(true)}
                      title="Dismiss"
                      className="shrink-0 rounded p-0.5 text-emerald-600/70 transition-colors hover:text-emerald-600 dark:text-emerald-400/70 dark:hover:text-emerald-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                <Badge
                  variant={feedback.passed ? "secondary" : "destructive"}
                  className="tabular-nums"
                >
                  {feedback.passed ? "Pass" : "Needs work"} · {feedback.score}/5
                </Badge>
                {feedback.feedback ? (
                  <p className="leading-relaxed text-muted-foreground">
                    {feedback.feedback}
                  </p>
                ) : null}

                {feedback.strengths.length ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      What you did well
                    </p>
                    <ul className="space-y-1.5">
                      {feedback.strengths.map((s) => (
                        <li
                          key={s}
                          className="flex items-start gap-2 text-sm text-foreground/90"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {feedback.improvements.length ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      {feedback.score < 5
                        ? `Why not 5/5: work on these`
                        : "Stretch improvements"}
                    </p>
                    <ul className="space-y-1.5">
                      {feedback.improvements.map((s) => (
                        <li
                          key={s}
                          className="flex items-start gap-2 text-sm text-foreground/90"
                        >
                          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="text-xs text-muted-foreground">
                  Want step-by-step help? Open the{" "}
                  <strong>Get hints</strong> tab. Edit your code and hit{" "}
                  <strong>Re-grade</strong> anytime.
                </p>
              </div>
            ) : null}
          </div>
        </aside>
      )}

      {/* Code editor */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {panelCollapsed ? (
              <button
                type="button"
                onClick={() => setPanelCollapsed(false)}
                title="Show the problem & hints panel"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : null}
            <Code2 className="h-4 w-4" />
            <span>{language === "sql" ? "SQL editor" : "Code editor"}</span>
            <Select
              value={language}
              onValueChange={(v) => changeLanguage(v as CodingLanguage)}
              disabled={locked}
            >
              <SelectTrigger size="sm" className="h-7 w-[8.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
                <SelectItem value="sql">SQL (SQLite)</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-3xs">
              {language === "sql" ? "in-memory SQLite" : "runs in sandbox"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRun}
              disabled={locked || running || !code.trim()}
              title={
                language === "python"
                  ? "Run in the Python (Pyodide) sandbox. First run downloads Python (⌘/Ctrl+Enter)"
                  : language === "sql"
                    ? "Run against the sample SQLite database. First run downloads SQLite (⌘/Ctrl+Enter)"
                    : "Run in the JavaScript sandbox (⌘/Ctrl+Enter)"
              }
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {running ? "Running…" : language === "sql" ? "Run query" : "Run"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setCode(defaultCodingStarter(question, language));
                setRun(null);
              }}
              disabled={locked || running}
              title="Reset to starter template"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              variant={graded ? "outline" : "default"}
              onClick={handleSubmit}
              disabled={locked || running || !code.trim()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {busy ? "Grading…" : graded ? "Re-grade" : "Grade"}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="px-3 pt-3">
            <AlertBanner
              variant="error"
              title="Couldn’t run code"
              description={error}
              onClose={() => setError(null)}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            path={`solution.${
              language === "python" ? "py" : language === "sql" ? "sql" : "js"
            }`}
            theme={dark ? "vs-dark" : "vs"}
            value={code}
            onChange={(value) => setCode(value ?? "")}
            onMount={handleMount}
            loading={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading editor…
              </div>
            }
            options={{
              readOnly: locked,
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              formatOnPaste: true,
              padding: { top: 12, bottom: 12 },
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              quickSuggestions: true,
              folding: true,
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>

        {/* Console */}
        <div className="shrink-0 space-y-1.5 border-t border-border/60 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {language === "sql" ? "Result" : "Console"}
              <span className="ml-1.5 font-normal">· ⌘/Ctrl+Enter to run</span>
            </p>
            {run ? (
              <Badge
                variant={run.ok && !run.timedOut ? "secondary" : "destructive"}
                className="text-3xs tabular-nums"
              >
                {run.timedOut
                  ? "timed out"
                  : run.ok
                    ? `ok · ${run.durationMs}ms`
                    : `error · ${run.durationMs}ms`}
              </Badge>
            ) : null}
          </div>
          <pre className="max-h-32 min-h-[3.5rem] overflow-auto rounded-lg border border-border/60 bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {run
              ? [
                  run.stdout.trim() ? run.stdout.trimEnd() : "(no stdout)",
                  run.stderr.trim()
                    ? `\n--- stderr ---\n${run.stderr.trimEnd()}`
                    : "",
                ].join("")
              : language === "sql"
                ? "Your result set appears here after you Run the query."
                : "Output appears here after you click Run."}
          </pre>
        </div>
      </section>
    </div>
  );
}
