import { getDatabase } from "./config";
import { cosineSimilarity } from "@/lib/memory/embeddings";
import { scheduleSync } from "@/lib/sync";

export type MemoryKind = "conversation" | "file" | "note" | "summary";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string | null;
  source_label: string | null;
  embedding: number[] | null;
  created_at: number;
  session_id: string | null;
}

interface DbMemoryRow {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string | null;
  source_label: string | null;
  embedding: string | null;
  created_at: number;
  session_id: string | null;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
}

export interface MemorySourceSummary {
  source: string;
  source_label: string | null;
  kind: MemoryKind;
  chunks: number;
  created_at: number;
}

function makeId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/** Insert a single memory chunk. `sessionId` scopes it (null = global). */
export async function insertMemory(params: {
  kind: MemoryKind;
  content: string;
  embedding: number[];
  source?: string | null;
  sourceLabel?: string | null;
  sessionId?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT INTO memories (id, kind, content, source, source_label, embedding, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      makeId(),
      params.kind,
      params.content,
      params.source ?? null,
      params.sourceLabel ?? null,
      JSON.stringify(params.embedding),
      Date.now(),
      params.sessionId ?? null,
    ]
  );
  scheduleSync();
}

/** Insert many chunks that share a source (e.g. all chunks of one file). */
export async function insertMemories(
  items: Array<{
    kind: MemoryKind;
    content: string;
    embedding: number[];
    source?: string | null;
    sourceLabel?: string | null;
    sessionId?: string | null;
  }>
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  for (const item of items) {
    await db.execute(
      "INSERT INTO memories (id, kind, content, source, source_label, embedding, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        makeId(),
        item.kind,
        item.content,
        item.source ?? null,
        item.sourceLabel ?? null,
        JSON.stringify(item.embedding),
        now,
        item.sessionId ?? null,
      ]
    );
  }
  scheduleSync();
}

/**
 * Semantic search over stored memories using brute-force cosine similarity.
 * Fine for up to tens of thousands of rows on-device.
 */
export async function searchMemories(
  queryEmbedding: number[],
  options: {
    topK?: number;
    minScore?: number;
    kinds?: MemoryKind[];
    /** Restrict to a session. undefined/null = global scope only. */
    sessionId?: string | null;
    /** When a session is active, also include global memories (default true). */
    includeGlobal?: boolean;
    /** Ignore session scoping entirely (Global "all memories" view). */
    allScopes?: boolean;
    /** Sources to exclude (e.g. files the user turned off for global use). */
    excludeSources?: string[];
    /** Only include memories created at/after this epoch-ms. */
    from?: number | null;
    /** Only include memories created at/before this epoch-ms. */
    to?: number | null;
  } = {}
): Promise<MemorySearchResult[]> {
  const {
    topK = 4,
    minScore = 0.2,
    kinds,
    sessionId,
    includeGlobal = true,
    allScopes = false,
    excludeSources,
    from,
    to,
  } = options;
  const excluded = new Set(excludeSources ?? []);
  const db = await getDatabase();

  let sql =
    "SELECT * FROM memories WHERE embedding IS NOT NULL AND deleted_at IS NULL";
  const args: any[] = [];
  if (kinds && kinds.length > 0) {
    sql += ` AND kind IN (${kinds.map(() => "?").join(",")})`;
    args.push(...kinds);
  }
  if (from != null) {
    sql += " AND created_at >= ?";
    args.push(from);
  }
  if (to != null) {
    sql += " AND created_at <= ?";
    args.push(to);
  }

  // Session scoping: everything (allScopes), a specific session (optionally +
  // global), or global only.
  if (!allScopes) {
    if (sessionId) {
      if (includeGlobal) {
        sql += " AND (session_id = ? OR session_id IS NULL)";
        args.push(sessionId);
      } else {
        sql += " AND session_id = ?";
        args.push(sessionId);
      }
    } else {
      sql += " AND session_id IS NULL";
    }
  }

  const rows = await db.select<DbMemoryRow[]>(sql, args);

  const scored: MemorySearchResult[] = [];
  for (const row of rows) {
    if (row.source && excluded.has(row.source)) continue;
    const embedding = parseEmbedding(row.embedding);
    if (!embedding) continue;
    const score = cosineSimilarity(queryEmbedding, embedding);
    if (score < minScore) continue;
    scored.push({
      record: {
        id: row.id,
        kind: row.kind,
        content: row.content,
        source: row.source,
        source_label: row.source_label,
        embedding,
        created_at: row.created_at,
        session_id: row.session_id ?? null,
      },
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function sessionClause(
  sessionId: string | null | undefined,
  args: any[]
): string {
  if (sessionId) {
    args.push(sessionId);
    return " AND session_id = ?";
  }
  return " AND session_id IS NULL";
}

/**
 * Scope clause for browsing/recall.
 * - `allScopes`: no filter at all (used for the "Global" view = everything).
 * - a specific session optionally also includes global (session_id IS NULL).
 * - otherwise, global-only (session_id IS NULL).
 */
function scopeClause(
  sessionId: string | null | undefined,
  opts: { includeGlobal?: boolean; allScopes?: boolean },
  args: any[]
): string {
  if (opts.allScopes) return "";
  if (sessionId) {
    args.push(sessionId);
    return opts.includeGlobal
      ? " AND (session_id = ? OR session_id IS NULL)"
      : " AND session_id = ?";
  }
  return " AND session_id IS NULL";
}

/**
 * Summarize ingested sources (mainly files) grouped by source. Scoped to a
 * session, unless `allScopes` is set (used for the Global "all memories" view).
 */
export async function listMemorySources(
  sessionId?: string | null,
  allScopes = false
): Promise<MemorySourceSummary[]> {
  const db = await getDatabase();
  const args: any[] = [];
  const scope = scopeClause(sessionId, { allScopes }, args);
  const rows = await db.select<
    Array<{
      source: string;
      source_label: string | null;
      kind: MemoryKind;
      chunks: number;
      created_at: number;
    }>
  >(
    `SELECT source,
            MAX(source_label) as source_label,
            kind,
            COUNT(*) as chunks,
            MAX(created_at) as created_at
     FROM memories
     WHERE source IS NOT NULL AND deleted_at IS NULL${scope}
     GROUP BY source, kind
     ORDER BY created_at DESC`,
    args
  );
  return rows;
}

export async function deleteMemoriesBySource(source: string): Promise<void> {
  const db = await getDatabase();
  // Soft delete so the removal syncs as a tombstone.
  await db.execute(
    "UPDATE memories SET deleted_at = ? WHERE source = ? AND deleted_at IS NULL",
    [Date.now(), source]
  );
  scheduleSync();
}

/** Fetch all chunks for a source, oldest first (so reconstructed text reads in order). */
export async function getMemoriesBySource(
  source: string
): Promise<MemoryRecord[]> {
  const db = await getDatabase();
  const rows = await db.select<DbMemoryRow[]>(
    `SELECT * FROM memories
     WHERE source = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [source]
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    content: row.content,
    source: row.source,
    source_label: row.source_label,
    embedding: parseEmbedding(row.embedding),
    created_at: row.created_at,
    session_id: row.session_id ?? null,
  }));
}

/**
 * Store (or replace) the single distilled "memory card" for a conversation.
 * All prior rows for the same conversation (its old per-turn fragments and any
 * previous summary) are removed first, so each conversation keeps exactly one
 * clean, up-to-date card.
 */
export async function upsertConversationSummary(params: {
  conversationId: string;
  title?: string | null;
  content: string;
  embedding: number[];
  sessionId?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  // Use one stable row per conversation so re-summarizing updates in place
  // (instead of churning tombstones on every debounced summary).
  const id = `sum_${params.conversationId}`;
  // Retire any legacy/duplicate summary rows for this conversation.
  await db.execute(
    "UPDATE memories SET deleted_at = ? WHERE source = ? AND id != ? AND deleted_at IS NULL",
    [now, params.conversationId, id]
  );
  await db.execute(
    `INSERT INTO memories (id, kind, content, source, source_label, embedding, created_at, session_id, deleted_at)
     VALUES (?, 'summary', ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       source_label = excluded.source_label,
       embedding = excluded.embedding,
       session_id = excluded.session_id,
       deleted_at = NULL`,
    [
      id,
      params.content,
      params.conversationId,
      params.title ?? null,
      JSON.stringify(params.embedding),
      now,
      params.sessionId ?? null,
    ]
  );
  scheduleSync();
}

/** Conversation ids that already have a compacted summary card. */
export async function getSummarizedConversationIds(): Promise<Set<string>> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ source: string | null }>>(
    "SELECT DISTINCT source FROM memories WHERE kind = 'summary' AND source IS NOT NULL AND deleted_at IS NULL"
  );
  return new Set(rows.map((r) => r.source).filter((s): s is string => !!s));
}

/** Remove the old-style per-turn conversation fragments (kept summaries/files). */
export async function clearConversationFragments(): Promise<number> {
  const db = await getDatabase();
  const before = await db.select<Array<{ n: number }>>(
    "SELECT COUNT(*) as n FROM memories WHERE kind = 'conversation' AND deleted_at IS NULL"
  );
  await db.execute(
    "UPDATE memories SET deleted_at = ? WHERE kind = 'conversation' AND deleted_at IS NULL",
    [Date.now()]
  );
  scheduleSync();
  return before[0]?.n ?? 0;
}

/** Escape LIKE wildcards so a search term is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Browse stored memories (newest first), optionally filtered by a text query,
 * kind, and session. Paginated so the settings table never loads everything.
 */
export async function listMemories(opts: {
  sessionId?: string | null;
  /** When a session is set, also include global (null-session) rows. */
  includeGlobal?: boolean;
  /** Ignore session scoping entirely (Global "all memories" view). */
  allScopes?: boolean;
  query?: string;
  kinds?: MemoryKind[];
  from?: number | null;
  to?: number | null;
  limit: number;
  offset: number;
}): Promise<MemoryRecord[]> {
  const db = await getDatabase();
  const args: any[] = [];
  let sql = "SELECT * FROM memories WHERE deleted_at IS NULL";

  if (opts.kinds && opts.kinds.length > 0) {
    sql += ` AND kind IN (${opts.kinds.map(() => "?").join(",")})`;
    args.push(...opts.kinds);
  }
  const q = (opts.query ?? "").trim();
  if (q) {
    sql += " AND content LIKE ? ESCAPE '\\'";
    args.push(`%${escapeLike(q)}%`);
  }
  if (opts.from != null) {
    sql += " AND created_at >= ?";
    args.push(opts.from);
  }
  if (opts.to != null) {
    sql += " AND created_at <= ?";
    args.push(opts.to);
  }
  sql += scopeClause(
    opts.sessionId,
    { includeGlobal: opts.includeGlobal, allScopes: opts.allScopes },
    args
  );
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  args.push(opts.limit, opts.offset);

  const rows = await db.select<DbMemoryRow[]>(sql, args);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    content: row.content,
    source: row.source,
    source_label: row.source_label,
    embedding: parseEmbedding(row.embedding),
    created_at: row.created_at,
    session_id: row.session_id ?? null,
  }));
}

/**
 * Update a memory's content. Pass a fresh `embedding` to keep semantic recall
 * accurate; omit it to leave the existing vector untouched.
 */
export async function updateMemory(
  id: string,
  content: string,
  embedding?: number[] | null
): Promise<void> {
  const db = await getDatabase();
  if (embedding && embedding.length > 0) {
    await db.execute(
      "UPDATE memories SET content = ?, embedding = ? WHERE id = ?",
      [content, JSON.stringify(embedding), id]
    );
  } else {
    await db.execute("UPDATE memories SET content = ? WHERE id = ?", [
      content,
      id,
    ]);
  }
  scheduleSync();
}

/** Delete a single memory by id (soft delete so it syncs as a tombstone). */
export async function deleteMemory(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
    [Date.now(), id]
  );
  scheduleSync();
}

/** Count memories matching the same filters as {@link listMemories} (for paging). */
export async function countMemoriesFiltered(opts: {
  sessionId?: string | null;
  /** When a session is set, also include global (null-session) rows. */
  includeGlobal?: boolean;
  /** Ignore session scoping entirely (Global "all memories" view). */
  allScopes?: boolean;
  query?: string;
  kinds?: MemoryKind[];
  from?: number | null;
  to?: number | null;
}): Promise<number> {
  const db = await getDatabase();
  const args: any[] = [];
  let sql = "SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL";
  if (opts.kinds && opts.kinds.length > 0) {
    sql += ` AND kind IN (${opts.kinds.map(() => "?").join(",")})`;
    args.push(...opts.kinds);
  }
  const q = (opts.query ?? "").trim();
  if (q) {
    sql += " AND content LIKE ? ESCAPE '\\'";
    args.push(`%${escapeLike(q)}%`);
  }
  if (opts.from != null) {
    sql += " AND created_at >= ?";
    args.push(opts.from);
  }
  if (opts.to != null) {
    sql += " AND created_at <= ?";
    args.push(opts.to);
  }
  sql += scopeClause(
    opts.sessionId,
    { includeGlobal: opts.includeGlobal, allScopes: opts.allScopes },
    args
  );
  const rows = await db.select<Array<{ n: number }>>(sql, args);
  return rows[0]?.n ?? 0;
}

export async function clearMemories(
  kind?: MemoryKind,
  sessionId?: string | null
): Promise<void> {
  const db = await getDatabase();
  const args: any[] = [Date.now()];
  // Soft delete so removals sync as tombstones.
  let sql = "UPDATE memories SET deleted_at = ? WHERE deleted_at IS NULL";
  if (kind) {
    sql += " AND kind = ?";
    args.push(kind);
  }
  sql += sessionClause(sessionId, args);
  await db.execute(sql, args);
  scheduleSync();
}

/** Aggregate memory stats across all spaces, for the dashboard overview. */
export async function getMemoryStats(): Promise<{
  conversationSnippets: number;
  fileCount: number;
}> {
  const db = await getDatabase();
  const conv = await db.select<Array<{ n: number }>>(
    "SELECT COUNT(*) as n FROM memories WHERE kind = 'conversation' AND deleted_at IS NULL"
  );
  const files = await db.select<Array<{ n: number }>>(
    "SELECT COUNT(DISTINCT source) as n FROM memories WHERE kind = 'file' AND source IS NOT NULL AND deleted_at IS NULL"
  );
  return {
    conversationSnippets: conv[0]?.n ?? 0,
    fileCount: files[0]?.n ?? 0,
  };
}

export interface SpaceCounts {
  /** Stored memories (conversation summaries + notes), excluding file chunks. */
  memories: number;
  /** Distinct local files ingested into the space. */
  files: number;
}

/**
 * Per-space memory counts for the space cards. Keyed by session id, with the
 * global scope under the `"__global__"` key. `memories` excludes file chunks
 * (those are counted as whole files in `files`).
 */
export async function getSpaceCounts(): Promise<Record<string, SpaceCounts>> {
  const db = await getDatabase();
  const GLOBAL = "__global__";
  const map: Record<string, SpaceCounts> = {};
  const ensure = (sid: string | null): SpaceCounts => {
    const key = sid ?? GLOBAL;
    if (!map[key]) map[key] = { memories: 0, files: 0 };
    return map[key];
  };

  const mems = await db.select<Array<{ sid: string | null; n: number }>>(
    "SELECT session_id as sid, COUNT(*) as n FROM memories WHERE kind != 'file' AND deleted_at IS NULL GROUP BY session_id"
  );
  for (const r of mems) ensure(r.sid).memories = r.n;

  const files = await db.select<Array<{ sid: string | null; n: number }>>(
    "SELECT session_id as sid, COUNT(DISTINCT source) as n FROM memories WHERE kind = 'file' AND source IS NOT NULL AND deleted_at IS NULL GROUP BY session_id"
  );
  for (const r of files) ensure(r.sid).files = r.n;

  return map;
}

export async function countMemories(
  kind?: MemoryKind,
  sessionId?: string | null
): Promise<number> {
  const db = await getDatabase();
  const args: any[] = [];
  let sql = "SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL";
  if (kind) {
    sql += " AND kind = ?";
    args.push(kind);
  }
  sql += sessionClause(sessionId, args);
  const rows = await db.select<Array<{ n: number }>>(sql, args);
  return rows[0]?.n ?? 0;
}
