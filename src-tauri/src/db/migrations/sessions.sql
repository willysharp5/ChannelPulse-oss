-- Sessions (a.k.a. "spaces") let memory + documents be scoped to a specific
-- context, e.g. a particular interview, instead of the whole app.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Scope a memory chunk to a session. NULL means global (applies everywhere).
ALTER TABLE memories ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
