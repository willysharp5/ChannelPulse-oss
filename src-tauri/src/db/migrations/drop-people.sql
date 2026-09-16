-- People directory removed from the product.
DROP TRIGGER IF EXISTS trg_people_au;
DROP INDEX IF EXISTS idx_people_email_active;
DROP INDEX IF EXISTS idx_people_name;
DROP INDEX IF EXISTS idx_people_dirty;
DROP TABLE IF EXISTS people;
