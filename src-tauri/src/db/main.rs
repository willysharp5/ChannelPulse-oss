use tauri_plugin_sql::{Migration, MigrationKind};

/// Returns all database migrations
pub fn migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create system_prompts table with indexes and triggers
        Migration {
            version: 1,
            description: "create_system_prompts_table",
            sql: include_str!("migrations/system-prompts.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 2: Create chat history tables (conversations and messages)
        Migration {
            version: 2,
            description: "create_chat_history_tables",
            sql: include_str!("migrations/chat-history.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 3: Create semantic memory store (long-term recall + files)
        Migration {
            version: 3,
            description: "create_memories_table",
            sql: include_str!("migrations/memories.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 4: Sessions/spaces + scope memories to a session
        Migration {
            version: 4,
            description: "create_sessions_and_scope_memories",
            sql: include_str!("migrations/sessions.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 5: People directory (People Search & Memory feature)
        Migration {
            version: 5,
            description: "create_people_table",
            sql: include_str!("migrations/people.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 6: Allow the 'summary' memory kind (one card per conversation)
        Migration {
            version: 6,
            description: "memories_allow_summary_kind",
            sql: include_str!("migrations/memories-allow-summary.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 7: Sync metadata (updated_at/deleted_at/dirty) + triggers so
        // local data can replicate to Supabase and survive reinstall.
        Migration {
            version: 7,
            description: "add_sync_metadata",
            sql: include_str!("migrations/sync.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 8: exclude soft-deleted people from the unique-email index.
        Migration {
            version: 8,
            description: "people_email_index_exclude_deleted",
            sql: include_str!("migrations/sync-people-email-index.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 9: purge conversation memory cards/fragments (keep files).
        Migration {
            version: 9,
            description: "purge_conversation_memory",
            sql: include_str!("migrations/purge-conversation-memory.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 10: wipe memories + sessions (files feature removed).
        Migration {
            version: 10,
            description: "drop_memories_and_sessions_data",
            sql: include_str!("migrations/drop-memories-and-sessions.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 11: message meta (speaker/origin/citations) for transcript chat
        Migration {
            version: 11,
            description: "messages_meta",
            sql: include_str!("migrations/messages-meta.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 12: drop people table (People/Calendar feature removed)
        Migration {
            version: 12,
            description: "drop_people",
            sql: include_str!("migrations/drop-people.sql"),
            kind: MigrationKind::Up,
        },
        // Migration 13: synced_kv — sync localStorage-backed user data (profile,
        // interview practice) so it persists across devices and the web app.
        Migration {
            version: 13,
            description: "create_synced_kv_table",
            sql: include_str!("migrations/synced-kv.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
