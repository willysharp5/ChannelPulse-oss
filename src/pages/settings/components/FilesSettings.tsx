import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Switch,
  ConfirmDialog,
  AlertBanner,
  toast,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RichTextEditor,
  Markdown,
  type AlertBannerVariant,
} from "@/components";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ingestFile,
  ingestFiles,
  ingestTextDocument,
  removeFileDocument,
  isFileEnabled,
  setFileEnabled,
  getActiveFileResearchCount,
  subscribeFileResearch,
  FILE_RESEARCH_DONE_EVENT,
  getFileDocumentBody,
  ensureFormattedDocumentBody,
} from "@/lib/memory";
import {
  listMemorySources,
  getMemoriesBySource,
  type MemorySourceSummary,
} from "@/lib/database/memory.action";
import {
  FileTextIcon,
  Trash2Icon,
  PlusIcon,
  LoaderIcon,
  SearchIcon,
  XIcon,
  SparklesIcon,
  EyeIcon,
  UploadIcon,
  PencilIcon,
  SaveIcon,
  RefreshCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FileResearchWizard } from "./FileResearchWizard";

const TEXT_FILE_FILTERS = [
  {
    name: "Text & documents",
    extensions: [
      "pdf", "txt", "md", "markdown", "mdx", "json", "csv", "tsv", "yaml", "yml",
      "html", "xml", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java",
      "c", "cpp", "cs", "php", "sh", "sql", "toml", "ini", "log",
    ],
  },
];

type OriginFilter = "all" | "uploads" | "research";

type FileOrigin = "upload" | "research";

function getFileOrigin(source: string): FileOrigin {
  return source.startsWith("research:") ? "research" : "upload";
}

function humanizeError(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("insufficient_quota") || s.includes("exceeded your current quota")) {
    return "The AI account is out of credit. Add billing/credits to resume.";
  }
  if (/\b429\b/.test(s) || s.includes("rate limit")) {
    return "Rate limited by the AI provider. Wait a moment and try again.";
  }
  if (/\b401\b/.test(s) || s.includes("session expired") || s.includes("not signed in")) {
    return "Your session expired. Sign in again and retry.";
  }
  if (s.includes("unsupported file type")) {
    return "Unsupported file type. Use PDF, text, markdown, or code files.";
  }
  if (s.includes("too large")) return "File is too large.";
  if (s.includes("empty or unreadable")) return "The file was empty or couldn't be read.";
  const trimmed = raw.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/**
 * Files: upload documents or research people/companies for interviews and
 * conversations. Memory internals stay in the background.
 */
export const FilesSettings = () => {
  const [sources, setSources] = useState<MemorySourceSummary[]>([]);
  const [query, setQuery] = useState("");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [isIngesting, setIsIngesting] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [researchActive, setResearchActive] = useState(
    () => getActiveFileResearchCount()
  );
  const [status, setStatus] = useState<{
    variant: AlertBannerVariant;
    title: string;
    message?: string;
  } | null>(null);
  const [confirmSource, setConfirmSource] = useState<{
    source: string;
    label: string;
  } | null>(null);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<{
    source: string;
    label: string;
    origin: FileOrigin;
  } | null>(null);
  const [viewContent, setViewContent] = useState("");
  const [viewLoading, setViewLoading] = useState(false);
  const [viewEditing, setViewEditing] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [viewDirty, setViewDirty] = useState(false);
  const [highlightSource, setHighlightSource] = useState<string | null>(null);
  const [reimporting, setReimporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const srcs = await listMemorySources(null, true);
      const files = srcs.filter((s) => s.kind === "file");
      setSources(files);
      setEnabledMap(
        Object.fromEntries(files.map((f) => [f.source, isFileEnabled(f.source)]))
      );
    } catch (err) {
      console.error("Failed to load files:", err);
    }
  }, []);

  const closeView = () => {
    setViewing(null);
    setViewContent("");
    setViewEditing(false);
    setViewDirty(false);
    setViewSaving(false);
  };

  const openView = useCallback(
    async (source: string, label: string, origin: FileOrigin) => {
      setViewing({ source, label, origin });
      setViewLoading(true);
      setViewContent("");
      setViewEditing(false);
      setViewDirty(false);
      try {
        // Re-reads the original file when the stored body predates a formatter
        // improvement; otherwise this is just the stored body.
        const stored = await ensureFormattedDocumentBody(source);
        if (stored) {
          setViewContent(stored);
        } else {
          const rows = await getMemoriesBySource(source);
          setViewContent(
            rows
              .map((r) => r.content)
              .join("\n\n")
              .trim()
          );
        }
      } catch (err) {
        setViewContent(
          err instanceof Error ? err.message : "Couldn't load content."
        );
      } finally {
        setViewLoading(false);
      }
    },
    []
  );

  const handleSaveView = async () => {
    if (!viewing) return;
    const text = viewContent.trim();
    if (!text) {
      toast("Nothing to save", {
        description: "Add some content before saving.",
        variant: "error",
      });
      return;
    }
    setViewSaving(true);
    try {
      const result = await ingestTextDocument({
        source: viewing.source,
        label: viewing.label,
        text,
      });
      if (result.error) throw new Error(result.error);
      setViewEditing(false);
      setViewDirty(false);
      await refresh();
      toast("Saved", {
        description: "Updates are ready for chats and interviews.",
        variant: "success",
      });
    } catch (err) {
      toast("Couldn't save", {
        description:
          err instanceof Error ? err.message.slice(0, 160) : String(err),
        variant: "error",
      });
    } finally {
      setViewSaving(false);
    }
  };

  const toggleEnabled = (source: string, enabled: boolean, label: string) => {
    setFileEnabled(source, enabled);
    setEnabledMap((prev) => ({ ...prev, [source]: enabled }));
    toast(enabled ? "Using file globally" : "File turned off", {
      description: label,
      variant: enabled ? "success" : "info",
    });
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = subscribeFileResearch(() => {
      setResearchActive(getActiveFileResearchCount());
    });
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { source?: string; label?: string }
        | undefined;
      void refresh().then(() => {
        if (detail?.source) {
          setHighlightSource(detail.source);
          setOriginFilter("research");
          void openView(
            detail.source,
            detail.label ?? "Research",
            "research"
          );
        }
      });
    };
    window.addEventListener(FILE_RESEARCH_DONE_EVENT, onDone);
    return () => {
      unsub();
      window.removeEventListener(FILE_RESEARCH_DONE_EVENT, onDone);
    };
  }, [refresh, openView]);

  const counts = useMemo(() => {
    let uploads = 0;
    let research = 0;
    for (const s of sources) {
      if (getFileOrigin(s.source) === "research") research += 1;
      else uploads += 1;
    }
    return { all: sources.length, uploads, research };
  }, [sources]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter((s) => {
      const origin = getFileOrigin(s.source);
      if (originFilter === "uploads" && origin !== "upload") return false;
      if (originFilter === "research" && origin !== "research") return false;
      if (!q) return true;
      return (s.source_label ?? s.source).toLowerCase().includes(q);
    });
  }, [sources, query, originFilter]);

  const handleAddFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: TEXT_FILE_FILTERS,
        title: "Add files",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      setIsIngesting(true);
      setStatus({
        variant: "loading",
        title: `Adding ${paths.length} file${paths.length === 1 ? "" : "s"}…`,
        message: "This only takes a moment.",
      });
      const results = await ingestFiles(paths, null);
      const ok = results.filter((r) => !r.error);
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        setStatus({
          variant: "error",
          title:
            ok.length > 0
              ? `Added ${ok.length} file${ok.length === 1 ? "" : "s"}, but ${
                  failed.length
                } failed`
              : `Couldn't add ${failed.length} file${
                  failed.length === 1 ? "" : "s"
                }`,
          message: failed
            .map((f) => `${f.label}: ${humanizeError(f.error ?? "")}`)
            .join("  •  "),
        });
      } else {
        setStatus({
          variant: "success",
          title: `Added ${ok.length} file${ok.length === 1 ? "" : "s"}`,
          message: "Ready to use in chats and interviews.",
        });
        setOriginFilter("uploads");
      }
      await refresh();
    } catch (err) {
      setStatus({
        variant: "error",
        title: "Couldn't add files",
        message: humanizeError(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setIsIngesting(false);
    }
  };

  /**
   * Re-read an uploaded file from disk and re-format it. Needed because the
   * formatter improves over time: a file added before an improvement keeps its
   * old, flattened body, and the line breaks it lost can only be recovered from
   * the original file. For uploads the source key *is* the path, so this is a
   * plain re-ingest. Research briefings have no file on disk, so they don't
   * offer this.
   */
  const handleReimport = async (source: string, label: string) => {
    setReimporting(source);
    try {
      const result = await ingestFile(source);
      if (result.error) throw new Error(result.error);
      await refresh();
      // If the viewer is open on this file, show the freshly formatted body.
      if (viewing?.source === source && !viewEditing) {
        setViewContent(getFileDocumentBody(source) ?? "");
      }
      toast("Reformatted", {
        description: `${label} was re-read and tidied up.`,
        variant: "success",
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      toast("Couldn't re-import", {
        description: /no such file|not found|os error 2/i.test(raw)
          ? "The original file isn't at that location any more. Upload it again."
          : humanizeError(raw),
        variant: "error",
      });
    } finally {
      setReimporting(null);
    }
  };

  const handleRemove = async (source: string, label: string) => {
    await removeFileDocument(source);
    await refresh();
    toast("File removed", { description: label, variant: "info" });
  };

  const filterEmptyMessage = () => {
    if (query.trim()) return "No matches for this search.";
    if (originFilter === "uploads") return "No uploaded files yet.";
    if (originFilter === "research") return "No research briefings yet.";
    return "Nothing here yet. Upload a document or start the research walkthrough.";
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
        <p className="font-medium">Ground chats & interviews with real context</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Upload resumes, job descriptions, notes about people you're talking
          to, or company material. Or walk through a short research flow:
          answer a few questions, paste LinkedIn text (we can't crawl LinkedIn),
          and add up to 4 public links to fetch in the background.
        </p>
      </div>

      {researchActive > 0 && (
        <AlertBanner
          variant="loading"
          title={
            researchActive === 1
              ? "Research running in the background…"
              : `${researchActive} research jobs running…`
          }
          description="You can leave this page. We'll notify you when each one is ready; then you can open it to review what was gathered."
        />
      )}

      {status && (
        <AlertBanner
          variant={status.variant}
          title={status.title}
          description={status.message}
          onClose={
            status.variant === "loading" ? undefined : () => setStatus(null)
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              originFilter === "research"
                ? "Search research…"
                : originFilter === "uploads"
                  ? "Search uploads…"
                  : "Search files & research…"
            }
            className="h-9 pl-8 pr-8 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setWizardOpen(true)}
          className="shrink-0 gap-1.5"
        >
          <SparklesIcon className="size-3.5" />
          Research walkthrough
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddFiles}
          disabled={isIngesting}
          className="shrink-0 gap-1.5"
        >
          {isIngesting ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <PlusIcon className="size-3.5" />
          )}
          Upload files
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: "all", label: "All", count: counts.all },
            { id: "uploads", label: "Uploads", count: counts.uploads },
            { id: "research", label: "Research", count: counts.research },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOriginFilter(f.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
              originFilter === f.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-muted/40"
            )}
          >
            {f.id === "uploads" ? (
              <UploadIcon className="size-3" />
            ) : f.id === "research" ? (
              <SparklesIcon className="size-3" />
            ) : (
              <FileTextIcon className="size-3" />
            )}
            {f.label}
            <span className="tabular-nums text-3xs opacity-70">{f.count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 px-3 py-10 text-center">
          <FileTextIcon className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{filterEmptyMessage()}</p>
          {!query && originFilter !== "uploads" && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {originFilter !== "research" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setWizardOpen(true)}
                  className="gap-1.5"
                >
                  <SparklesIcon className="size-3.5" />
                  Research walkthrough
                </Button>
              )}
              {originFilter === "all" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddFiles}
                  disabled={isIngesting}
                  className="gap-1.5"
                >
                  <PlusIcon className="size-3.5" />
                  Upload files
                </Button>
              )}
              {originFilter === "research" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setWizardOpen(true)}
                  className="gap-1.5"
                >
                  <SparklesIcon className="size-3.5" />
                  Start research
                </Button>
              )}
            </div>
          )}
          {!query && originFilter === "uploads" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddFiles}
              disabled={isIngesting}
              className="gap-1.5"
            >
              <PlusIcon className="size-3.5" />
              Upload files
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {visible.map((f) => {
            const label = f.source_label ?? f.source;
            const origin = getFileOrigin(f.source);
            const isNew = highlightSource === f.source;
            return (
              <div
                key={f.source}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3",
                  isNew
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-border/60"
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {origin === "research" ? (
                    <SparklesIcon className="size-4 shrink-0 text-primary" />
                  ) : (
                    <FileTextIcon className="size-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium" title={label}>
                        {label}
                      </p>
                      <Badge
                        variant="secondary"
                        className="h-5 shrink-0 px-1.5 text-3xs font-normal"
                      >
                        {origin === "research" ? "Research" : "Upload"}
                      </Badge>
                      {isNew ? (
                        <Badge className="h-5 shrink-0 px-1.5 text-3xs">
                          New
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-3xs text-muted-foreground">
                      {new Date(f.created_at).toLocaleDateString()} ·{" "}
                      {enabledMap[f.source] !== false
                        ? "used globally"
                        : "not in use"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openView(f.source, label, origin)}
                    title="View contents"
                    aria-label="View contents"
                  >
                    <EyeIcon className="size-3.5" />
                  </Button>
                  {origin === "upload" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => void handleReimport(f.source, label)}
                      disabled={reimporting === f.source}
                      title="Re-import from the original file; re-reads it and cleans up the formatting"
                      aria-label="Re-import and reformat"
                    >
                      <RefreshCwIcon
                        className={cn(
                          "size-3.5",
                          reimporting === f.source && "animate-spin"
                        )}
                      />
                    </Button>
                  )}
                  <Switch
                    checked={enabledMap[f.source] !== false}
                    onCheckedChange={(v) => toggleEnabled(f.source, v, label)}
                    title="Use this file globally (conversations & references)"
                    aria-label="Use this file globally"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setConfirmSource({ source: f.source, label })}
                    title="Remove"
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FileResearchWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onQueued={() => {
          setResearchActive(getActiveFileResearchCount());
          toast("Research started", {
            description:
              "Running in the background. When it's done we'll open the briefing so you can review it.",
            variant: "info",
          });
        }}
      />

      <Dialog
        open={!!viewing}
        onOpenChange={(open) => {
          if (!open) closeView();
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="mt-4 px-6 shrink-0">
            <DialogTitle className="pr-8">{viewing?.label ?? "Contents"}</DialogTitle>
            <DialogDescription>
              {viewEditing
                ? "Edit with rich text: headings, lists, and emphasis. Saving updates what the assistant uses."
                : viewing?.origin === "research"
                  ? "Research briefing in readable format. Edit anytime to add or correct details."
                  : "Uploaded content in readable format. Edit to refine what’s used in chats and interviews."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {viewLoading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
                <LoaderIcon className="size-4 animate-spin" />
                Loading…
              </div>
            ) : viewEditing ? (
              <RichTextEditor
                value={viewContent}
                onChange={(md) => {
                  setViewContent(md);
                  setViewDirty(true);
                }}
                minHeight={320}
                placeholder="Write or paste content…"
                disabled={viewSaving}
                className="mb-1"
              />
            ) : (
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                {viewContent.trim() ? (
                  <Markdown>{viewContent}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">No content found.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 shrink-0 sm:justify-between">
            <Button variant="outline" onClick={closeView} disabled={viewSaving}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              {viewEditing ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setViewEditing(false);
                      if (viewing)
                        void openView(
                          viewing.source,
                          viewing.label,
                          viewing.origin
                        );
                    }}
                    disabled={viewSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleSaveView()}
                    disabled={viewSaving || !viewDirty || !viewContent.trim()}
                    className="gap-1.5"
                  >
                    {viewSaving ? (
                      <LoaderIcon className="size-3.5 animate-spin" />
                    ) : (
                      <SaveIcon className="size-3.5" />
                    )}
                    {viewSaving ? "Saving…" : "Save changes"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewEditing(true);
                    setViewDirty(false);
                  }}
                  disabled={viewLoading}
                  className="gap-1.5"
                >
                  <PencilIcon className="size-3.5" />
                  Edit
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmSource}
        onOpenChange={(o) => {
          if (!o) setConfirmSource(null);
        }}
        title="Remove file"
        description={
          confirmSource
            ? `Remove "${confirmSource.label}"? This can't be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (confirmSource)
            await handleRemove(confirmSource.source, confirmSource.label);
        }}
      />
    </div>
  );
};
