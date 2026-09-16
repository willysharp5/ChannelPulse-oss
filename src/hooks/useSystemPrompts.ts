import { useCallback, useEffect, useState } from "react";
import {
  createSystemPrompt,
  getAllSystemPrompts,
  getSystemPromptById,
  updateSystemPrompt,
  deleteSystemPrompt,
} from "@/lib/database";
import type {
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { subscribeSync } from "@/lib/sync";
import { setSyncedItem, onSyncedKeys } from "@/lib/sync/kv";
import { useApp } from "@/contexts";

export const useSystemPrompts = () => {
  const { setSystemPrompt } = useApp();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(
    () => {
      const stored = safeLocalStorage.getItem(
        STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID
      );
      return stored ? Number(stored) : null;
    }
  );

  /**
   * Fetch all system prompts from database
   */
  const fetchPrompts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAllSystemPrompts();
      setPrompts(result);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch system prompts";
      setError(errorMessage);
      console.error("Error fetching system prompts:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new system prompt
   */
  const createPrompt = useCallback(
    async (input: SystemPromptInput): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await createSystemPrompt(input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to create system prompt";
        setError(errorMessage);
        console.error("Error creating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Update an existing system prompt
   */
  const updatePrompt = useCallback(
    async (
      id: number,
      input: UpdateSystemPromptInput
    ): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await updateSystemPrompt(id, input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to update system prompt";
        setError(errorMessage);
        console.error("Error updating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Delete a system prompt
   */
  const deletePrompt = useCallback(
    async (id: number): Promise<void> => {
      try {
        setError(null);
        await deleteSystemPrompt(id);
        await fetchPrompts(); // Refresh list
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete system prompt";
        setError(errorMessage);
        console.error("Error deleting system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Refresh prompts list
   */
  const refreshPrompts = useCallback(async () => {
    await fetchPrompts();
  }, [fetchPrompts]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Fetch prompts on mount
  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  // Re-fetch after a sync completes. Personas live in the synced `system_prompts`
  // table, but on the web app (and on a fresh install) the local DB starts empty
  // and they only arrive via the background sync a few seconds after launch —
  // without this, the list keeps showing the empty snapshot taken at mount. Also
  // picks up personas created on other devices.
  useEffect(() => {
    let lastSeen = 0;
    return subscribeSync((s) => {
      if (s.status === "success" && s.lastSyncedAt && s.lastSyncedAt !== lastSeen) {
        lastSeen = s.lastSyncedAt;
        void fetchPrompts();
      }
    });
  }, [fetchPrompts]);

  /**
   * Load selected prompt on mount and when prompts change
   */
  useEffect(() => {
    if (selectedPromptId && prompts.length > 0) {
      const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
      if (selectedPrompt) {
        setSystemPrompt(selectedPrompt.prompt);
      } else {
        // Selected prompt was deleted, reset to default
        setSelectedPromptId(null);
        safeLocalStorage.removeItem(STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID);
        const currentPrompt = safeLocalStorage.getItem(
          STORAGE_KEYS.SYSTEM_PROMPT
        );
        if (!currentPrompt) {
          setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            DEFAULT_SYSTEM_PROMPT
          );
        }
      }
    }
  }, [prompts, selectedPromptId, setSystemPrompt]);

  /**
   * Make a persona the active one on THIS device: update the app's live system
   * prompt and the device-local pointers. Does not touch synced state — callers
   * decide whether the change originated here (sync it) or arrived from another
   * device (apply only).
   */
  const applyPromptLocally = useCallback(
    (prompt: SystemPrompt) => {
      setSystemPrompt(prompt.prompt);
      setSelectedPromptId(prompt.id);
      safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, prompt.prompt);
      safeLocalStorage.setItem(
        STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
        prompt.id.toString()
      );
    },
    [setSystemPrompt]
  );

  /**
   * Apply a persona selection made on another device. The active persona syncs
   * as a stable `sync_id` (see handleSelectPrompt); here we resolve it to this
   * device's local row and switch to it. Runs when prompts load and whenever the
   * synced value is hydrated by a pull, so the choice lands within seconds even
   * if the persona row itself only just arrived. Applies only when it actually
   * differs, so it never fights a fresh local selection or loops on its own push.
   */
  useEffect(() => {
    const reconcile = () => {
      const syncId = safeLocalStorage.getItem(
        STORAGE_KEYS.SELECTED_PERSONA_SYNC_ID
      );
      if (!syncId || prompts.length === 0) return;
      const match = prompts.find((p) => p.sync_id === syncId);
      if (match && match.id !== selectedPromptId) {
        applyPromptLocally(match);
      }
    };
    reconcile();
    return onSyncedKeys([STORAGE_KEYS.SELECTED_PERSONA_SYNC_ID], reconcile);
  }, [prompts, selectedPromptId, applyPromptLocally]);

  /**
   * Handle selecting a prompt (user action on this device). Applies locally and
   * syncs the choice by the persona's stable `sync_id` so other devices switch
   * to the same persona (see the reconcile effect below).
   */
  const handleSelectPrompt = useCallback(
    async (promptId: number) => {
      // A just-created prompt won't be in `prompts` state yet (the refetch
      // hasn't re-rendered), so fall back to reading it straight from the DB —
      // otherwise selecting a freshly-added template would silently no-op.
      const selectedPrompt =
        prompts.find((p) => p.id === promptId) ??
        (await getSystemPromptById(promptId)) ??
        null;
      if (!selectedPrompt) return;
      applyPromptLocally(selectedPrompt);
      if (selectedPrompt.sync_id) {
        setSyncedItem(
          STORAGE_KEYS.SELECTED_PERSONA_SYNC_ID,
          selectedPrompt.sync_id
        );
      }
    },
    [prompts, applyPromptLocally]
  );

  return {
    prompts,
    isLoading,
    error,
    selectedPromptId,
    createPrompt,
    updatePrompt,
    deletePrompt,
    refreshPrompts,
    clearError,
    handleSelectPrompt,
  };
};
