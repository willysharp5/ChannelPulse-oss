-- Conversation memory cards / fragments removed from the product.
-- Keep kind='file' rows (resume/docs). Soft-delete the rest so sync tombstones.
UPDATE memories
SET deleted_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE kind IN ('summary', 'conversation', 'note')
  AND deleted_at IS NULL;

-- Clear People "last talked about" summaries derived from conversation memory.
UPDATE people
SET memory_summary = NULL,
    memory_updated_at = NULL
WHERE memory_summary IS NOT NULL OR memory_updated_at IS NOT NULL;
