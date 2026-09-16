/**
 * Repair common LLM Mermaid mistakes before render:
 * - unquoted special chars in node / subgraph labels
 * - invalid subgraph ids (Edge/CDN)
 * - truncated incomplete lines / unclosed subgraphs
 */

const NEEDS_QUOTES = /[()\/:&,%#@!?+*|\\<>{}[\],;'"]/;

export const MERMAID_GENERATION_RULES = `MERMAID SYNTAX RULES (strict; invalid diagrams are hidden from the user):
1. Start with flowchart TD, flowchart LR, or sequenceDiagram.
2. Node ids: letters/numbers/underscore only (Client, API_GW). Never put "/" or spaces in ids.
3. Labels with special characters MUST use quoted brackets:
   Good: CDN["Edge / CDN"]  API["Object Storage (S3)"]
   Bad:  CDN[Edge/CDN]      API[Object Storage (S3)]
4. Subgraphs with special characters:
   Good: subgraph edge_cdn["Edge / CDN"]
   Bad:  subgraph Edge/CDN
5. Keep diagrams COMPLETE: every subgraph needs "end"; never leave an open "[" or unclosed node.
6. Prefer short labels. No classDef / styling / click / linkStyle.
7. Use --> arrows. Do not nest subgraphs more than one level.`;

function quoteLabel(inner: string): string {
  const t = inner.trim();
  if (!t) return '""';
  if (/^".*"$/.test(t)) return t;
  if (!NEEDS_QUOTES.test(t) && !/\s/.test(t)) return t;
  // Spaces alone are OK in [Label With Spaces], but special chars need quotes.
  if (!NEEDS_QUOTES.test(t)) return t;
  return `"${t.replace(/"/g, "'")}"`;
}

function slugId(label: string): string {
  const base = label
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base && /^[a-zA-Z]/.test(base) ? base : `n_${base || "node"}`;
}

/** Quote [labels] and {labels} that contain special characters. */
function fixNodeLabels(code: string): string {
  return (
    code
      // Rectangle / stadium / etc. [label] — skip cylinder "[(" and already-quoted
      .replace(/\[(?!\()([^\[\]\n]*?)\]/g, (m, inner: string) => {
        if (/^".*"$/.test(inner.trim())) return m;
        if (!NEEDS_QUOTES.test(inner)) return m;
        return `[${quoteLabel(inner)}]`;
      })
      // Rhombus {label} — skip hex "{{"
      .replace(/\{(?!\{)([^{}\n]*?)\}(?!\})/g, (m, inner: string) => {
        if (/^".*"$/.test(inner.trim())) return m;
        if (!NEEDS_QUOTES.test(inner)) return m;
        return `{${quoteLabel(inner)}}`;
      })
  );
}

/**
 * Fix `subgraph Edge/CDN` → `subgraph edge_cdn["Edge/CDN"]`
 * Leave valid `subgraph id ["Title"]` / `subgraph id [Title]` alone when id is safe.
 */
function fixSubgraphs(code: string): string {
  return code.replace(
    /^(\s*)subgraph\s+(.+?)\s*$/gm,
    (_full, indent: string, rest: string) => {
      const r = rest.trim();
      // Already: id["Title"] or id[Title]
      const withTitle = r.match(/^([A-Za-z][\w]*)\s*(\[.+\])\s*$/);
      if (withTitle) {
        const id = withTitle[1];
        let titlePart = withTitle[2];
        // Ensure title brackets are quoted if needed
        const inner = titlePart.slice(1, -1);
        if (NEEDS_QUOTES.test(inner) && !/^".*"$/.test(inner.trim())) {
          titlePart = `[${quoteLabel(inner)}]`;
        }
        return `${indent}subgraph ${id} ${titlePart}`;
      }
      // Bare title / id with special chars: subgraph Edge/CDN
      if (NEEDS_QUOTES.test(r) || /\s/.test(r)) {
        const title = r.replace(/^["']|["']$/g, "");
        return `${indent}subgraph ${slugId(title)}["${title.replace(/"/g, "'")}"]`;
      }
      return `${indent}subgraph ${r}`;
    }
  );
}

/** Drop incomplete trailing lines (e.g. `F[` cut off mid-generation). */
function dropIncompleteLines(code: string): string {
  const lines = code.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push(line);
      continue;
    }
    // Open bracket/paren/brace without close on the same line
    const opens = (t.match(/[\[{(]/g) || []).length;
    const closes = (t.match(/[\]})]/g) || []).length;
    if (opens > closes) continue;
    // Trailing arrow with no target
    if (/-->\s*$/.test(t) || /--\s*$/.test(t) || /-\.\s*$/.test(t)) continue;
    // Lone incomplete id
    if (/^[A-Za-z][\w]*\s*\[\s*$/.test(t)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Close any unclosed `subgraph` blocks with `end`. */
function closeSubgraphs(code: string): string {
  let depth = 0;
  for (const line of code.split("\n")) {
    const t = line.trim();
    if (/^subgraph\b/.test(t)) depth++;
    else if (/^end\s*$/.test(t)) depth = Math.max(0, depth - 1);
  }
  if (depth <= 0) return code;
  return code.replace(/\s*$/, "") + "\n" + "end\n".repeat(depth);
}

/**
 * Sanitize a single Mermaid diagram source (no ``` fences).
 */
export function sanitizeMermaidSource(raw: string): string {
  if (!raw?.trim()) return raw;
  let code = raw.replace(/\r\n/g, "\n").trim();

  // Strip accidental fence if caller passed a full block
  if (code.startsWith("```")) {
    code = code.replace(/^```(?:mermaid)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  }

  code = dropIncompleteLines(code);
  code = fixSubgraphs(code);
  code = fixNodeLabels(code);
  code = closeSubgraphs(code);

  // Ensure a diagram header exists for flowcharts that forgot it
  if (
    !/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap)\b/m.test(
      code
    )
  ) {
    if (/-->|subgraph\b/.test(code)) {
      code = `flowchart TD\n${code}`;
    }
  }

  return code.trim() + "\n";
}

/**
 * Rewrite every ```mermaid ... ``` fence in a markdown string.
 */
export function sanitizeMermaidInMarkdown(md: string): string {
  if (!md || !md.includes("```mermaid")) return md;

  // 1) Repair all properly-closed ```mermaid … ``` fences.
  //    (sanitizeMermaidSource already returns a trailing newline.)
  let out = md.replace(/```mermaid[ \t]*\n([\s\S]*?)```/gi, (_full, code: string) => {
    return "```mermaid\n" + sanitizeMermaidSource(code) + "```";
  });

  // 2) Repair an UNTERMINATED trailing ```mermaid fence (generation cut off
  //    before the closing ```). The regex above requires a closing fence, so
  //    without this the raw, broken diagram reaches the renderer and errors —
  //    and Streamdown's "Try again" just re-parses the same broken source.
  const lower = out.toLowerCase();
  const openIdx = lower.lastIndexOf("```mermaid");
  if (openIdx !== -1) {
    const after = out.slice(openIdx);
    // Only the opener fence remains (no closing ``` after it) → unterminated.
    const fenceCount = (after.match(/```/g) || []).length;
    if (fenceCount < 2) {
      const head = out.slice(0, openIdx);
      const code = after.replace(/```mermaid[ \t]*\n?/i, "");
      out = head + "```mermaid\n" + sanitizeMermaidSource(code) + "```";
    }
  }

  return out;
}

/** True when the source still looks truncated / unusable after sanitize. */
export function isMermaidLikelyBroken(source: string): boolean {
  const s = source.trim();
  if (!s) return true;
  if (/[\[{(]\s*$/.test(s)) return true;
  if ((s.match(/subgraph\b/g) || []).length > (s.match(/^\s*end\s*$/gm) || []).length)
    return true;
  return false;
}
