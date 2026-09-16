/**
 * Admin-run reference-corpus jobs (rechecks), runnable from the app.
 *
 *  - runReferenceValidate: re-scrape every web reference via the Firecrawl
 *    proxy; deactivate dead links; (re)ingest any that have 0 chunks.
 *  - runReferenceDiscovery: Firecrawl-search curated queries per category, keep
 *    results on a trusted-domain allowlist, dedupe against existing references,
 *    and ingest up to maxNew new sources per category.
 *
 * Newly ingested chunks are immediately searchable via the
 * match_interview_reference_chunks RPC and used at runtime by references.ts.
 * Writes require admin (RLS policy iref_*_admin_all). Stoppable via AbortSignal.
 */
import { getSupabase } from "@/lib/auth/client";
import { backendEmbed } from "@/lib/backend";
import { firecrawlSearch, firecrawlScrape } from "@/lib/memory/firecrawl";
export interface ReferenceLinkCheckResult {
  id: string;
  url: string;
  title: string;
  /** true = Firecrawl reached usable content */
  ok: boolean;
  detail?: string;
}

export interface ReferenceJobProgress {
  phase: "validate" | "discover";
  done: number;
  total: number;
  added: number;
  message: string;
  /** Latest per-link result (validate phase). */
  linkResult?: ReferenceLinkCheckResult;
}

export interface ReferenceCategoryStat {
  category: string;
  refs: number;
  chunks: number;
  active: number;
}

const EMBED_MODEL = "text-embedding-3-small";

// ── Trusted domains (allowlist) + authority weighting ────────────────────────
const DOMAIN_AUTHORITY: Record<string, number> = {
  // System design + interview guides
  "bytebytego.com": 5, "blog.bytebytego.com": 5, "systemdesignhandbook.com": 4,
  "educative.io": 4, "hellointerview.com": 4, "igotanoffer.com": 4, "designgurus.io": 4,
  "designgurus.substack.com": 4, "techinterviewhandbook.org": 4, "geeksforgeeks.org": 4,
  "interviewing.io": 4, "tryexponent.com": 4, "systemdesign.one": 4, "neetcode.io": 4,
  "algo.monster": 4, "interviewbit.com": 4, "prepfully.com": 3, "ambitionbox.com": 3,
  "levels.fyi": 3, "bigocheatsheet.com": 3, "grokkingtechinterview.com": 3,
  // Popular coding / DSA sites for software developers
  "leetcode.com": 5, "leetcode.ca": 4, "walkccc.me": 3, "hackerrank.com": 4,
  "hackerearth.com": 3, "codesignal.com": 3, "codeforces.com": 3, "cp-algorithms.com": 4,
  "usaco.guide": 3, "algoexpert.io": 3, "takeuforward.org": 4, "codingninjas.com": 3,
  "naukri.com": 3, "scaler.com": 3, "freecodecamp.org": 4, "programiz.com": 3,
  "baeldung.com": 3, "javatpoint.com": 2, "tutorialspoint.com": 2, "w3schools.com": 2,
  "codechef.com": 3, "topcoder.com": 3, "structy.net": 3, "blog.pramp.com": 3,
  // EM + engineering leadership
  "managersclub.com": 4, "theengineeringmanager.com": 4, "pragmaticengineer.com": 4,
  "highgrowthengineer.com": 3,
  // Product / PM / product sense
  "productschool.com": 4, "productmanagerhq.com": 4, "mindtheproduct.com": 4,
  "svpg.com": 5, "reforge.com": 4, "lennysnewsletter.com": 4, "productplan.com": 3,
  "aha.io": 3, "producttalk.org": 4, "romanpichler.com": 3, "intercom.com": 3,
  "amplitude.com": 3, "mixpanel.com": 3, "pmsource.co": 3, "productcraft.com": 3,
  "userinterviews.com": 3, "maze.co": 3, "nngroup.com": 4, "uxdesign.cc": 3,
  "firstround.com": 4, "a16z.com": 3, "review.firstround.com": 4,
  // General
  "glassdoor.com": 3, "github.com": 3, "medium.com": 3, "dev.to": 3, "substack.com": 3,
  "stackoverflow.com": 3, "reddit.com": 2, "teamblind.com": 2,
};

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** Canonical form so http/https, www, trailing slash, and hashes don't double-ingest. */
export function normalizeReferenceUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.protocol = "https:";
    // Drop common tracking noise.
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    let path = u.pathname.replace(/\/+$/, "") || "";
    return `${u.protocol}//${u.hostname}${path}${u.search}`;
  } catch {
    return raw.trim().replace(/\/+$/, "").toLowerCase();
  }
}
function authorityOf(url: string): number {
  const d = domainOf(url);
  if (DOMAIN_AUTHORITY[d] != null) return DOMAIN_AUTHORITY[d];
  const base = Object.keys(DOMAIN_AUTHORITY).find((k) => d.endsWith(k));
  return base ? DOMAIN_AUTHORITY[base] : 0;
}
function sourceTypeOf(url: string): string {
  if (/\.pdf($|\?)/i.test(url)) return "pdf";
  if (domainOf(url).includes("github.com")) return "github";
  return "web";
}

/** Built-in Firecrawl search queries per discovery category. */
export const DISCOVERY_QUERIES: Record<string, string[]> = {
  system_design: [
    "system design interview guide step by step",
    "system design interview questions and answers",
    "distributed systems concepts caching sharding load balancing explained",
    "design a rate limiter system design interview",
    "how to approach a system design interview framework",
    "geeksforgeeks system design interview questions",
    "leetcode system design interview questions discuss",
    "grokking the system design interview problems list",
  ],
  coding: [
    "coding interview patterns explained cheat sheet",
    "top coding interview questions with solutions",
    "dynamic programming interview patterns guide",
    "big o time complexity cheat sheet interview",
    "leetcode top interview questions list with solutions",
    "leetcode blind 75 problems list",
    "neetcode 150 patterns problems",
    "striver SDE sheet takeuforward problems",
    "hackerrank interview preparation kit solutions",
    "geeksforgeeks top coding interview questions",
    "most asked FAANG coding interview questions leetcode",
  ],
  behavioral: [
    "behavioral interview questions and answers STAR method software engineer",
    "tell me about a time interview example answers",
    "amazon leadership principles behavioral interview answers",
    "behavioral interview guide for engineers",
    "leetcode behavioral interview questions discuss",
    "glassdoor software engineer behavioral interview questions",
    "geeksforgeeks behavioral interview questions software engineer",
  ],
  technical: [
    "software engineer technical interview concepts guide",
    "computer science fundamentals interview questions",
    "networking databases concurrency interview prep",
    "software architecture interview questions and answers",
  ],
  engineering_manager: [
    "engineering manager interview questions and answers",
    "engineering manager behavioral interview guide",
    "engineering manager system design interview preparation",
    "how to prepare for engineering manager interview",
  ],
  general: [
    "software engineer interview preparation guide",
    "how to prepare for a tech interview complete guide",
    "common software engineering interview questions",
  ],
};

export const DISCOVERY_CATEGORY_LABELS: Record<string, string> = {
  system_design: "System design",
  coding: "Coding",
  behavioral: "Behavioral",
  technical: "Technical",
  engineering_manager: "Eng manager",
  general: "General",
};

// ── Text utils ───────────────────────────────────────────────────────────────
const NAV =
  /^(\s*[-*]\s*)?(sign in|sign up|subscribe|log ?in|log ?out|menu|search|home|courses|pricing|share|comment|reply|©|cookie|privacy|terms|newsletter|advertise|follow|download the app|table of contents)\b/i;

function cleanMarkdown(md: string): string {
  return md
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (NAV.test(t)) return false;
      if (/^\[[^\]]+\]\([^)]+\)\s*$/.test(t) && t.length < 60) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TARGET = 1200;
const MINCHUNK = 280;

function chunkMarkdown(md: string): { heading: string; content: string }[] {
  const lines = md.split("\n");
  const out: { heading: string; content: string }[] = [];
  let heading = "";
  let buf: string[] = [];
  let cur = 0;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text.length >= MINCHUNK) out.push({ heading, content: text });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      if (cur >= MINCHUNK) flush();
      heading = h[1].trim().slice(0, 160);
      buf.push(line);
      cur = buf.join("\n").length;
      continue;
    }
    buf.push(line);
    cur = buf.join("\n").length;
    if (cur >= TARGET) { flush(); cur = 0; }
  }
  flush();
  const merged: { heading: string; content: string }[] = [];
  for (const c of out) {
    if (merged.length && c.content.length < MINCHUNK)
      merged[merged.length - 1].content += "\n\n" + c.content;
    else merged.push(c);
  }
  return merged.slice(0, 120);
}

/** Stable content hash (browser-safe, no node crypto). ~53-bit hex + length. */
function contentHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + c * 31) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}${s.length.toString(16)}`;
}

const vecString = (v: number[]): string =>
  `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;

export type IngestSourceType = "web" | "pdf" | "github" | "book" | "upload";

export interface IngestReferenceInput {
  category: string;
  title: string;
  /** Unique key for the source. For pasted/uploaded text, use a stable synthetic URL. */
  url: string;
  source_type: IngestSourceType;
  authority?: number;
  markdown: string;
}

/**
 * Chunk markdown into text pieces, embed them, and upsert into the coaching
 * knowledge base. This is what turns a URL scrape / paste / upload into
 * searchable pieces used at runtime.
 */
export async function ingestReferenceContent(
  input: IngestReferenceInput
): Promise<{ pieces: number; referenceId: string }> {
  const authority = input.authority ?? 3;
  const pieces = await ingestMarkdown(
    {
      category: input.category,
      title: input.title,
      url: input.url,
      source_type: input.source_type,
      authority,
    },
    input.markdown
  );
  if (!pieces) throw new Error("No text chunks could be created from that content.");
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const { data } = await sb
    .from("interview_references")
    .select("id")
    .eq("url", input.url)
    .maybeSingle();
  return { pieces, referenceId: (data?.id as string) || "" };
}

/** Scrape a URL with Firecrawl (GitHub README fallback included), then ingest. */
export async function ingestReferenceFromUrl(opts: {
  url: string;
  category: string;
  title?: string;
  authority?: number;
}): Promise<{ pieces: number; referenceId: string; title: string }> {
  const url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter a valid http(s) URL.");
  const sb = getSupabase();
  if (sb) {
    const norm = normalizeReferenceUrl(url);
    const { data: rows } = await sb
      .from("interview_references")
      .select("id,url,title,chunk_count")
      .gt("chunk_count", 0)
      .limit(5000);
    const hit = ((rows ?? []) as { id: string; url: string; title: string; chunk_count: number }[]).find(
      (r) => normalizeReferenceUrl(r.url) === norm || r.url === url
    );
    if (hit) {
      throw new Error(
        `Already in the knowledge base (“${hit.title || hit.url}”, ${hit.chunk_count} text chunks). Skipping re-scrape.`
      );
    }
  }
  const md = await firecrawlScrape(url, { simple: true });
  if (!md || md.trim().length < 80) {
    throw new Error(
      "Couldn’t get enough content from that URL (Firecrawl scrape empty or blocked)."
    );
  }
  const title =
    (opts.title || "").trim() ||
    md.split("\n").find((l) => l.replace(/^#+\s*/, "").trim())?.replace(/^#+\s*/, "").trim().slice(0, 120) ||
    domainOf(url) ||
    url;
  const result = await ingestReferenceContent({
    category: opts.category,
    title,
    url,
    source_type: sourceTypeOf(url) as IngestSourceType,
    authority: opts.authority,
    markdown: md,
  });
  return { ...result, title };
}

// ── Ingest one document into the corpus ──────────────────────────────────────
async function ingestMarkdown(ref: {
  category: string;
  title: string;
  url: string;
  source_type: string;
  authority: number;
}, md: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const chunks = chunkMarkdown(cleanMarkdown(md));
  if (!chunks.length) return 0;

  const { data: refRow, error: refErr } = await sb
    .from("interview_references")
    .upsert(
      {
        category: ref.category,
        title: ref.title.slice(0, 300),
        url: ref.url,
        source_type: ref.source_type,
        authority: ref.authority,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "url" }
    )
    .select("id")
    .single();
  if (refErr || !refRow) throw new Error(refErr?.message || "reference upsert failed");
  const referenceId = refRow.id as string;

  for (let i = 0; i < chunks.length; i += 48) {
    const batch = chunks.slice(i, i + 48);
    const vecs = await backendEmbed(
      batch.map((c) => `${c.heading ? c.heading + "\n" : ""}${c.content}`),
      EMBED_MODEL
    );
    const rows = batch.map((c, j) => ({
      reference_id: referenceId,
      category: ref.category,
      heading: c.heading || null,
      content: c.content,
      url: ref.url,
      title: ref.title.slice(0, 300),
      authority: ref.authority,
      token_estimate: Math.round(c.content.length / 4),
      content_hash: contentHash(c.content),
      embedding: vecString(vecs[j] || []),
    }));
    const { error } = await sb
      .from("interview_reference_chunks")
      .upsert(rows, { onConflict: "reference_id,content_hash", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const { count } = await sb
    .from("interview_reference_chunks")
    .select("id", { count: "exact", head: true })
    .eq("reference_id", referenceId);
  const total = count ?? chunks.length;
  await sb
    .from("interview_references")
    .update({ chunk_count: total, last_ingested_at: new Date().toISOString() })
    .eq("id", referenceId);
  return total;
}

export interface ReferenceLinkRow {
  id: string;
  category: string;
  title: string;
  url: string;
  chunk_count: number;
  active: boolean;
  domain: string;
}

// ── Corpus stats (for the admin panel) ───────────────────────────────────────
export async function getReferenceStats(): Promise<ReferenceCategoryStat[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("interview_references")
    .select("category,chunk_count,active");
  if (error || !data) return [];
  const map = new Map<string, ReferenceCategoryStat>();
  for (const r of data as any[]) {
    const s = map.get(r.category) || { category: r.category, refs: 0, chunks: 0, active: 0 };
    s.refs += 1;
    s.chunks += r.chunk_count || 0;
    if (r.active) s.active += 1;
    map.set(r.category, s);
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Delete sources that were never crawled (zero text pieces).
 * Paused / unreachable sources with pieces are kept so content isn’t lost.
 */
export async function purgeUselessReferences(): Promise<{ deleted: number }> {
  const sb = getSupabase();
  if (!sb) return { deleted: 0 };
  const { data, error } = await sb
    .from("interview_references")
    .select("id")
    .eq("chunk_count", 0);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return { deleted: 0 };
  return deleteReferenceLinks(ids);
}

/**
 * Delete text chunks for the given sources and zero their chunk_count.
 * Leaves the source row (title / topic / URL). Prefer deleteReferenceLinks
 * when you want the whole source gone — that cascades chunks automatically.
 */
export async function deleteReferenceChunks(
  ids: string[]
): Promise<{ deletedChunks: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  if (!ids.length) return { deletedChunks: 0 };
  const { count, error } = await sb
    .from("interview_reference_chunks")
    .delete({ count: "exact" })
    .in("reference_id", ids);
  if (error) throw new Error(error.message);
  const { error: updErr } = await sb
    .from("interview_references")
    .update({ chunk_count: 0, last_ingested_at: null })
    .in("id", ids);
  if (updErr) throw new Error(updErr.message);
  return { deletedChunks: count ?? 0 };
}

/**
 * Permanently delete source rows (title, topic, URL). Text chunks cascade
 * via FK on delete — no separate chunk-delete step required.
 */
export async function deleteReferenceLinks(
  ids: string[]
): Promise<{ deleted: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  if (!ids.length) return { deleted: 0 };
  const { error: delErr, count } = await sb
    .from("interview_references")
    .delete({ count: "exact" })
    .in("id", ids);
  if (delErr) throw new Error(delErr.message);
  return { deleted: count ?? ids.length };
}

/** List web references available for selective validate (including paused). */
export async function listReferenceLinks(): Promise<ReferenceLinkRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("interview_references")
    .select("id,category,title,url,chunk_count,active")
    .like("url", "http%")
    .gt("chunk_count", 0)
    .order("category")
    .order("title");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    title: (r.title as string) || r.url,
    url: r.url as string,
    chunk_count: (r.chunk_count as number) ?? 0,
    active: !!r.active,
    domain: domainOf(r.url as string),
  }));
}

// ── Validate existing web references ─────────────────────────────────────────
export async function runReferenceValidate(opts: {
  /** When set, only these reference ids are validated. Required for selective runs. */
  ids?: string[];
  reingestEmpty?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ReferenceJobProgress) => void;
}): Promise<{ added: number; stale: number; removed: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  if (!opts.ids?.length) {
    throw new Error("Select at least one link to validate.");
  }
  const { data, error } = await sb
    .from("interview_references")
    .select("id,category,title,url,chunk_count")
    .in("id", opts.ids)
    .like("url", "http%")
    .order("category");
  if (error) throw new Error(error.message);
  const refs = (data ?? []) as any[];
  const total = refs.length;
  let done = 0;
  let added = 0;
  let stale = 0;
  let removed = 0;

  opts.onProgress?.({ phase: "validate", done, total, added, message: `Validating ${total} links…` });

  for (const r of refs) {
    if (opts.signal?.aborted) break;
    let ok = false;
    let via = "";
    let chunkCount = (r.chunk_count ?? 0) as number;
    try {
      // Simple scrape (no change-tracking). GitHub falls back to raw README.
      const md = await firecrawlScrape(r.url, { simple: true });
      if (md && md.length > 300) {
        ok = true;
        via = domainOf(r.url).includes("github.com")
          ? "GitHub content"
          : "Firecrawl scrape";
        if (chunkCount === 0 || opts.reingestEmpty) {
          const n = await ingestMarkdown(
            {
              category: r.category,
              title: r.title,
              url: r.url,
              source_type: sourceTypeOf(r.url),
              authority: Math.max(3, authorityOf(r.url) || 3),
            },
            md
          );
          added += n;
          chunkCount = n > 0 ? n : chunkCount;
        }
      }
    } catch {
      ok = false;
    }

    if (ok && chunkCount > 0) {
      await sb
        .from("interview_references")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      done += 1;
      opts.onProgress?.({
        phase: "validate",
        done,
        total,
        added,
        message: `Reached ${r.url}`,
        linkResult: {
          id: r.id,
          url: r.url,
          title: String(r.title || r.url),
          ok: true,
          detail: `Reached (${via})`,
        },
      });
      continue;
    }

    if (chunkCount > 0) {
      // Live page failed, but we already have pieces — keep using them for coaching.
      await sb
        .from("interview_references")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      stale += 1;
      done += 1;
      const why = domainOf(r.url).includes("github.com")
        ? "Firecrawl couldn’t scrape GitHub (often blocks scrapers); raw README fallback also failed"
        : "Firecrawl scrape returned no usable content (page may block scrapers)";
      opts.onProgress?.({
        phase: "validate",
        done,
        total,
        added,
        message: `Failed ${r.url}`,
        linkResult: {
          id: r.id,
          url: r.url,
          title: String(r.title || r.url),
          ok: false,
          detail: `${why}, still using ${chunkCount} existing text chunks`,
        },
      });
      continue;
    }

    // Never crawled — nothing to keep.
    await sb.from("interview_references").delete().eq("id", r.id);
    removed += 1;
    done += 1;
    opts.onProgress?.({
      phase: "validate",
      done,
      total,
      added,
      message: `Failed ${r.url}`,
      linkResult: {
        id: r.id,
        url: r.url,
        title: String(r.title || r.url),
        ok: false,
        detail: "No content, deleted",
      },
    });
  }

  const parts: string[] = [];
  if (stale) {
    parts.push(
      `${stale} link${stale === 1 ? "" : "s"} unreachable (existing text chunks still used for coaching)`
    );
  }
  if (removed) parts.push(`deleted ${removed} empty`);
  if (added) parts.push(`re-saved ${added} text chunks`);
  opts.onProgress?.({
    phase: "validate",
    done,
    total,
    added,
    message: opts.signal?.aborted
      ? `Stopped. ${parts.join(" · ") || "No changes."}`
      : parts.length
        ? `Done. ${parts.join(" · ")}.`
        : `Done. All ${done} link${done === 1 ? "" : "s"} ok.`,
  });
  return { added, stale, removed };
}

// ── Discover new references ──────────────────────────────────────────────────
export async function runReferenceDiscovery(opts: {
  categories?: string[];
  /** Extra / override search queries keyed by category id. */
  categoryQueries?: Record<string, string[]>;
  maxNew?: number;
  searchLimit?: number;
  minAuthority?: number;
  signal?: AbortSignal;
  onProgress?: (p: ReferenceJobProgress) => void;
}): Promise<{ added: number; sources: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");
  const maxNew = opts.maxNew ?? 8;
  const searchLimit = opts.searchLimit ?? 8;
  const queryMap: Record<string, string[]> = {
    ...DISCOVERY_QUERIES,
    ...(opts.categoryQueries || {}),
  };
  const cats = (opts.categories?.length
    ? opts.categories
    : Object.keys(queryMap)
  ).filter((c) => (queryMap[c] || []).length > 0);

  // Only skip URLs that already have text chunks (empty rows can be filled).
  const { data: existingRows } = await sb
    .from("interview_references")
    .select("url,category,chunk_count");
  type ExistingRef = { url: string; category: string; chunk_count: number };
  const knownRows = ((existingRows ?? []) as ExistingRef[]).filter(
    (r) => (r.chunk_count ?? 0) > 0
  );
  /** Normalized URL → already in library with chunks. */
  const existing = new Set(knownRows.map((r) => normalizeReferenceUrl(r.url)));
  const knownUrlsByCategory = new Map<string, string[]>();
  for (const r of knownRows) {
    const list = knownUrlsByCategory.get(r.category) ?? [];
    list.push(r.url);
    knownUrlsByCategory.set(r.category, list);
  }

  let added = 0;
  let sources = 0;
  const total = cats.length;
  let doneCats = 0;
  let searchHits = 0;
  let searchErrors = 0;
  let scrapeFails = 0;
  let skippedKnown = 0;

  for (const category of cats) {
    if (opts.signal?.aborted) break;
    const isCustom = !(category in DISCOVERY_QUERIES);
    // Built-ins stay on the trusted allowlist; custom topics can take broader web hits.
    const minAuthority = opts.minAuthority ?? (isCustom ? 0 : 3);
    const label = category.replace(/_/g, " ");
    const knownForCat = knownUrlsByCategory.get(category) ?? [];
    // Ask Firecrawl for a few extra hits so filtering known URLs still leaves new ones.
    const fetchLimit = Math.min(
      10,
      searchLimit + Math.min(4, Math.floor(knownForCat.length / 3))
    );

    opts.onProgress?.({
      phase: "discover",
      done: doneCats,
      total,
      added,
      message:
        knownForCat.length > 0
          ? `Searching for new ${label} sources (skipping ${knownForCat.length} already in library)…`
          : `Searching for ${label} sources…`,
    });

    const trusted = new Map<string, { url: string; title: string; authority: number }>();
    const fallback = new Map<string, { url: string; title: string; authority: number }>();
    let catHits = 0;
    let catSkippedKnown = 0;

    for (const query of queryMap[category] || []) {
      if (opts.signal?.aborted) break;
      let results: Awaited<ReturnType<typeof firecrawlSearch>> = [];
      try {
        // Firecrawl /v2/search via managed websearch (no per-hit scrape here).
        // excludeUrls steers the query away from pages we already ingested.
        results = await firecrawlSearch(query, fetchLimit, {
          scrape: false,
          throwOnError: true,
          excludeUrls: knownForCat,
        });
      } catch (err) {
        searchErrors += 1;
        opts.onProgress?.({
          phase: "discover",
          done: doneCats,
          total,
          added,
          message: `Firecrawl search failed for “${query.slice(0, 40)}”: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        continue;
      }
      if (results.length === 0) {
        searchErrors += 1;
        opts.onProgress?.({
          phase: "discover",
          done: doneCats,
          total,
          added,
          message: `Firecrawl returned 0 hits for “${query.slice(0, 48)}”`,
        });
        continue;
      }
      catHits += results.length;
      searchHits += results.length;
      for (const r of results) {
        if (!r.url || !/^https?:\/\//i.test(r.url)) continue;
        const norm = normalizeReferenceUrl(r.url);
        if (existing.has(norm)) {
          catSkippedKnown += 1;
          skippedKnown += 1;
          continue;
        }
        if (trusted.has(norm) || fallback.has(norm)) continue;
        const auth = authorityOf(r.url);
        const row = {
          url: r.url,
          title: (r.title || r.url).slice(0, 200),
          authority: auth > 0 ? auth : 2,
        };
        if (auth >= minAuthority && auth > 0) {
          trusted.set(norm, row);
        } else if (isCustom) {
          // Custom topics (e.g. product sense) often live off the eng allowlist.
          fallback.set(norm, row);
        }
      }
    }

    const picks = [
      ...[...trusted.values()].sort((a, b) => b.authority - a.authority),
      ...[...fallback.values()].sort((a, b) => a.title.localeCompare(b.title)),
    ].slice(0, maxNew);

    opts.onProgress?.({
      phase: "discover",
      done: doneCats,
      total,
      added,
      message:
        picks.length > 0
          ? `${label}: ${catHits} hits → ${catSkippedKnown} already known, trying ${picks.length} new…`
          : `${label}: ${catHits} hits → 0 new (skipped ${catSkippedKnown} already in library).`,
    });

    for (const p of picks) {
      if (opts.signal?.aborted) break;
      const norm = normalizeReferenceUrl(p.url);
      // Race-safe: another category may have just added this URL.
      if (existing.has(norm)) {
        skippedKnown += 1;
        continue;
      }
      try {
        const md = await firecrawlScrape(p.url);
        if (!md || md.length < 300) {
          scrapeFails += 1;
          opts.onProgress?.({
            phase: "discover",
            done: doneCats,
            total,
            added,
            message: `Skipped ${domainOf(p.url)} (page empty or too short)`,
          });
          continue;
        }
        const n = await ingestMarkdown(
          {
            category,
            title: p.title,
            url: p.url,
            source_type: sourceTypeOf(p.url),
            authority: p.authority,
          },
          md
        );
        if (n > 0) {
          existing.add(norm);
          const list = knownUrlsByCategory.get(category) ?? [];
          list.push(p.url);
          knownUrlsByCategory.set(category, list);
          added += n;
          sources += 1;
          opts.onProgress?.({
            phase: "discover",
            done: doneCats,
            total,
            added,
            message: `+ ${label} · ${domainOf(p.url)} (${n} chunks)`,
          });
        } else {
          scrapeFails += 1;
        }
      } catch (err) {
        scrapeFails += 1;
        opts.onProgress?.({
          phase: "discover",
          done: doneCats,
          total,
          added,
          message: `Failed ${domainOf(p.url)}: ${err instanceof Error ? err.message : "error"}`,
        });
      }
    }
    doneCats += 1;
  }

  const whyZero =
    sources === 0
      ? searchHits === 0
        ? searchErrors > 0
          ? " Firecrawl Search returned no usable hits (see errors above)."
          : " Firecrawl Search returned 0 hits."
        : skippedKnown > 0 && scrapeFails === 0
          ? ` All ${skippedKnown} hit${skippedKnown === 1 ? "" : "s"} were already in the library, nothing new to scrape.`
          : scrapeFails > 0
            ? ` Firecrawl found ${searchHits} URLs but scrapes failed or pages were empty.`
            : ` Firecrawl found ${searchHits} URLs but none were new/usable.`
      : "";

  const skippedNote =
    skippedKnown > 0 && sources > 0
      ? ` Skipped ${skippedKnown} already-known URL${skippedKnown === 1 ? "" : "s"}.`
      : "";

  opts.onProgress?.({
    phase: "discover",
    done: doneCats,
    total,
    added,
    message: opts.signal?.aborted
      ? `Stopped. Added ${sources} sources / ${added} chunks.`
      : `Done. Added ${sources} new sources / ${added} chunks.${skippedNote}${whyZero}`,
  });
  return { added, sources };
}
