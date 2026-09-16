import { cn } from "@/lib/utils";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokenize a search query into distinct words worth highlighting (len >= 2). */
function queryTokens(query: string): string[] {
  return [
    ...new Set(
      (query || "")
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    ),
  ];
}

export interface HighlightProps {
  /** The text to render. */
  text: string;
  /** The active search query; occurrences of its words are wrapped in <mark>. */
  query?: string;
  /** Extra classes for the wrapping element. */
  className?: string;
  /** Extra classes for each <mark>. */
  markClassName?: string;
}

/**
 * Render `text` with every occurrence of the search `query`'s words wrapped in a
 * subtle <mark>, so users can see WHY a result matched. Safe: no HTML injection
 * (plain React nodes), no-op when there's no query. Shared by every app search.
 */
export function Highlight({
  text,
  query,
  className,
  markClassName,
}: HighlightProps) {
  const value = text ?? "";
  const tokens = queryTokens(query || "");
  if (!value || tokens.length === 0) {
    return className ? <span className={className}>{value}</span> : <>{value}</>;
  }

  // One capturing group → String.split interleaves [text, match, text, match…],
  // so every odd index is a matched segment.
  const re = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = value.split(re);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className={cn(
              "rounded bg-primary/25 px-0.5 text-inherit",
              markClassName
            )}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}
