export interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
  /**
   * Stable cross-device id. Unlike the autoincrement `id` (which differs per
   * device), `sync_id` is the same row everywhere, so it's how we sync which
   * persona is active. Populated by `SELECT *`; may be absent on rows created
   * before the sync migration ran.
   */
  sync_id?: string | null;
}

export interface SystemPromptInput {
  name: string;
  prompt: string;
}

export interface UpdateSystemPromptInput {
  name?: string;
  prompt?: string;
}
