-- Semantic memory store for long-term recall.
-- Holds embedded chunks from past conversations, ingested local files, and notes.
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('conversation', 'file', 'note')),
    content TEXT NOT NULL,
    source TEXT,                 -- conversation id, file path, or label
    source_label TEXT,           -- human-friendly label (file name / conversation title)
    embedding TEXT,              -- JSON array of floats (embedding vector)
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
