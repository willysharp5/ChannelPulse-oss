/**
 * Turn raw extracted document text (PDF text layer, pasted text, .txt) into
 * readable markdown.
 *
 * Why this exists: `pdf_extract` gives us the text layer one visual line at a
 * time — a resume arrives as ~450 short lines with no markup, page-break form
 * feeds, hyphenated word wraps, and sometimes letter-spaced headings
 * ("E X P E R I E N C E"). The previous normalizer joined every line in a block
 * with a space, which turned all of that into one unreadable paragraph.
 *
 * So instead we *recover* structure: classify each line (section heading, role
 * line, bullet, contact, prose), re-join only the lines that are genuinely
 * continuations of the one above, and emit real markdown — headings, nested
 * lists, and paragraphs. Everything downstream (the Files viewer, the overlay
 * reference rail, retrieval chunks) reads better for free.
 *
 * Deliberately heuristic and conservative: when a line's role is ambiguous it
 * stays a plain paragraph on its own line. Losing a heading is cosmetic;
 * wrongly merging lines destroys information.
 */

/** Bullet glyphs seen in PDFs, Word exports, and Google Docs. */
const BULLET_CHARS = "•‣▪▫◦●○·∙◆◇■□➤➔→⁃–—";

/** Section names common to resumes, briefs, and notes. */
const SECTION_WORDS = new Set([
  "summary",
  "background summary",
  "professional summary",
  "executive summary",
  "profile",
  "professional profile",
  "objective",
  "career objective",
  "about",
  "about me",
  "experience",
  "work experience",
  "professional experience",
  "relevant experience",
  "employment",
  "employment history",
  "work history",
  "education",
  "skills",
  "technical skills",
  "core skills",
  "core competencies",
  "competencies",
  "tools",
  "technologies",
  "projects",
  "selected projects",
  "certifications",
  "certificates",
  "licenses",
  "awards",
  "honors",
  "honours",
  "publications",
  "presentations",
  "talks",
  "volunteer",
  "volunteering",
  "leadership",
  "activities",
  "interests",
  "hobbies",
  "languages",
  "references",
  "achievements",
  "key achievements",
  "highlights",
  "coursework",
  "courses",
  "training",
  "patents",
  "affiliations",
  "memberships",
  "contact",
  "contact information",
]);

type UnitKind = "h1" | "h2" | "h3" | "bullet" | "numbered" | "text";

type Unit = {
  kind: UnitKind;
  text: string;
  /** Leading spaces on the source line — raw input to `assignListDepth`. */
  indent: number;
  /** Nesting level 0-2. Assigned by `assignListDepth`, never by `classify`. */
  depth: number;
  /** The bullet character used, so a real sub-list can be told from a stray indent. */
  glyph?: string;
  /** Original marker for numbered items, so "3." doesn't become "1.". */
  marker?: string;
  /** True when the line can absorb a following continuation line. */
  wrappable: boolean;
};

function isListKind(kind: UnitKind): boolean {
  return kind === "bullet" || kind === "numbered";
}

/** Normalize the invisible stuff PDFs and word processors leave behind. */
function preClean(text: string): string {
  return (
    (text || "")
      .replace(/\r\n?/g, "\n")
      // Form feed = page break. Becomes a paragraph gap, not a joined line.
      .replace(/\f+/g, "\n\n")
      // Non-breaking / thin / figure spaces → ordinary spaces.
      .replace(/[      　]/g, " ")
      // Zero-width characters, BOMs, and the object-replacement char PDFs leave
      // where an image or a page boundary sat.
      .replace(/[​‌‍﻿￼]/g, "")
      // Soft hyphens are invisible wrap hints, never real characters.
      .replace(/­/g, "")
      // Ligature glyphs PDFs embed for fi/fl/ff.
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/ﬀ/g, "ff")
      .replace(/ﬃ/g, "ffi")
      .replace(/ﬄ/g, "ffl")
      .replace(/\t/g, "  ")
      // Trailing spaces would otherwise read as markdown hard breaks.
      .replace(/[ ]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Recover letter-spaced text ("E X P E R I E N C E" → "EXPERIENCE"), which some
 * PDF text layers produce for tracked-out headings. Word gaps come through as
 * runs of 2+ spaces, so those are what we split on.
 */
function despace(line: string): string {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 5) return line;
  const singles = tokens.filter((t) => t.length === 1 && /[A-Za-z]/.test(t));
  if (singles.length / tokens.length < 0.8) return line;
  return line
    .trim()
    .split(/\s{2,}/)
    .map((group) => group.split(/\s+/).join(""))
    .join(" ")
    .trim();
}

/** Page furniture: "3", "Page 2 of 5", "- 4 -". */
function isPageMarker(line: string): boolean {
  return /^[-–—\s]*(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?[-–—\s]*$/i.test(
    line.trim()
  );
}

function leadingSpaces(raw: string): number {
  return /^[ ]*/.exec(raw)?.[0].length ?? 0;
}

function matchBullet(
  raw: string
): { indent: number; glyph: string; text: string } | null {
  const glyph = new RegExp(`^([ ]*)([${BULLET_CHARS}]|[*+])[ ]+(.*)$`);
  const m = glyph.exec(raw);
  if (m) return { indent: leadingSpaces(raw), glyph: m[2], text: m[3].trim() };

  // "- item" — but not an em-dash aside or a "-- flag".
  const dash = /^([ ]*)-[ ]+(?!-)(.*)$/.exec(raw);
  if (dash) {
    return { indent: leadingSpaces(raw), glyph: "-", text: dash[2].trim() };
  }

  // Word's second-level bullet is a literal "o".
  const wordSub = /^([ ]*)o[ ]{1,3}(?=[A-Z0-9(])(.*)$/.exec(raw);
  if (wordSub) {
    return { indent: leadingSpaces(raw), glyph: "o", text: wordSub[2].trim() };
  }
  return null;
}

function matchNumbered(
  raw: string
): { indent: number; marker: string; text: string } | null {
  const m = /^([ ]*)(\d{1,2})[.)][ ]+(.*)$/.exec(raw);
  if (!m) return null;
  return { indent: leadingSpaces(raw), marker: `${m[2]}.`, text: m[3].trim() };
}

/** A date or date range — "Jan 2020 – Present", "2018-2021", "05/2019 – now". */
const DATE_RANGE =
  /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?(19|20)\d{2}\s*(-|–|—|to|until|through)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*,?\s*)?((19|20)\d{2}|present|current|now|today|ongoing)/i;

function hasDateRange(line: string): boolean {
  return DATE_RANGE.test(line) || /\b\d{1,2}\/\d{4}\s*(-|–|—)/.test(line);
}

/** A line that is *nothing but* a date range — "May 2025 - Present". */
function isDateOnly(line: string): boolean {
  const t = line.trim().replace(/[()[\]]/g, "").trim();
  if (!t || t.length > 40 || !hasDateRange(t)) return false;
  const rest = t.replace(DATE_RANGE, "").replace(/[,\s–—-]/g, "");
  return rest.length <= 2;
}

function isSectionHeading(line: string): boolean {
  const t = line.trim().replace(/[:•·\-–—\s]+$/, "").trim();
  if (!t || t.length > 60) return false;
  if (/[.!?,;]$/.test(t)) return false;

  const norm = t
    .toLowerCase()
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (SECTION_WORDS.has(norm)) return true;

  // Otherwise: a short ALL-CAPS banner of 2-6 words. A *single* all-caps word
  // that isn't a known section name is far more likely a skill listed one per
  // line ("TERRAFORM") than a heading, and a wrong heading is worse than a
  // missed one. Date lines (years) and comma/slash lists are excluded too.
  const letters = t.replace(/[^A-Za-z]/g, "");
  const words = t.split(/\s+/).length;
  return (
    letters.length >= 3 &&
    t === t.toUpperCase() &&
    words >= 2 &&
    words <= 6 &&
    !/\d{4}/.test(t) &&
    !/[,/|]/.test(t)
  );
}

/** "Senior Engineer, Acme — Jan 2020 – Present" — an entry header. */
function isEntryHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120) return false;
  if (/[.!?]$/.test(t)) return false;
  return hasDateRange(t);
}

function isContactish(line: string): boolean {
  const t = line.trim();
  if (t.length > 140) return false;
  return (
    /\S+@\S+\.\S+/.test(t) ||
    /https?:\/\//i.test(t) ||
    /\b(linkedin|github|gitlab)\b/i.test(t) ||
    /(\+?\d[\d\s().-]{7,}\d)/.test(t)
  );
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n += 1;
  return n;
}

/**
 * Does `line` continue the line above rather than start something new? This is
 * the one judgement that matters: get it wrong the loose way and the document is
 * a blob again; get it wrong the strict way and wrapped sentences break
 * mid-phrase.
 *
 * Two signals, in order of confidence. First, the line was never *started* by
 * the writer — it begins lowercase, or the line above trails off mid-thought.
 * Second, the line above **filled the column**: in a PDF text layer every
 * wrapped line runs to roughly the same width, so a full-width predecessor means
 * this line is a wrap, while a short one means the writer pressed return.
 * `prevLen`/`width` are measured on the source lines of the current block, which
 * is why this can't be decided from `prev.text` alone — that text has already
 * accumulated earlier continuations.
 */
function isContinuation(
  prev: Unit,
  line: string,
  prevLen: number,
  width: number
): boolean {
  if (!prev.wrappable) return false;
  const t = line.trim();
  if (!t) return false;

  const p = prev.text;

  // Checked before anything else: an unclosed "(" above plus a ")" here means
  // this is the tail of a wrapped parenthetical — "…Manager (Provider" /
  // "Experience)". Judged the other way round, "Experience)" matches a section
  // name and would become a heading in the middle of a job title.
  if (t.includes(")") && count(p, "(") > count(p, ")")) return true;

  // Never absorb something that starts a new thing in its own right.
  if (matchBullet(line) || matchNumbered(line)) return false;
  if (isSectionHeading(t) || isEntryHeading(t) || isDateOnly(t)) return false;
  // A trailing colon marks a label ("Scaling Compliance Engine:"), not a wrap.
  if (/:$/.test(t)) return false;

  if (/^["'“‘(]?[a-z]/.test(t)) return true;

  if (/[-–]$/.test(p)) return true;
  if (/[,;:&+/]$/.test(p)) return true;
  if (/\b(and|or|of|to|with|for|in|on|at|the|a|an|by|from|as)$/i.test(p)) {
    return true;
  }
  // The line above ran to the edge of the column, so this is its continuation.
  // The width floor keeps short-line blocks (skill columns, address blocks) out
  // of this rule entirely.
  return width >= 40 && prevLen >= width - 6;
}

/** Append a continuation, healing hyphenated word wraps. */
function appendContinuation(prev: Unit, line: string): void {
  const add = line.trim();
  if (/[A-Za-z]-$/.test(prev.text) && /^[a-z]/.test(add)) {
    prev.text = prev.text.replace(/-$/, "") + add;
    return;
  }
  prev.text = `${prev.text} ${add}`.replace(/\s{2,}/g, " ");
}

function classify(line: string): Unit | null {
  const trimmed = line.trim();
  if (!trimmed || isPageMarker(trimmed)) return null;
  const indent = leadingSpaces(line);

  const bullet = matchBullet(line);
  if (bullet && bullet.text) {
    return {
      kind: "bullet",
      text: bullet.text,
      indent: bullet.indent,
      depth: 0,
      glyph: bullet.glyph,
      wrappable: true,
    };
  }

  const numbered = matchNumbered(line);
  if (numbered && numbered.text) {
    return {
      kind: "numbered",
      text: numbered.text,
      indent: numbered.indent,
      depth: 0,
      marker: numbered.marker,
      wrappable: true,
    };
  }

  if (isSectionHeading(trimmed)) {
    return {
      kind: "h2",
      text: trimmed.replace(/[:•·\-–—\s]+$/, "").trim(),
      indent,
      depth: 0,
      wrappable: false,
    };
  }

  if (isEntryHeading(trimmed)) {
    return { kind: "h3", text: trimmed, indent, depth: 0, wrappable: false };
  }

  // Contact lines stay on their own line — a run-together "name email phone"
  // header is exactly the mush this function exists to prevent.
  if (isContactish(trimmed)) {
    return { kind: "text", text: trimmed, indent, depth: 0, wrappable: false };
  }

  return { kind: "text", text: trimmed, indent, depth: 0, wrappable: true };
}

/** Build logical units, merging wrapped lines back together. */
function toUnits(text: string): Unit[] {
  const units: Unit[] = [];

  // Blocks are separated by blank lines. Nothing wraps across a blank line, and
  // a block's widest line estimates the original column width (see
  // `isContinuation`).
  for (const block of text.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map(despace)
      .filter((l) => l.trim());
    if (lines.length === 0) continue;
    const width = Math.max(...lines.map((l) => l.trim().length));

    let prevLen = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (isPageMarker(trimmed)) continue;
      const last = units[units.length - 1];
      if (last && isContinuation(last, line, prevLen, width)) {
        appendContinuation(last, trimmed);
      } else {
        const unit = classify(line);
        if (unit) units.push(unit);
      }
      prevLen = trimmed.length;
    }

    const last = units[units.length - 1];
    if (last) last.wrappable = false;
  }

  return units;
}

/**
 * Work out list nesting for each run of consecutive list items.
 *
 * Indentation alone is not trustworthy: PDF page breaks routinely add a couple
 * of stray spaces to the first item on a new page, which would nest a plain
 * sibling by mistake. A *real* sub-list also switches marker — "•" to "o",
 * "●" to "-" — so a glyph that appears at the run's shallowest indent is
 * treated as a top-level marker everywhere else it shows up.
 */
function assignListDepth(units: Unit[]): void {
  let i = 0;
  while (i < units.length) {
    if (!isListKind(units[i].kind)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < units.length && isListKind(units[j].kind)) j += 1;
    const run = units.slice(i, j);

    const minIndent = Math.min(...run.map((u) => u.indent));
    const glyphOf = (u: Unit) => u.glyph ?? "#";
    const topGlyphs = new Set(
      run.filter((u) => u.indent === minIndent).map(glyphOf)
    );
    const nestedIndents = [
      ...new Set(
        run.filter((u) => !topGlyphs.has(glyphOf(u))).map((u) => u.indent)
      ),
    ].sort((a, b) => a - b);

    for (const u of run) {
      if (topGlyphs.has(glyphOf(u))) {
        u.depth = 0;
        continue;
      }
      const rank = nestedIndents.indexOf(u.indent);
      u.depth = Math.min(rank < 0 ? 1 : rank + 1, 2);
    }
    i = j;
  }
}

/**
 * "Gusto, San Francisco - Engineering Manager" and "May 2025 - Present" arrive
 * as two separate lines, usually with a blank line between them so they can't be
 * joined as a wrap. Together they are the entry header a reader scans for.
 */
function mergeDateLines(units: Unit[]): void {
  for (let i = units.length - 1; i > 0; i -= 1) {
    const u = units[i];
    if (u.kind !== "text" && u.kind !== "h3") continue;
    if (!isDateOnly(u.text)) continue;
    const prev = units[i - 1];
    if (prev.kind !== "text" || prev.text.length > 110) continue;
    if (/[.!?:]$/.test(prev.text) || isContactish(prev.text)) continue;
    prev.kind = "h3";
    prev.text = `${prev.text} · ${u.text}`;
    prev.wrappable = false;
    units.splice(i, 1);
  }
}

/**
 * Promote the opening line to a title when it reads like one (a person's name on
 * a resume, a document title) and the doc has sections beneath it. A name in caps
 * ("EDO WILLIAMS") classifies as a section banner first, so an opening h2 is
 * promoted too — otherwise the document has no title and one section too many.
 */
function promoteTitle(units: Unit[]): void {
  const first = units[0];
  if (!first || (first.kind !== "text" && first.kind !== "h2")) return;
  if (!units.slice(1).some((u) => u.kind === "h2" || u.kind === "h3")) return;
  const t = first.text;
  if (t.length > 60 || /\d/.test(t) || /[.!?,]$/.test(t)) return;
  if (t.split(/\s+/).length > 6) return;
  if (isContactish(t)) return;
  first.kind = "h1";
}

function render(units: Unit[]): string {
  const out: string[] = [];
  let prev: Unit | null = null;

  for (const u of units) {
    const isList = isListKind(u.kind);
    const prevIsList = prev !== null && isListKind(prev.kind);

    // A blank line between everything except consecutive list items, which have
    // to stay adjacent to render as one list.
    if (out.length > 0 && !(isList && prevIsList)) out.push("");

    if (u.kind === "h1") out.push(`# ${u.text}`);
    else if (u.kind === "h2") out.push(`## ${u.text}`);
    else if (u.kind === "h3") out.push(`### ${u.text}`);
    else if (u.kind === "bullet") {
      out.push(`${"  ".repeat(u.depth)}- ${u.text}`);
    } else if (u.kind === "numbered") {
      out.push(`${"  ".repeat(u.depth)}${u.marker || "1."} ${u.text}`);
    } else out.push(u.text);

    prev = u;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * True when the text already carries markdown structure worth preserving. A
 * nested list counts: it means someone (Firecrawl, or our own Quill editor
 * round-tripping this function's output) already made the indentation
 * meaningful, and re-deriving it could only lose information.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (/^#{1,6}\s/m.test(text)) return true;
  if (/```/.test(text)) return true;
  if (/^\s*\|.+\|\s*$/m.test(text)) return true;
  return /^[-*+]\s/m.test(text) && /^\s{2,}[-*+]\s/m.test(text);
}

/**
 * Raw document text → readable markdown. Already-structured markdown (e.g. a
 * Firecrawl research doc) is only whitespace-cleaned, never restructured.
 */
export function structureDocumentText(raw: string): string {
  const cleaned = preClean(raw);
  if (!cleaned) return "";
  if (looksLikeMarkdown(cleaned)) return cleaned;
  const units = toUnits(cleaned);
  if (units.length === 0) return "";
  mergeDateLines(units);
  assignListDepth(units);
  promoteTitle(units);
  return render(units);
}
