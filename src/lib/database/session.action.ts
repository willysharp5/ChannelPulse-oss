import { getDatabase } from "./config";
import { scheduleSync } from "@/lib/sync";

export interface MemorySession {
  id: string;
  name: string;
  created_at: number;
}

function makeSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(name: string): Promise<MemorySession> {
  const db = await getDatabase();
  const session: MemorySession = {
    id: makeSessionId(),
    name: name.trim() || "Untitled session",
    created_at: Date.now(),
  };
  await db.execute(
    "INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)",
    [session.id, session.name, session.created_at]
  );
  scheduleSync();
  return session;
}

export async function listSessions(): Promise<MemorySession[]> {
  const db = await getDatabase();
  return db.select<MemorySession[]>(
    "SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC"
  );
}

/** Escape LIKE wildcards so a search term is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Paginated + searchable session listing for the memory-space picker. Loads a
 * page at a time (newest first) so we never pull every space at once.
 */
export async function listSessionsPaged(opts: {
  query?: string;
  limit: number;
  offset: number;
}): Promise<MemorySession[]> {
  const db = await getDatabase();
  const q = (opts.query ?? "").trim();
  if (q) {
    return db.select<MemorySession[]>(
      "SELECT * FROM sessions WHERE deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [`%${escapeLike(q)}%`, opts.limit, opts.offset]
    );
  }
  return db.select<MemorySession[]>(
    "SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [opts.limit, opts.offset]
  );
}

export async function renameSession(id: string, name: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE sessions SET name = ? WHERE id = ?", [
    name.trim() || "Untitled session",
    id,
  ]);
  scheduleSync();
}

/**
 * Delete a session and all memories scoped to it (files + conversation recall).
 * Global memories (session_id IS NULL) are untouched.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDatabase();
  // Soft delete so removals sync as tombstones.
  const now = Date.now();
  await db.execute(
    "UPDATE memories SET deleted_at = ? WHERE session_id = ? AND deleted_at IS NULL",
    [now, id]
  );
  await db.execute(
    "UPDATE sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
    [now, id]
  );
  scheduleSync();
}

export async function getSessionById(
  id: string
): Promise<MemorySession | null> {
  const db = await getDatabase();
  const rows = await db.select<MemorySession[]>(
    "SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  return rows[0] ?? null;
}
