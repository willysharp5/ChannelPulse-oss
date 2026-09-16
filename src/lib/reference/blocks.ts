/**
 * Split a reference doc into flat, addressable blocks.
 *
 * The overlay isn't a document editor — it's a glance surface. So instead of
 * rendering markdown, a doc becomes a list of short blocks (headings, bullets,
 * paragraphs) that can each be searched, jumped to, and pinned individually.
 * Block ids are index-based and therefore stable only for a given body, which
 * is why a pin also stores its text (see `pins.ts`).
 */
export type ReferenceBlock = {
  id: string;
  /** Plain text with markdown emphasis/heading markers stripped. */
  text: string;
  /** Heading depth 1-3, or 0 for body text. */
  level: 0 | 1 | 2 | 3;
  /** True for `- `/`* `/`1. ` lines, so they can be rendered as bullets. */
  bullet: boolean;
  /** List nesting level (0-2), taken from the line's indentation. */
  depth: number;
  /** Id of the nearest preceding heading — powers "jump to section". */
  sectionId: string | null;
};

export type ReferenceOutlineItem = {
  id: string;
  text: string;
  level: 1 | 2 | 3;
};

/** Strip inline markdown so a block reads cleanly at 11px in a narrow rail. */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDocBlocks(markdown: string): ReferenceBlock[] {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReferenceBlock[] = [];
  let paragraph: string[] = [];
  let sectionId: string | null = null;
  let inFence = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = stripInline(paragraph.join(" "));
    paragraph = [];
    if (!text) return;
    blocks.push({
      id: `b${blocks.length}`,
      text,
      level: 0,
      bullet: false,
      depth: 0,
      sectionId,
    });
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Code fences are kept as-is (verbatim matters in a resume's tech list),
    // but they don't get their own block type — the content lines do.
    if (/^\s*```/.test(line)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (inFence) {
      blocks.push({
        id: `b${blocks.length}`,
        text: line.trim(),
        level: 0,
        bullet: false,
        depth: 0,
        sectionId,
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      const text = stripInline(heading[2]);
      if (!text) continue;
      const id = `b${blocks.length}`;
      blocks.push({ id, text, level, bullet: false, depth: 0, sectionId });
      sectionId = id;
      continue;
    }

    // A horizontal rule is a section break, not content.
    if (/^([-*_])\s*(\1\s*){2,}$/.test(line.trim())) {
      flushParagraph();
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const text = stripInline(bullet[3]);
      if (!text) continue;
      // Two spaces per level is what the ingest formatter emits, so a nested
      // sub-bullet stays visibly nested in the rail.
      const depth = Math.min(Math.floor(bullet[1].length / 2), 2);
      blocks.push({
        id: `b${blocks.length}`,
        text,
        level: 0,
        bullet: true,
        depth,
        sectionId,
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

export function docOutline(blocks: ReferenceBlock[]): ReferenceOutlineItem[] {
  return blocks
    .filter((b) => b.level > 0)
    .map((b) => ({ id: b.id, text: b.text, level: b.level as 1 | 2 | 3 }));
}

/** Case-insensitive, whitespace-tolerant match used by the rail's search box. */
export function blockMatches(block: ReferenceBlock, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = block.text.toLowerCase();
  return q
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .every((t) => haystack.includes(t));
}
