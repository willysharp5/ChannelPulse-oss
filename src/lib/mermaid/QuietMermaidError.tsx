import { useState } from "react";

/**
 * Streamdown's default Mermaid error UI dumps "Mermaid Error: Parse error…"
 * plus the raw source. Replace it with a quiet, non-technical fallback.
 *
 * "Try again" re-runs Streamdown's parse (helps for transient/streaming
 * failures). When the diagram source is permanently invalid the parse keeps
 * failing, so we also expose the raw diagram code as a copyable fallback — that
 * way the button always does something useful instead of appearing dead.
 */
export function QuietMermaidError({
  chart,
  retry,
}: {
  chart?: string;
  error?: string;
  retry?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const source = (chart || "").trim();

  const handleRetry = () => {
    if (!retry || retrying) return;
    setRetrying(true);
    try {
      retry();
    } catch {
      /* ignore — Streamdown owns the re-parse */
    }
    // Brief visible feedback so the click never looks like a no-op. If the
    // re-parse succeeds this component unmounts; if not, we re-enable it.
    window.setTimeout(() => setRetrying(false), 500);
  };

  const handleCopy = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="my-3 rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <p>Diagram couldn’t be displayed.</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {retry ? (
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="text-xs font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
        ) : null}
        {source ? (
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
          >
            {showCode ? "Hide diagram code" : "Show diagram code"}
          </button>
        ) : null}
        {showCode && source ? (
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {showCode && source ? (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background p-2 text-2xs leading-relaxed text-foreground">
          {source}
        </pre>
      ) : null}
    </div>
  );
}
