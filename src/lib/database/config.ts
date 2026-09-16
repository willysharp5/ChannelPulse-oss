import Database from "@tauri-apps/plugin-sql";

/**
 * Database configuration
 */
export const DB_NAME = "sqlite:channelpulse.db";

let dbInstance: Database | null = null;
// Dedupe concurrent initialization. On mount several hooks call getDatabase()
// at once; without this each awaits its own Database.load() (dbInstance is only
// assigned after the await), so the DB is opened multiple times in parallel.
// On web that means several racing OPFS-VFS installs — the loser logs a
// spurious "Missing required OPFS APIs" before the shared fallback recovers.
// Caching the in-flight promise means exactly one load happens.
let dbPromise: Promise<Database> | null = null;

/**
 * Get database instance
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = Database.load(DB_NAME)
      .then((db) => {
        dbInstance = db;
        return db;
      })
      .catch((error) => {
        // Allow a later call to retry instead of caching the failure forever.
        dbPromise = null;
        throw new Error(
          `Failed to initialize database: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }
  return dbPromise;
}
