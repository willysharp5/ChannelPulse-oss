import { getDatabase } from "./config";
import { ChatConversation } from "@/types";
import { safeLocalStorage } from "@/lib";
import { scheduleSync } from "@/lib/sync";
import {
  applyMessageMeta,
  serializeMessageMeta,
  withInferredOrigins,
} from "@/lib/chat/transcript";

// Legacy localStorage key for migration purposes
const LEGACY_CHAT_HISTORY_KEY = "chat_history";

/**
 * Database conversation type (flattened for SQL)
 */
interface DbConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/**
 * Database message type (flattened for SQL)
 */
interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attached_files: string | null; // JSON string
  meta?: string | null; // JSON: speaker, origin, citations, …
}

/**
 * Safely parse JSON with error handling
 */
function safeJsonParse<T>(jsonString: string | null, fallback: T): T {
  if (!jsonString) return fallback;
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Failed to parse JSON:", error);
    return fallback;
  }
}

/**
 * Validate conversation data
 */
function validateConversation(conversation: ChatConversation): boolean {
  if (!conversation.id || typeof conversation.id !== "string") {
    console.error("Invalid conversation: missing or invalid id");
    return false;
  }
  if (!conversation.title || typeof conversation.title !== "string") {
    console.error("Invalid conversation: missing or invalid title");
    return false;
  }
  if (!Array.isArray(conversation.messages)) {
    console.error("Invalid conversation: messages is not an array");
    return false;
  }
  return true;
}

/**
 * Validate message data
 */
function validateMessage(message: any): boolean {
  if (!message.id || typeof message.id !== "string") {
    console.error("Invalid message: missing or invalid id");
    return false;
  }
  if (
    !message.role ||
    !["user", "assistant", "system"].includes(message.role)
  ) {
    console.error("Invalid message: missing or invalid role");
    return false;
  }
  if (typeof message.content !== "string") {
    console.error("Invalid message: content must be a string");
    return false;
  }
  if (typeof message.timestamp !== "number" || message.timestamp < 0) {
    console.error("Invalid message: invalid timestamp");
    return false;
  }
  return true;
}

function mapDbMessage(msg: DbMessage, conversationId?: string) {
  const base = applyMessageMeta(
    {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      attachedFiles: safeJsonParse(msg.attached_files, undefined),
    },
    msg.meta
  );
  return withInferredOrigins([base], conversationId)[0];
}

/**
 * Create a new conversation with transaction safety
 */
export async function createConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    // Insert conversation
    await db.execute(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [
        conversation.id,
        conversation.title,
        conversation.createdAt || Date.now(),
        conversation.updatedAt || Date.now(),
      ]
    );

    // Insert all messages
    for (const message of conversation.messages) {
      if (!validateMessage(message)) {
        console.warn("Skipping invalid message in conversation creation");
        continue;
      }

      const attachedFilesJson = message.attachedFiles
        ? JSON.stringify(message.attachedFiles)
        : null;
      const metaJson = serializeMessageMeta(message);

      await db.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          message.id,
          conversation.id,
          message.role,
          message.content,
          message.timestamp,
          attachedFilesJson,
          metaJson,
        ]
      );
    }

    scheduleSync();
    return conversation;
  } catch (error) {
    console.error("Failed to create conversation:", error);
    // Rollback: delete conversation if message insertion failed
    await db
      .execute("DELETE FROM conversations WHERE id = ?", [conversation.id])
      .catch(() => {});
    throw error;
  }
}

/**
 * Get all conversations with messages in a single optimized query
 */
export async function getAllConversations(): Promise<ChatConversation[]> {
  const db = await getDatabase();

  try {
    // Get all conversations (skip soft-deleted rows)
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC"
    );

    if (conversations.length === 0) {
      return [];
    }

    // Get all messages for these conversations in one query
    const conversationIds = conversations.map((c) => c.id);
    const placeholders = conversationIds.map(() => "?").join(",");
    const allMessages = await db.select<DbMessage[]>(
      `SELECT * FROM messages WHERE conversation_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY conversation_id, timestamp ASC`,
      conversationIds
    );

    // Group messages by conversation_id
    const messagesByConversation = new Map<string, DbMessage[]>();
    for (const msg of allMessages) {
      if (!messagesByConversation.has(msg.conversation_id)) {
        messagesByConversation.set(msg.conversation_id, []);
      }
      messagesByConversation.get(msg.conversation_id)!.push(msg);
    }

    // Build result
    return conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages:
        messagesByConversation.get(conv.id)?.map((m) => mapDbMessage(m, conv.id)) ||
        [],
    }));
  } catch (error) {
    console.error("Failed to get all conversations:", error);
    throw error;
  }
}

/**
 * Lightweight conversation summary for list/dashboard views — no messages, so
 * we never load an entire transcript just to render a row. `preview` is the
 * first message, `firstUserMessage` the first user turn (both may be null).
 */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string | null;
  firstUserMessage: string | null;
}

/**
 * Collapse whitespace and cap a preview so a single long message can't blow up
 * the list payload.
 */
function normalizePreview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Get lightweight summaries for every conversation (list/dashboard views).
 *
 * This deliberately avoids pulling every message: a few set-based queries
 * (conversation rows, one COUNT aggregate, and one window-function pass for the
 * preview + first user message) instead of the full transcript join that
 * getAllConversations does.
 */
export async function getConversationSummaries(): Promise<ConversationSummary[]> {
  const db = await getDatabase();

  try {
    // Conversation rows only (skip soft-deleted).
    const conversations = await db.select<DbConversation[]>(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC"
    );

    if (conversations.length === 0) {
      return [];
    }

    // One aggregate pass over the whole messages table for per-conversation
    // counts — cheap, and no big IN(...) list needed.
    const counts = await db.select<
      { conversation_id: string; count: number }[]
    >(
      "SELECT conversation_id, COUNT(*) AS count FROM messages WHERE deleted_at IS NULL GROUP BY conversation_id"
    );
    const countByConversation = new Map<string, number>();
    for (const row of counts) {
      countByConversation.set(row.conversation_id, row.count);
    }

    // Earliest message (preview) and earliest user message (firstUserMessage)
    // per conversation in a single pass, using window functions so we never
    // pull every row. rn_all=1 → the first message overall; rn_user=1 with
    // role='user' → the first user message.
    const previewRows = await db.select<
      {
        conversation_id: string;
        content: string;
        role: string;
        rn_all: number;
        rn_user: number;
      }[]
    >(
      `SELECT conversation_id, content, role, rn_all, rn_user FROM (
         SELECT
           conversation_id,
           content,
           role,
           ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY timestamp ASC) AS rn_all,
           ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY (role = 'user') DESC, timestamp ASC) AS rn_user
         FROM messages
         WHERE deleted_at IS NULL
       ) WHERE rn_all = 1 OR rn_user = 1`
    );

    const previewByConversation = new Map<string, string>();
    const firstUserByConversation = new Map<string, string>();
    for (const row of previewRows) {
      if (row.rn_all === 1) {
        previewByConversation.set(row.conversation_id, row.content);
      }
      if (row.rn_user === 1 && row.role === "user") {
        firstUserByConversation.set(row.conversation_id, row.content);
      }
    }

    return conversations.map((conv) => {
      const preview = previewByConversation.get(conv.id);
      const firstUserMessage = firstUserByConversation.get(conv.id);
      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        messageCount: countByConversation.get(conv.id) ?? 0,
        preview: preview != null ? normalizePreview(preview) : null,
        firstUserMessage: firstUserMessage ?? null,
      };
    });
  } catch (error) {
    console.error("Failed to get conversation summaries:", error);
    throw error;
  }
}

/**
 * DB-backed transcript search. Returns a Map of conversationId → a short
 * snippet around the FIRST match in that conversation. Only the first matching
 * message per conversation gets a snippet — enough to badge/highlight a row
 * without pulling whole transcripts into memory.
 */
export async function searchConversationTranscripts(
  query: string,
  limit?: number
): Promise<Map<string, string>> {
  const snippets = new Map<string, string>();

  const trimmed = query.trim();
  if (!trimmed) {
    return snippets;
  }

  const db = await getDatabase();

  try {
    // Escape LIKE wildcards (% and _) so they're matched literally; pair with
    // an ESCAPE clause. SQLite LIKE is case-insensitive for ASCII by default.
    const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
    const rows = await db.select<
      { conversation_id: string; content: string }[]
    >(
      `SELECT conversation_id, content FROM messages
       WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\'
       ORDER BY conversation_id, timestamp ASC
       LIMIT ?`,
      [`%${escaped}%`, limit ?? 2000]
    );

    const lowerQuery = trimmed.toLowerCase();
    for (const row of rows) {
      // Only the first matching message per conversation needs a snippet
      // (rows are ordered by conversation_id, timestamp ASC).
      if (snippets.has(row.conversation_id)) continue;
      const content = row.content;
      const idx = content.toLowerCase().indexOf(lowerQuery);
      if (idx === -1) continue;
      // Mirror the getSnippet window used in the chats list: a bit of leading
      // context, the match, and a bit of trailing context (~90 chars).
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + trimmed.length + 60);
      const snippet =
        (start > 0 ? "…" : "") +
        content.slice(start, end).trim() +
        (end < content.length ? "…" : "");
      snippets.set(row.conversation_id, snippet);
    }

    return snippets;
  } catch (error) {
    console.error("Failed to search conversation transcripts:", error);
    return snippets;
  }
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(
  id: string
): Promise<ChatConversation | null> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return null;
  }

  const db = await getDatabase();

  try {
    // Get conversation (skip soft-deleted)
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL",
      [id]
    );

    if (conversations.length === 0) {
      return null;
    }

    const conv = conversations[0];

    // Get messages (skip soft-deleted)
    const messages = await db.select<DbMessage[]>(
      "SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY timestamp ASC",
      [id]
    );

    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map((m) => mapDbMessage(m, id)),
    };
  } catch (error) {
    console.error(`Failed to get conversation ${id}:`, error);
    return null;
  }
}

/**
 * Update a conversation with transaction safety
 */
export async function updateConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    // Update conversation
    const updateResult = await db.execute(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
      [conversation.title, conversation.updatedAt, conversation.id]
    );

    if (updateResult.rowsAffected === 0) {
      throw new Error("Conversation not found");
    }

    // Upsert the provided messages and soft-delete any that were removed, so
    // deletions still propagate to the server (a hard delete + reinsert would
    // lose the tombstone). Upserting clears any prior tombstone (deleted_at).
    const providedIds = conversation.messages
      .filter(validateMessage)
      .map((m) => m.id);

    // Soft-delete messages that are no longer part of the conversation.
    const now = Date.now();
    if (providedIds.length > 0) {
      const ph = providedIds.map(() => "?").join(",");
      await db.execute(
        `UPDATE messages SET deleted_at = ? WHERE conversation_id = ? AND deleted_at IS NULL AND id NOT IN (${ph})`,
        [now, conversation.id, ...providedIds]
      );
    } else {
      await db.execute(
        "UPDATE messages SET deleted_at = ? WHERE conversation_id = ? AND deleted_at IS NULL",
        [now, conversation.id]
      );
    }

    for (const message of conversation.messages) {
      if (!validateMessage(message)) {
        console.warn("Skipping invalid message in conversation update");
        continue;
      }

      const attachedFilesJson = message.attachedFiles
        ? JSON.stringify(message.attachedFiles)
        : null;
      const metaJson = serializeMessageMeta(message);

      await db.execute(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, meta, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           role = excluded.role,
           content = excluded.content,
           timestamp = excluded.timestamp,
           attached_files = excluded.attached_files,
           meta = excluded.meta,
           deleted_at = NULL`,
        [
          message.id,
          conversation.id,
          message.role,
          message.content,
          message.timestamp,
          attachedFilesJson,
          metaJson,
        ]
      );
    }

    scheduleSync();
    return conversation;
  } catch (error) {
    console.error("Failed to update conversation:", error);
    throw error;
  }
}

/**
 * Save or update a conversation (upsert operation)
 */
export async function saveConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  try {
    const existing = await getConversationById(conversation.id);

    if (existing) {
      return await updateConversation(conversation);
    } else {
      return await createConversation(conversation);
    }
  } catch (error) {
    console.error("Failed to save conversation:", error);
    throw error;
  }
}

/**
 * Delete a conversation and all its messages
 */
export async function deleteConversation(id: string): Promise<boolean> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return false;
  }

  const db = await getDatabase();

  try {
    // Soft delete so the removal syncs (a tombstone) instead of vanishing.
    const now = Date.now();
    await db.execute(
      "UPDATE messages SET deleted_at = ? WHERE conversation_id = ? AND deleted_at IS NULL",
      [now, id]
    );
    const result = await db.execute(
      "UPDATE conversations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
      [now, id]
    );

    scheduleSync();
    return result.rowsAffected > 0;
  } catch (error) {
    console.error(`Failed to delete conversation ${id}:`, error);
    throw error;
  }
}

/**
 * Delete all conversations and messages
 */
export async function deleteAllConversations(): Promise<void> {
  const db = await getDatabase();

  try {
    // Soft delete everything so the removals sync as tombstones.
    const now = Date.now();
    await db.execute(
      "UPDATE messages SET deleted_at = ? WHERE deleted_at IS NULL",
      [now]
    );
    await db.execute(
      "UPDATE conversations SET deleted_at = ? WHERE deleted_at IS NULL",
      [now]
    );
    scheduleSync();
  } catch (error) {
    console.error("Failed to delete all conversations:", error);
    throw error;
  }
}

/**
 * Return the user message as the conversation title
 */
export function generateConversationTitle(userMessage: string): string {
  return userMessage.trim();
}

/**
 * Migrate chat history from localStorage to SQLite
 * This function safely moves all existing localStorage chat history to the database
 */
export async function migrateLocalStorageToSQLite(): Promise<{
  success: boolean;
  migratedCount: number;
  error?: string;
}> {
  const migrationKey = "chat_history_migrated_to_sqlite";

  try {
    // Check if migration has already been done
    if (safeLocalStorage.getItem(migrationKey) === "true") {
      return { success: true, migratedCount: 0 };
    }

    // Get existing localStorage data
    const existingData = safeLocalStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
    if (!existingData) {
      // No data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Parse localStorage conversations
    let conversations: ChatConversation[] = [];
    try {
      const parsed = JSON.parse(existingData);
      conversations = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.error("Failed to parse localStorage chat history:", parseError);
      // Mark as migrated anyway to prevent repeated failures
      safeLocalStorage.setItem(migrationKey, "true");
      return {
        success: false,
        migratedCount: 0,
        error: "Failed to parse localStorage data",
      };
    }

    if (conversations.length === 0) {
      // No valid data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Get database instance
    const db = await getDatabase();

    // Migrate each conversation
    let migratedCount = 0;
    let errorCount = 0;

    for (const conversation of conversations) {
      try {
        // Validate conversation data
        if (!conversation?.id || !conversation?.title) {
          console.warn("Skipping invalid conversation:", conversation);
          errorCount++;
          continue;
        }

        // Check if conversation already exists in database
        const existing = await getConversationById(conversation.id);
        if (existing) {
          console.log(
            `Conversation ${conversation.id} already exists, skipping`
          );
          continue;
        }

        // Insert conversation
        await db.execute(
          "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
          [
            conversation.id,
            conversation.title,
            conversation.createdAt || Date.now(),
            conversation.updatedAt || Date.now(),
          ]
        );

        // Insert messages
        if (
          Array.isArray(conversation.messages) &&
          conversation.messages.length > 0
        ) {
          for (const message of conversation.messages) {
            // Validate message
            if (
              !message?.id ||
              !message?.role ||
              typeof message?.content !== "string"
            ) {
              console.warn(
                `Skipping invalid message in conversation ${conversation.id}:`,
                message
              );
              continue;
            }

            const attachedFilesJson = message.attachedFiles
              ? JSON.stringify(message.attachedFiles)
              : null;
            const metaJson = serializeMessageMeta(message as any);

            await db.execute(
              "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                message.id,
                conversation.id,
                message.role,
                message.content,
                message.timestamp || Date.now(),
                attachedFilesJson,
                metaJson,
              ]
            );
          }
        }

        migratedCount++;
      } catch (convError) {
        console.error(
          `Failed to migrate conversation ${conversation?.id}:`,
          convError
        );
        errorCount++;
        // Clean up partially migrated conversation
        await db
          .execute("DELETE FROM conversations WHERE id = ?", [conversation?.id])
          .catch(() => {});
      }
    }

    // Mark migration as complete even if some failed
    safeLocalStorage.setItem(migrationKey, "true");

    // Clear localStorage chat history after migration attempt
    safeLocalStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);

    const message =
      errorCount > 0
        ? `Migrated ${migratedCount}/${conversations.length} conversations (${errorCount} failed)`
        : `Successfully migrated ${migratedCount} conversations`;

    console.log(message);

    return {
      success: migratedCount > 0 || errorCount === 0,
      migratedCount,
      error:
        errorCount > 0
          ? `${errorCount} conversations failed to migrate`
          : undefined,
    };
  } catch (error) {
    console.error("Migration failed:", error);
    // Mark as attempted to prevent infinite retry loops
    safeLocalStorage.setItem(migrationKey, "true");
    return {
      success: false,
      migratedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
