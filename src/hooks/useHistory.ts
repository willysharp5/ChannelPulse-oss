import { useState, useEffect, useCallback } from "react";
import {
  getConversationSummaries,
  getConversationById,
  searchConversationTranscripts,
  deleteConversation,
  DOWNLOAD_SUCCESS_DISPLAY_MS,
  type ConversationSummary,
} from "@/lib";
import { scheduleSync, subscribeSync } from "@/lib/sync";
import { ChatConversation } from "@/types/completion";

export type UseHistoryType = ReturnType<typeof useHistory>;

export interface UseHistoryReturn {
  // State
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  viewingConversation: ChatConversation | null;
  downloadedConversations: Set<string>;
  deleteConfirm: string | null;
  isDownloaded: boolean;
  isAttached: boolean;
  /** conversationId → transcript snippet for the current search (DB-backed). */
  searchSnippets: Map<string, string>;

  // Actions
  handleViewConversation: (conversation: ChatConversation) => void;
  handleDownloadConversation: (
    conversation: ChatConversation,
    e: React.MouseEvent
  ) => Promise<void>;
  handleDeleteConfirm: (conversationId: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  handleAttachToOverlay: (conversationId: string) => void;
  handleDownload: (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => Promise<void>;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  // Utilities
  refreshConversations: () => void;
  isLoading: boolean;
}

export function useHistory(): UseHistoryReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState("");
  const [searchSnippets, setSearchSnippets] = useState<Map<string, string>>(
    new Map()
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [viewingConversation, setViewingConversation] =
    useState<ChatConversation | null>(null);

  const [downloadedConversations, setDownloadedConversations] = useState<
    Set<string>
  >(new Set());

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isAttached, setIsAttached] = useState(false);

  // Function to refresh conversations
  const refreshConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const loadedConversations = await getConversationSummaries();
      setConversations(loadedConversations);
    } catch (error) {
      console.error("Failed to load conversations:", error);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load conversations when component mounts or popover opens
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Re-query after a sync completes. On the web app (and on a fresh install)
  // the local DB starts empty and conversations only arrive via the background
  // sync a few seconds after launch — without this, the UI keeps showing the
  // empty snapshot taken at mount. Also picks up changes from other devices.
  useEffect(() => {
    let lastSeen = 0;
    return subscribeSync((s) => {
      if (s.status === "success" && s.lastSyncedAt && s.lastSyncedAt !== lastSeen) {
        lastSeen = s.lastSyncedAt;
        void refreshConversations();
      }
    });
  }, [refreshConversations]);

  // DB-backed transcript search. Debounced so we don't hammer SQLite on every
  // keystroke, and guarded against races so a slower earlier query can't
  // clobber the results of a newer one. Empty query clears the map.
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setSearchSnippets(new Map());
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchConversationTranscripts(trimmed)
        .then((snippets) => {
          if (!cancelled) setSearchSnippets(snippets);
        })
        .catch((error) => {
          console.error("Failed to search transcripts:", error);
          if (!cancelled) setSearchSnippets(new Map());
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search]);

  const handleViewConversation = (conversation: ChatConversation) => {
    setViewingConversation(conversation);
  };

  const handleDownloadConversation = async (
    conversation: ChatConversation,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    // Show download success state
    setDownloadedConversations((prev) => new Set(prev).add(conversation.id));

    try {
      // The list now carries lightweight summaries (no messages), so pull the
      // full transcript before building the markdown. Fall back to whatever
      // was passed in if the fetch comes back empty.
      const full =
        (await getConversationById(conversation.id)) ?? conversation;

      // Convert conversation to markdown format
      const markdown = generateConversationMarkdown(full);

      // Create and download the file
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = generateFilename(conversation.title);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download conversation:", error);
      // Remove from success state if download failed
      setDownloadedConversations((prev) => {
        const newSet = new Set(prev);
        newSet.delete(conversation.id);
        return newSet;
      });
      return;
    }

    // Clear success state after display timeout
    setTimeout(() => {
      setDownloadedConversations((prev) => {
        const newSet = new Set(prev);
        newSet.delete(conversation.id);
        return newSet;
      });
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  };

  const handleDeleteConfirm = (conversationId: string) => {
    setDeleteConfirm(conversationId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      setSelectedConversationId(null);
      setViewingConversation(null);
      await deleteConversation(deleteConfirm);
      setConversations((prev) => prev.filter((c) => c.id !== deleteConfirm));

      // Emit event to notify other components about deletion
      window.dispatchEvent(
        new CustomEvent("conversationDeleted", {
          detail: deleteConfirm,
        })
      );
      // Push the tombstone to the server soon so it doesn't come back on restore.
      scheduleSync(1000);
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const handleAttachToOverlay = (conversationId: string) => {
    // Use localStorage to communicate between windows
    localStorage.setItem(
      "channelpulse-conversation-selected",
      JSON.stringify({ id: conversationId, timestamp: Date.now() })
    );
    setIsAttached(true);
    setTimeout(() => {
      setIsAttached(false);
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  };

  const handleDownload = async (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => {
    if (conversation) {
      await handleDownloadConversation(conversation, e);
      setIsDownloaded(true);
      setTimeout(() => {
        setIsDownloaded(false);
      }, DOWNLOAD_SUCCESS_DISPLAY_MS);
    }
  };

  // Helper functions
  const generateConversationMarkdown = (
    conversation: ChatConversation
  ): string => {
    let markdown = `# ${conversation.title}\n\n`;
    markdown += `**Created:** ${new Date(
      conversation.createdAt
    ).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(
      conversation.updatedAt
    ).toLocaleString()}\n`;
    markdown += `**Messages:** ${conversation.messages.length}\n\n---\n\n`;

    conversation.messages.forEach((message, index) => {
      const roleLabel = message.role.toUpperCase();
      markdown += `## ${roleLabel}: ${message.content}\n`;

      if (index < conversation.messages.length - 1) {
        markdown += "\n";
      }
    });

    return markdown;
  };

  const generateFilename = (title: string): string => {
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    return `${sanitizedTitle.substring(0, 16)}.md`;
  };

  return {
    // State
    conversations,
    selectedConversationId,
    viewingConversation,
    downloadedConversations,
    deleteConfirm,
    isDownloaded,
    isAttached,
    searchSnippets,

    // Actions
    handleViewConversation,
    handleDownloadConversation,
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    handleAttachToOverlay,
    handleDownload,
    // Utilities
    refreshConversations,
    search,
    setSearch,
    isLoading,
  };
}
