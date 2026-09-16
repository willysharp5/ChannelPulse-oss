import React from "react";
import { createPortal } from "react-dom";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import remarkBreaks from "remark-breaks";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GlobeIcon,
  FileTextIcon,
  BookmarkIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import type { Citation } from "@/types/completion";
import { sanitizeMermaidInMarkdown } from "@/lib/mermaid/sanitize";
import { QuietMermaidError } from "@/lib/mermaid/QuietMermaidError";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
  /**
   * Sources for inline [n] citations. When provided, a link with an
   * `#cite-<n>` href renders as a clickable numbered chip with a popover.
   */
  citations?: Citation[];
}

/**
 * Turn inline [n] references into markdown links (#cite-n) that this renderer
 * converts into clickable numbered citation chips. Only rewrites numbers that
 * have a matching source and aren't already links.
 */

// LaTeX macros that reliably indicate a chunk is math (so we can safely convert
// bare `[ ... ]` blocks the model emits into KaTeX display math).
const MATH_MACRO =
  /\\(?:frac|dfrac|tfrac|text|mathrm|times|approx|cdot|div|sum|prod|int|sqrt|leq|geq|neq|le\b|ge\b|pm|infty|log|ln|left|right|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|Delta|Omega)/;

/**
 * Model answers frequently contain LaTeX that isn't wrapped in KaTeX
 * delimiters — e.g. `\[ ... \]`, `\( ... \)`, or a bare `[ QPS = \frac{...} ]`.
 * Streamdown/KaTeX only render `$...$` and `$$...$$`, so normalize the common
 * variants. Fenced/inline code is protected so we never touch real code.
 */
function normalizeMath(md: string): string {
  if (!/\\[[(]|\\(?:frac|text|approx|times|cdot|sum|sqrt)/.test(md)) return md;

  const fences: string[] = [];
  let s = md.replace(/```[\s\S]*?```/g, (m) => {
    fences.push(m);
    return `\u0000F${fences.length - 1}\u0000`;
  });
  const inline: string[] = [];
  s = s.replace(/`[^`\n]*`/g, (m) => {
    inline.push(m);
    return `\u0000I${inline.length - 1}\u0000`;
  });

  // \[ ... \] → $$ ... $$   and   \( ... \) → $ ... $
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, x) => `\n\n$$\n${x.trim()}\n$$\n\n`);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, x) => `$${x.trim()}$`);

  // Bare [ ... ] that clearly contains LaTeX → display math.
  s = s.replace(/\[\s*([^\[\]]*?)\s*\]/g, (m, inner: string) =>
    MATH_MACRO.test(inner) ? `\n\n$$\n${inner.trim()}\n$$\n\n` : m
  );

  s = s.replace(/\u0000I(\d+)\u0000/g, (_m, i) => inline[Number(i)]);
  s = s.replace(/\u0000F(\d+)\u0000/g, (_m, i) => fences[Number(i)]);
  return s;
}

export function linkifyCitations(text: string, citations?: Citation[]): string {
  if (!citations || citations.length === 0) return text;
  // n: 0 is reserved for profile meta-citations (UI only), not inline [n].
  const nums = new Set(citations.map((c) => c.n).filter((n) => n > 0));
  return text.replace(/\[(\d{1,3})\](?!\()/g, (full, d) => {
    const n = parseInt(d, 10);
    return nums.has(n) ? `[${n}](#cite-${n})` : full;
  });
}

/** Inline numbered citation chip that opens a popover with the source. */
const CitationLink = ({ citation }: { citation: Citation }) => {
  const Icon =
    citation.type === "web"
      ? GlobeIcon
      : citation.type === "file"
      ? FileTextIcon
      : BookmarkIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-primary/40 bg-primary/10 px-1 align-middle text-3xs font-medium text-primary no-underline hover:bg-primary/20">
          {citation.n}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-2.5 text-xs">
        <div className="mb-1 flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium">{citation.title}</span>
        </div>
        {citation.snippet && (
          <p className="line-clamp-5 whitespace-pre-wrap break-words text-2xs text-muted-foreground">
            {citation.snippet}
          </p>
        )}
        {citation.url && (
          <button
            onClick={() => openUrl(citation.url!).catch(() => {})}
            className="mt-1.5 inline-flex items-center gap-1 break-all text-2xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="size-3 shrink-0" />
            {citation.url}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
};

/**
 * Full-window Mermaid preview. Streamdown's built-in fullscreen renders a
 * `fixed inset-0` overlay, but our chat bubbles are cards with a
 * `backdrop-filter` (transparency mode), which creates a containing block that
 * traps the overlay inside the bubble. Rendering through a portal to
 * `document.body` escapes any such ancestor so the diagram truly takes over the
 * whole window.
 */
const MermaidLightbox = ({
  svg,
  onClose,
}: {
  svg: string;
  onClose: () => void;
}) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    // `cp-cursor-visible` keeps a normal, visible cursor inside the enlarged
    // view even when the app is in "invisible cursor" mode (which otherwise
    // hides the real cursor everywhere; see global.css).
    <div
      className="cp-cursor-visible fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm"
      onClick={onClose}
      role="button"
      tabIndex={0}
    >
      <button
        className="absolute right-4 top-4 z-10 rounded-md border border-border bg-background/80 p-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={onClose}
        title="Close (Esc)"
        type="button"
      >
        <XIcon className="size-5" />
      </button>
      <div
        className="flex h-full w-full items-center justify-center overflow-auto p-6 [&>svg]:!h-auto [&>svg]:!max-h-[90vh] [&>svg]:!w-auto [&>svg]:!max-w-[94vw]"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>,
    document.body
  );
};

export function Markdown({
  children,
  isStreaming = false,
  citations,
}: MarkdownRendererProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [lightboxSvg, setLightboxSvg] = React.useState<string | null>(null);
  // Repair Mermaid node labels (e.g. unquoted parentheses) so they render.
  const safeChildren = React.useMemo(
    () => sanitizeMermaidInMarkdown(normalizeMath(children)),
    [children]
  );

  // Add our own "expand" button to each rendered Mermaid diagram. Runs on mount
  // and whenever the rendered markdown changes (streaming), and watches the DOM
  // so late-rendered diagrams get a button too.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const enhance = () => {
      const diagrams = root.querySelectorAll<HTMLElement>(
        '[aria-label="Mermaid chart"]'
      );
      diagrams.forEach((diagram) => {
        const host =
          (diagram.closest("div.relative") as HTMLElement | null) ??
          (diagram.parentElement as HTMLElement | null);
        if (!host || host.querySelector(":scope > [data-mermaid-expand]")) {
          return;
        }
        if (getComputedStyle(host).position === "static") {
          host.style.position = "relative";
        }
        const btn = document.createElement("button");
        btn.setAttribute("data-mermaid-expand", "true");
        btn.type = "button";
        btn.title = "Expand diagram";
        btn.className =
          "absolute right-2 top-2 z-20 rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground";
        btn.innerHTML =
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const svg = diagram.querySelector("svg");
          if (svg) setLightboxSvg(svg.outerHTML);
        });
        host.appendChild(btn);
      });
    };

    enhance();
    // While a turn is streaming, the transcript mutates on nearly every token.
    // Running enhance() (a subtree querySelectorAll + per-diagram
    // getComputedStyle) synchronously per mutation piles work onto the JS thread
    // and stutters the UI. Coalesce every burst of mutations into a single
    // enhance() on the next frame instead.
    let scheduled = 0;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        enhance();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      observer.disconnect();
    };
  }, [children]);

  // Treat a single newline as a visible line break, not a soft break that
  // collapses into a space. Bank/model-answer text and freshly-generated AI
  // questions don't reliably use blank lines between logical lines, which
  // otherwise renders as everything run together.
  const remarkPlugins = React.useMemo(
    () => [...Object.values(defaultRemarkPlugins), remarkBreaks],
    []
  );

  const components = React.useMemo(
    () => ({
      a: ({ children: linkChildren, href, ...props }: any) => {
        // Inline citation link: href like "#cite-3" (possibly URL-prefixed).
        const match =
          typeof href === "string" ? href.match(/#cite-(\d+)/) : null;
        if (match && citations && citations.length > 0) {
          const n = parseInt(match[1], 10);
          const citation = citations.find((c) => c.n === n);
          if (citation) return <CitationLink citation={citation} />;
        }

        const handleClick = async (e: React.MouseEvent) => {
          e.preventDefault();
          if (href) {
            try {
              await openUrl(href);
            } catch (error) {
              console.error("Failed to open URL:", error);
            }
          }
        };

        return (
          <a
            href={href}
            className="text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
            onClick={handleClick}
            {...props}
          >
            {linkChildren}
          </a>
        );
      },
    }),
    [citations]
  );

  return (
    // `cp-md` restores list bullets + indentation that Tailwind preflight
    // strips (Streamdown/prose alone don't), so nested bullets in transcript,
    // chat, and model answers all indent consistently.
    <div ref={containerRef} className="cp-md">
      <Streamdown
        isAnimating={isStreaming}
        shikiTheme={["github-light", "github-dark"]}
        components={components as any}
        remarkPlugins={remarkPlugins as any}
        mermaid={{
          errorComponent: QuietMermaidError,
        }}
        controls={{
          table: true,
          code: true,
          mermaid: {
            download: true,
            copy: true,
            // Disabled: Streamdown's fullscreen is a `fixed` overlay that gets
            // trapped inside our backdrop-filtered chat cards. We use our own
            // portal-based expand button instead (see the effect above).
            fullscreen: false,
            panZoom: true,
          },
        }}
      >
        {safeChildren}
      </Streamdown>
      {lightboxSvg && (
        <MermaidLightbox
          svg={lightboxSvg}
          onClose={() => setLightboxSvg(null)}
        />
      )}
    </div>
  );
}
