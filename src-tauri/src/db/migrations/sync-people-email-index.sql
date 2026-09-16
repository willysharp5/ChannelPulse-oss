-- Migration 8: re-scope the unique-email index so a soft-deleted person doesn't
-- block re-adding the same email later. Split out from migration 7 (which was
-- already applied) — an applied migration must never be modified.
DROP INDEX IF EXISTS idx_people_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_email
    ON people(email) WHERE email IS NOT NULL AND deleted_at IS NULL;
