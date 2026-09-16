-- People directory for the "People Search & Memory" feature.
-- Stores everyone you meet (from calendar attendees or added manually) plus a
-- structured, LLM-distilled "snapshot" and a summary of what you last talked
-- about with them.
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,                    -- primary email (used to dedupe attendees)
    company TEXT,
    title TEXT,
    linkedin_url TEXT,
    snapshot TEXT,                 -- JSON: structured deep-search snapshot card
    snapshot_updated_at INTEGER,   -- when the snapshot was last refreshed
    memory_summary TEXT,           -- "what you last talked about" summary
    memory_updated_at INTEGER,
    notes TEXT,                    -- free-text notes the user keeps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_email ON people(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
CREATE INDEX IF NOT EXISTS idx_people_updated_at ON people(updated_at DESC);
