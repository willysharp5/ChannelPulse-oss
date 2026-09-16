-- The original memories table only allowed kind IN ('conversation','file','note'),
-- so every 'summary' insert (the one distilled memory card per conversation)
-- silently failed the CHECK constraint. SQLite can't ALTER a CHECK, so rebuild
-- the table with 'summary' allowed, preserving existing rows and the session_id
-- column added in migration 4.
CREATE TABLE memories_new (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('conversation', 'file', 'note', 'summary')),
    content TEXT NOT NULL,
    source TEXT,
    source_label TEXT,
    embedding TEXT,
    created_at INTEGER NOT NULL,
    session_id TEXT
);

INSERT INTO memories_new (id, kind, content, source, source_label, embedding, created_at, session_id)
    SELECT id, kind, content, source, source_label, embedding, created_at, session_id
    FROM memories;

DROP TABLE memories;
ALTER TABLE memories_new RENAME TO memories;

CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
