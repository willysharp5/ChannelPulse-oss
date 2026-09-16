import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge, Button, CopyButton, Markdown, SpeakButton } from "@/components";
import { toast } from "@/components/ui/toaster";
import { useTheme } from "@/contexts";
import {
  DEFAULT_SYSTEM_DESIGN_GUIDE,
  summarizeExcalidrawElements,
  type DesignSubmission,
  type DesignVerdict,
} from "@/lib/interview";
import { sanitizeMermaidSource } from "@/lib/mermaid/sanitize";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ModelAnswer } from "@/components/interview/ModelAnswer";
import { SpeechControl } from "./SpeechControl";
import {
  Loader2,
  Send,
  PenLine,
  Download,
  Shapes,
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
import "@excalidraw/excalidraw/index.css";

// Wrap Excalidraw so we can replace its default main menu + welcome screen
// (which carry Excalidraw branding and links) with unbranded versions.
const Excalidraw = lazy(async () => {
  const mod = await import("@excalidraw/excalidraw");
  const { Excalidraw: Base, MainMenu, WelcomeScreen } = mod;
  const Wrapped = (props: any) => (
    <Base {...props}>
      <MainMenu>
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ClearCanvas />
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Heading>
            Sketch your architecture: boxes for services, arrows for data flow.
          </WelcomeScreen.Center.Heading>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    </Base>
  );
  return { default: Wrapped };
});

type ExcalidrawAPI = {
  getSceneElements: () => readonly any[];
  getAppState: () => any;
  getFiles: () => Record<string, any>;
  updateScene: (scene: { elements?: any[]; appState?: Partial<any> }) => void;
  addFiles: (files: any[]) => void;
  scrollToContent?: (
    target?: readonly any[] | any,
    opts?: {
      fitToContent?: boolean;
      fitToViewport?: boolean;
      viewportZoomFactor?: number;
      animate?: boolean;
    }
  ) => void;
};

/** Strip a ```mermaid fence (if present) and return sanitized diagram source. */
function mermaidSource(code: string): string {
  const m = code.match(/```mermaid\n([\s\S]*?)```/);
  return sanitizeMermaidSource(m ? m[1] : code).trim();
}

/** Wrap raw mermaid source in a fenced block for the Markdown renderer. */
function mermaidBlock(code: string): string {
  return "```mermaid\n" + mermaidSource(code) + "\n```";
}

/** Pull the first mermaid diagram out of a markdown string ("" if none). */
function firstMermaid(markdown: string): string {
  const m = markdown.match(/```mermaid\n([\s\S]*?)```/);
  return m ? sanitizeMermaidSource(m[1]).trim() : "";
}

function isRichSystemDesignGuide(md: string): boolean {
  return (
    md.length >= 800 &&
    /##\s*What's being tested/i.test(md) &&
    /##\s*Core knowledge/i.test(md)
  );
}

/**
 * Prefer a bank model answer when it's already a detailed guide; otherwise use
 * the full default walkthrough (optionally injecting the bank's mermaid / notes).
 */
function resolveGuideMarkdown(bank: string): string {
  const trimmed = bank.trim();
  if (isRichSystemDesignGuide(trimmed)) return trimmed;

  const mermaid = firstMermaid(trimmed);
  const notes = trimmed
    .replace(/```mermaid[\s\S]*?```/gi, "")
    .trim();

  let guide = DEFAULT_SYSTEM_DESIGN_GUIDE;
  if (mermaid) {
    guide = guide.replace(
      /```mermaid[\s\S]*?```/,
      "```mermaid\n" + mermaid + "\n```"
    );
  }
  if (notes) {
    guide += `\n\n## Problem-specific notes\n\n${notes}`;
  }
  return guide;
}

function extractGuideSections(
  markdown: string
): { title: string; body: string }[] {
  const chunks = markdown.split(/^## /m).filter((c) => c.trim());
  return chunks.map((chunk) => {
    const nl = chunk.indexOf("\n");
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const rest = (nl === -1 ? "" : chunk.slice(nl + 1)).trim();
    return { title, body: `## ${title}\n\n${rest}` };
  });
}

function elementBounds(elements: readonly any[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, midX: 0, midY: 0 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
  };
}

interface SystemDesignWorkbenchProps {
  question: string;
  /** Interviewer speech controls (icon shown next to the question). */
  speaking?: boolean;
  paused?: boolean;
  onPauseSpeech?: () => void;
  onResumeSpeech?: () => void;
  onReplaySpeech?: () => void;
  canReplay?: boolean;
  /**
   * Optional model answer / guide for this problem (from the question bank).
   * Shown on the Tips tab so steps are available before AI submit.
   */
  guideMarkdown?: string;
  /** Stable id for the current problem (resets tip reveal without fighting TTS streaming). */
  problemKey?: string | number;
  /** Restore a previously saved Excalidraw scene when revisiting a question. */
  initialSceneJson?: string;
  /** Follow-along highlight range (into `question`) while it's read aloud. */
  highlight?: { start: number; end: number } | null;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (submission: DesignSubmission) => void;
  /** Latest AI grade for the current attempt (null before the first submit). */
  feedback?: DesignVerdict | null;
  /** Live draft (sceneJson + summary) so "Next" auto-saves the diagram. */
  onDraft?: (
    draft: {
      sceneJson: string;
      elementSummary: string;
      notesAndComments: string;
    } | null
  ) => void;
}

export function SystemDesignWorkbench({
  question,
  speaking,
  paused,
  onPauseSpeech,
  onResumeSpeech,
  onReplaySpeech,
  canReplay,
  guideMarkdown = "",
  problemKey,
  initialSceneJson,
  highlight,
  disabled,
  busy,
  onSubmit,
  feedback,
  onDraft,
}: SystemDesignWorkbenchProps) {
  const { theme } = useTheme();
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const initialData = useMemo(() => {
    if (!initialSceneJson) return undefined;
    try {
      const parsed = JSON.parse(initialSceneJson) as {
        elements?: unknown[];
        appState?: Record<string, unknown>;
        files?: Record<string, unknown>;
      };
      return {
        elements: parsed.elements ?? [],
        appState: { ...(parsed.appState ?? {}), collaborators: new Map() },
        files: parsed.files,
      };
    } catch {
      return undefined;
    }
  }, [initialSceneJson]);
  const [tab, setTab] = useState<"problem" | "tips" | "feedback">("problem");
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [elementCount, setElementCount] = useState(0);
  // Progressive hint reveal (AI feedback) + tips guide reveal (pre-submit).
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [revealedGuideSteps, setRevealedGuideSteps] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [showGuideSolution, setShowGuideSolution] = useState(false);
  // Collapse the question/hints panel to give the canvas the full width.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Dismissible "passed" message shown in the Feedback panel.
  const [passDismissed, setPassDismissed] = useState(false);
  // Collapsible "How to use the canvas" reveal in the Tips & solution tab.
  const [showHowTo, setShowHowTo] = useState(false);

  const hints = feedback?.hints ?? [];
  const hintDiagrams = feedback?.hintDiagrams ?? [];
  const stepsRemaining = Math.max(0, hints.length - revealedSteps);

  const guide = useMemo(
    () => resolveGuideMarkdown(guideMarkdown),
    [guideMarkdown]
  );
  const guideSections = useMemo(() => extractGuideSections(guide), [guide]);
  const guideMermaid = useMemo(() => firstMermaid(guide), [guide]);
  const guideStepsRemaining = Math.max(
    0,
    guideSections.length - revealedGuideSteps
  );
  const revealedGuideMarkdown = useMemo(
    () =>
      guideSections
        .slice(0, revealedGuideSteps)
        .map((s) => s.body)
        .join("\n\n"),
    [guideSections, revealedGuideSteps]
  );
  const feedbackSolution = useMemo(() => {
    const fromAi = feedback?.modelAnswer?.trim() || "";
    if (isRichSystemDesignGuide(fromAi)) return fromAi;
    // Prefer the (possibly enriched) tips guide when AI answer is still thin.
    if (fromAi && !isRichSystemDesignGuide(guide)) {
      return `${fromAi}\n\n---\n\n${guide}`;
    }
    return fromAi || guide;
  }, [feedback?.modelAnswer, guide]);
  const feedbackMermaid = useMemo(
    () => firstMermaid(feedbackSolution),
    [feedbackSolution]
  );

  // New problem → reset tips / start on Problem.
  // (Declared before the feedback effect so a same-tick grade still wins the tab.)
  useEffect(() => {
    setRevealedGuideSteps(0);
    setShowGuideSolution(false);
    // Reset AI-feedback reveal only on a NEW problem (not on re-grades), so a
    // re-check keeps the hints/solution you already revealed.
    setRevealedSteps(0);
    setShowSolution(false);
    setTab("problem");
  }, [problemKey]);

  // When a fresh grade arrives, expand the panel and open Feedback. Keep the
  // revealed hints/solution across re-grades (reset only on a new problem) so
  // your generated data persists.
  useEffect(() => {
    if (feedback) {
      setPanelCollapsed(false);
      setTab("feedback");
      setPassDismissed(false);
    }
  }, [feedback]);

  const excalidrawTheme =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";

  const onChange = useCallback(
    (elements: readonly any[]) => {
      const live = elements.filter((e) => e && !e.isDeleted);
      setElementCount(live.length);
      if (!onDraft) return;
      if (live.length === 0) {
        onDraft(null);
        return;
      }
      const { elementSummary, notesAndComments } =
        summarizeExcalidrawElements(live);
      const appState = apiRef.current?.getAppState?.();
      const sceneJson = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "channelpulse-interview-practice",
        elements: live.slice(0, 200),
        appState: {
          viewBackgroundColor: appState?.viewBackgroundColor,
          gridSize: appState?.gridSize,
        },
      }).slice(0, 120_000);
      onDraft({ sceneJson, elementSummary, notesAndComments });
    },
    [onDraft]
  );

  const buildSubmission = async (): Promise<DesignSubmission> => {
    const api = apiRef.current;
    if (!api) {
      return {
        imageBase64: null,
        elementSummary: "(canvas not ready)",
        notesAndComments: "",
        sceneJson: "{}",
      };
    }

    const elements = api.getSceneElements().filter((e) => e && !e.isDeleted);
    const appState = api.getAppState();
    const files = api.getFiles();

    const { elementSummary, notesAndComments } =
      summarizeExcalidrawElements(elements);

    const sceneJson = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "channelpulse-interview-practice",
      elements: elements.slice(0, 200),
      appState: {
        viewBackgroundColor: appState?.viewBackgroundColor,
        gridSize: appState?.gridSize,
      },
    }).slice(0, 120_000);

    let imageBase64: string | null = null;
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      if (elements.length > 0) {
        const blob = await exportToBlob({
          elements,
          appState: {
            ...appState,
            exportWithDarkMode: excalidrawTheme === "dark",
            exportBackground: true,
          },
          files,
          mimeType: "image/png",
          exportPadding: 24,
        });
        imageBase64 = await blobToBase64(blob);
      }
    } catch (err) {
      console.warn("Failed to export design PNG:", err);
    }

    return { imageBase64, elementSummary, notesAndComments, sceneJson };
  };

  const handleSubmit = async () => {
    if (disabled || busy || exporting) return;
    setExporting(true);
    try {
      const submission = await buildSubmission();
      onSubmit(submission);
    } finally {
      setExporting(false);
    }
  };

  // Download the current diagram as a PNG to a path the user picks (desktop
  // save dialog). Not uploaded anywhere — it's a local file download only.
  const handleDownloadPng = async () => {
    const api = apiRef.current;
    if (!api) {
      toast("Canvas not ready", {
        description: "Wait a moment and try again.",
        variant: "error",
      });
      return;
    }
    const elements = api.getSceneElements().filter((e) => e && !e.isDeleted);
    if (elements.length === 0) {
      toast("Nothing to download", {
        description: "Draw something on the canvas first.",
        variant: "info",
      });
      return;
    }
    if (downloading) return;
    setDownloading(true);
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements,
        appState: {
          ...api.getAppState(),
          exportWithDarkMode: excalidrawTheme === "dark",
          exportBackground: true,
        },
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 24,
      });
      const filename = `system-design-${Date.now()}.png`;
      const bytes = new Uint8Array(await blob.arrayBuffer());

      let path: string | null = null;
      let usedNativeSave = false;
      try {
        path = await save({
          defaultPath: filename,
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
        usedNativeSave = true;
      } catch {
        // Not running in Tauri / dialog unavailable — use browser download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast("PNG downloaded", {
          description: "Check your Downloads folder.",
          variant: "success",
        });
      }

      if (usedNativeSave) {
        if (!path) {
          toast("Download cancelled", { variant: "info" });
          return;
        }
        await invoke("write_file_bytes", {
          path,
          contents: Array.from(bytes),
        });
        toast("PNG downloaded", {
          description: `Saved to ${path}`,
          variant: "success",
        });
      }
    } catch (err) {
      console.warn("Failed to download design PNG:", err);
      toast("Couldn't download PNG", {
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  };

  const [inserting, setInserting] = useState(false);

  // Convert a hint's mermaid diagram to Excalidraw shapes and drop them onto
  // the center of the visible canvas so the user can build on it.
  const addDiagramToCanvas = async (mermaid: string) => {
    const api = apiRef.current;
    if (!api || inserting) return;
    const source = mermaidSource(mermaid);
    if (!source) return;
    setInserting(true);
    try {
      const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] =
        await Promise.all([
          import("@excalidraw/mermaid-to-excalidraw"),
          import("@excalidraw/excalidraw"),
        ]);
      const { elements: skeleton, files } = await parseMermaidToExcalidraw(
        source
      );
      const converted = convertToExcalidrawElements(skeleton as any);

      const existing = api
        .getSceneElements()
        .filter((e) => e && !e.isDeleted);

      // Place the new diagram at the center of the current viewport.
      const bounds = elementBounds(converted);
      const appState = api.getAppState();
      const zoom = appState?.zoom?.value ?? 1;
      const viewW = appState?.width ?? 800;
      const viewH = appState?.height ?? 600;
      const scrollX = appState?.scrollX ?? 0;
      const scrollY = appState?.scrollY ?? 0;
      const viewCenterX = -scrollX + viewW / 2 / zoom;
      const viewCenterY = -scrollY + viewH / 2 / zoom;
      const dx = viewCenterX - bounds.midX;
      const dy = viewCenterY - bounds.midY;

      const shifted = converted.map((el: any) => ({
        ...el,
        x: (el.x ?? 0) + dx,
        y: (el.y ?? 0) + dy,
      }));

      api.updateScene({ elements: [...existing, ...shifted] });
      if (files) api.addFiles(Object.values(files));
      setElementCount(existing.length + shifted.length);

      // Keep the inserted diagram centered in the viewport.
      requestAnimationFrame(() => {
        try {
          api.scrollToContent?.(shifted, {
            fitToContent: true,
            animate: true,
            viewportZoomFactor: 0.85,
          });
        } catch {
          // Older Excalidraw builds may lack scrollToContent — placement is enough.
        }
      });
    } catch (err) {
      console.warn("Failed to insert mermaid diagram into canvas:", err);
    } finally {
      setInserting(false);
    }
  };

  const locked = disabled || busy || exporting;

  return (
    <div className="flex h-[min(78vh,840px)] min-h-[32.5rem] overflow-hidden rounded-xl border border-border/60 bg-background">
      {/* Problem pane */}
      {panelCollapsed ? null : (
      <aside className="flex w-full max-w-md shrink-0 flex-col border-r border-border/60 sm:w-[36%]">
        <div className="flex items-center gap-1 border-b border-border/60 px-3 pt-2">
          {(
            [
              ["problem", "Problem"],
              ["tips", "Tips & answer"],
              ...(feedback ? ([["feedback", "Feedback"]] as const) : []),
            ] as const
          ).map(([id, label]) => (
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
          ))}
          <button
            type="button"
            onClick={() => setPanelCollapsed(true)}
            title="Collapse panel: more room for the canvas"
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
            </>
          ) : tab === "tips" ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="border-b border-border/50 pb-3">
                <button
                  type="button"
                  onClick={() => setShowHowTo((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-xs font-medium text-foreground transition-colors hover:text-muted-foreground"
                >
                  <span>How to use the canvas</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      showHowTo && "rotate-180"
                    )}
                  />
                </button>
                {showHowTo ? (
                  <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs">
                    <li>Sketch components as boxes (services, DBs, queues, clients).</li>
                    <li>Connect them with arrows for request / data flow.</li>
                    <li>Label each box; the AI grades from your diagram image.</li>
                    <li>Call out bottlenecks, caching, and failure modes when relevant.</li>
                  </ul>
                ) : null}
              </div>

              <div className="space-y-3">
                <div>
                  <p className="font-medium text-foreground">
                    Answer walkthrough
                  </p>
                  <p className="mt-1 text-xs">
                    Study this like a prep guide: what’s tested, architecture,
                    core knowledge, worked example, pitfalls, and trade-offs.
                    You don’t need to submit to AI first.
                  </p>
                </div>

                {revealedGuideSteps > 0 && !showGuideSolution ? (
                  <div className="space-y-2">
                    <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sections {revealedGuideSteps}/{guideSections.length}
                      {guideSections[revealedGuideSteps - 1]
                        ? ` · ${guideSections[revealedGuideSteps - 1].title}`
                        : ""}
                    </p>
                    <ModelAnswer
                      markdown={revealedGuideMarkdown}
                      category="system_design"
                      className="border-border/60 bg-background p-3"
                    />
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowGuideSolution(false);
                      setRevealedGuideSteps((s) => Math.max(0, s - 1));
                    }}
                    disabled={revealedGuideSteps === 0 && !showGuideSolution}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Back
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {revealedGuideSteps === 0
                      ? `${guideSections.length} sections`
                      : `Section ${revealedGuideSteps} of ${guideSections.length}`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowGuideSolution(false);
                      setRevealedGuideSteps((s) =>
                        Math.min(s + 1, guideSections.length)
                      );
                    }}
                    disabled={guideStepsRemaining === 0}
                  >
                    Next section
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={showGuideSolution ? "outline" : "default"}
                    className="ml-auto"
                    onClick={() => setShowGuideSolution((v) => !v)}
                  >
                    {showGuideSolution ? (
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

                {showGuideSolution ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                        Answer
                      </div>
                      <div className="flex items-center gap-1">
                        <SpeakButton content={guide} skipCode />
                        <CopyButton
                          content={guide}
                          copyMessage="Answer copied"
                        />
                      </div>
                    </div>
                    <ModelAnswer
                      markdown={guide}
                      category="system_design"
                      className="border-primary/20 bg-primary/5 p-3"
                    />
                    {guideMermaid ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => void addDiagramToCanvas(guideMermaid)}
                        disabled={inserting}
                      >
                        <Shapes className="h-3.5 w-3.5" />
                        {inserting ? "Adding…" : "Add architecture to canvas"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {!showGuideSolution && guideMermaid ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => void addDiagramToCanvas(guideMermaid)}
                    disabled={inserting}
                  >
                    <Shapes className="h-3.5 w-3.5" />
                    {inserting ? "Adding…" : "Add starter diagram to canvas"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : feedback ? (
            <div className="space-y-3 text-sm">
              {feedback.passed && !passDismissed ? (
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
              <div className="flex items-center gap-2">
                <Badge
                  variant={feedback.passed ? "secondary" : "destructive"}
                  className="tabular-nums"
                >
                  {feedback.passed ? "Pass" : "Needs work"} · {feedback.score}/5
                </Badge>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                {feedback.feedback}
              </p>

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

              {revealedSteps > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Steps to improve your design
                  </p>
                  <ol className="list-decimal space-y-3 pl-4">
                    {hints.slice(0, revealedSteps).map((h, i) => (
                      <li key={i} className="space-y-1.5">
                        <span>{h}</span>
                        {hintDiagrams[i] ? (
                          <div className="space-y-1">
                            <div className="overflow-x-auto rounded-lg border border-border/60 bg-background p-2 [&_.mermaid]:my-0">
                              <Markdown>{mermaidBlock(hintDiagrams[i])}</Markdown>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                void addDiagramToCanvas(hintDiagrams[i])
                              }
                              disabled={inserting}
                            >
                              <Shapes className="h-3.5 w-3.5" />
                              Add to canvas
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRevealedSteps((s) => Math.max(0, s - 1))}
                  disabled={revealedSteps === 0}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {revealedSteps === 0
                    ? `${hints.length} hints`
                    : `Hint ${revealedSteps} of ${hints.length}`}
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
                  Next hint
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={showSolution ? "outline" : "default"}
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

              {showSolution ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                      Answer
                    </div>
                    <div className="flex items-center gap-1">
                      <SpeakButton content={feedbackSolution} skipCode />
                      <CopyButton
                        content={feedbackSolution}
                        copyMessage="Answer copied"
                      />
                    </div>
                  </div>
                  <ModelAnswer
                    markdown={feedbackSolution}
                    category="system_design"
                    className="border-primary/20 bg-primary/5 p-3"
                  />
                  {feedbackMermaid ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => void addDiagramToCanvas(feedbackMermaid)}
                      disabled={inserting}
                    >
                      <Shapes className="h-3.5 w-3.5" />
                      Add architecture to canvas
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Tweak your diagram (and notes/comments on the canvas), then hit
                Re-check, or open the answer anytime.
              </p>
            </div>
          ) : null}
        </div>
      </aside>
      )}

      {/* Design canvas */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {panelCollapsed ? (
              <button
                type="button"
                onClick={() => setPanelCollapsed(false)}
                title="Show the question & hints panel"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : null}
            <PenLine className="h-4 w-4" />
            <span>Your design canvas</span>
            <Badge variant="outline" className="text-3xs tabular-nums">
              {elementCount} shapes
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDownloadPng()}
              disabled={elementCount === 0 || downloading}
              title="Download this diagram as a PNG to your computer"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? "Downloading…" : "Download PNG"}
            </Button>
            <Button
              size="sm"
              variant={feedback ? "outline" : "default"}
              onClick={() => void handleSubmit()}
              disabled={locked || elementCount === 0}
              title="Check this design with AI and open Feedback"
            >
              {busy || exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {busy
                ? "Checking…"
                : exporting
                  ? "Exporting…"
                  : feedback
                    ? "Re-check"
                    : "Check"}
            </Button>
          </div>
        </div>

        <p className="border-b border-border/60 bg-muted/30 px-4 py-1.5 text-2xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Check</strong>{" "}
          grades this design (including notes/comments on the canvas) and opens
          the Feedback tab. Check as many times as you like. When you’re done,
          use{" "}
          <strong className="font-medium text-foreground">End &amp; assess</strong>{" "}
          (top right) to finish and save your session.
        </p>

        <div className="cp-excalidraw relative min-h-0 flex-1 bg-muted/20 [&_.excalidraw]:h-full [&_.excalidraw]:w-full">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading whiteboard…
              </div>
            }
          >
            <Excalidraw
              key={String(problemKey ?? question.slice(0, 80))}
              theme={excalidrawTheme}
              initialData={initialData}
              excalidrawAPI={(api: unknown) => {
                apiRef.current = api as unknown as ExcalidrawAPI;
              }}
              onChange={onChange}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  export: false,
                  saveAsImage: true,
                },
              }}
            />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
