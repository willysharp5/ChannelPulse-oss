import { useEffect, useRef } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { marked } from "marked";
import TurndownService from "turndown";
import { cn } from "@/lib/utils";

// Markdown <-> HTML so the editor stays compatible with the app's markdown
// storage + rendering. Quill edits HTML internally; we round-trip to markdown.
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

function mdToHtml(md: string): string {
  try {
    return marked.parse(md || "", { async: false }) as string;
  } catch {
    return md || "";
  }
}

function htmlToMd(html: string): string {
  try {
    return turndown.turndown(html || "").trim();
  } catch {
    return "";
  }
}

const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote", "code-block"],
  ["link"],
  ["clean"],
];

interface RichTextEditorProps {
  /** Content as Markdown. */
  value: string;
  /** Emits Markdown on every edit. */
  onChange: (markdown: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Minimum editor height in px. */
  minHeight?: number;
  /** Fired on ⌘/Ctrl+Enter. */
  onSubmit?: () => void;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  minHeight = 140,
  onSubmit,
}: RichTextEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  // The last Markdown we emitted — lets us skip re-seeding on our own edits.
  const lastMdRef = useRef<string>("");
  // True while we programmatically set content (so we don't echo onChange).
  const settingRef = useRef(false);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // Init once.
  useEffect(() => {
    if (!hostRef.current || quillRef.current) return;
    const q = new Quill(hostRef.current, {
      theme: "snow",
      placeholder,
      modules: {
        toolbar: TOOLBAR,
        keyboard: {
          bindings: {
            submit: {
              key: "Enter",
              shortKey: true,
              handler: () => {
                onSubmitRef.current?.();
                return false;
              },
            },
          },
        },
      },
    });
    quillRef.current = q;

    settingRef.current = true;
    q.clipboard.dangerouslyPasteHTML(mdToHtml(value));
    settingRef.current = false;
    lastMdRef.current = htmlToMd(q.root.innerHTML);

    q.on("text-change", () => {
      if (settingRef.current) return;
      const md = htmlToMd(q.root.innerHTML);
      lastMdRef.current = md;
      onChangeRef.current(md);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. reset/clear) → re-seed, but not for our own edits.
  useEffect(() => {
    const q = quillRef.current;
    if (!q) return;
    if ((value || "") === (lastMdRef.current || "")) return;
    const sel = q.getSelection();
    settingRef.current = true;
    q.clipboard.dangerouslyPasteHTML(mdToHtml(value));
    settingRef.current = false;
    lastMdRef.current = htmlToMd(q.root.innerHTML);
    if (sel) {
      try {
        q.setSelection(sel.index, sel.length);
      } catch {
        // selection may be out of range after re-seed
      }
    }
  }, [value]);

  useEffect(() => {
    quillRef.current?.enable(!disabled);
  }, [disabled]);

  return (
    <div
      className={cn(
        "cp-quill overflow-hidden rounded-xl border border-border/60 bg-background text-foreground",
        disabled && "pointer-events-none opacity-60",
        className
      )}
    >
      <div ref={hostRef} style={{ minHeight }} />
    </div>
  );
}
