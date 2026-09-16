import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Markdown } from "@/components/Markdown";
import { normalizeAnswerMarkdown, type QuestionCategory } from "@/lib/interview";
import { setupMonaco } from "@/lib/monaco/setup";
import { cn } from "@/lib/utils";

setupMonaco();

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string };

/** Split markdown into prose/mermaid chunks and fenced code blocks. */
export function splitModelAnswer(markdown: string): Segment[] {
  const parts: Segment[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (m.index > last) {
      const text = markdown.slice(last, m.index);
      if (text.trim()) parts.push({ type: "text", content: text });
    }
    const language = (m[1] || "text").trim() || "text";
    const content = m[2].replace(/\n$/, "");
    // Mermaid stays in Markdown so Streamdown can render the diagram.
    if (language.toLowerCase() === "mermaid") {
      parts.push({ type: "text", content: m[0] });
    } else {
      parts.push({ type: "code", language, content });
    }
    last = m.index + m[0].length;
  }
  if (last < markdown.length) {
    const text = markdown.slice(last);
    if (text.trim()) parts.push({ type: "text", content: text });
  }
  if (parts.length === 0 && markdown.trim()) {
    parts.push({ type: "text", content: markdown });
  }
  return parts;
}

function mapMonacoLanguage(lang: string): string {
  const l = lang.toLowerCase();
  if (l === "js" || l === "node") return "javascript";
  if (l === "ts" || l === "tsx") return "typescript";
  if (l === "py") return "python";
  if (l === "sh" || l === "shell" || l === "bash" || l === "zsh") return "shell";
  if (l === "yml") return "yaml";
  if (l === "c++" || l === "cpp") return "cpp";
  if (l === "csharp" || l === "c#") return "csharp";
  return l || "plaintext";
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

/** Read-only IDE-style code panel for model solutions. */
function CodePanel({ language, code }: { language: string; code: string }) {
  const dark = useIsDarkTheme();
  const monacoLang = mapMonacoLanguage(language);
  const lines = Math.max(1, code.split("\n").length);
  const height = Math.min(Math.max(lines * 19 + 20, 96), 440);

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-[#1e1e1e] shadow-sm dark:border-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#252526] px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ff5f56]" aria-hidden />
        <span className="size-2.5 rounded-full bg-[#ffbd2e]" aria-hidden />
        <span className="size-2.5 rounded-full bg-[#27c93f]" aria-hidden />
        <span className="ml-2 truncate font-mono text-2xs text-white/55">
          solution.{monacoLang === "javascript" ? "js" : monacoLang === "typescript" ? "ts" : monacoLang === "python" ? "py" : monacoLang}
        </span>
        <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-white/45">
          {language || "code"}
        </span>
      </div>
      <Editor
        height={height}
        language={monacoLang}
        value={code}
        theme={dark ? "vs-dark" : "vs-dark"}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          lineNumbers: "on",
          folding: false,
          renderLineHighlight: "none",
          fontSize: 14,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          padding: { top: 10, bottom: 10 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          contextmenu: false,
          domReadOnly: true,
        }}
      />
    </div>
  );
}

const proseClass = cn(
  "cp-md text-base leading-7 text-foreground/90",
  "[&_p]:mb-0 [&_p+p]:mt-4",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:tracking-wide [&_h2]:text-foreground",
  "[&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-wide [&_h3]:text-foreground",
  "[&_hr]:my-5 [&_hr]:border-border/60",
  "[&_.mermaid]:my-5"
);

interface ModelAnswerProps {
  markdown: string;
  /** When known, tunes spacing / emphasis (behavioral steps, coding chrome). */
  category?: QuestionCategory | string;
  className?: string;
}

/** Clean, scannable model-answer view: IDE code panels + open step layout + Mermaid. */
export function ModelAnswer({ markdown, category, className }: ModelAnswerProps) {
  const normalized = useMemo(
    () => normalizeAnswerMarkdown(markdown),
    [markdown]
  );
  const segments = useMemo(() => splitModelAnswer(normalized), [normalized]);
  const isBehavioral = category === "behavioral";
  const isCoding = category === "coding";
  const isSystemDesign = category === "system_design";

  return (
    <div
      className={cn(
        "space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-5",
        isBehavioral && "space-y-5",
        isSystemDesign && "space-y-5",
        className
      )}
    >
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodePanel key={i} language={seg.language} code={seg.content} />
        ) : (
          <div
            key={i}
            className={cn(
              proseClass,
              isBehavioral && "[&_p]:leading-8",
              isCoding && "text-sm leading-6",
              isSystemDesign &&
                "[&_h2]:mt-6 [&_h2]:border-b [&_h2]:border-border/50 [&_h2]:pb-1.5 [&_h2]:text-sm [&_h2]:uppercase [&_h2]:tracking-wide [&_p]:leading-7"
            )}
          >
            <Markdown>{seg.content}</Markdown>
          </div>
        )
      )}
    </div>
  );
}
