import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Textarea,
} from "@/components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SAMPLE_SYSTEM_PROMPTS, type SamplePrompt } from "@/config";
import { useProUpsell } from "@/components/pro-upsell";
import type { SystemPrompt, SystemPromptInput } from "@/types";

// Distinct template categories for the filter dropdown.
const TEMPLATE_CATEGORIES = Array.from(
  new Set(SAMPLE_SYSTEM_PROMPTS.map((s) => s.category))
).sort((a, b) => a.localeCompare(b));
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  LockIcon,
  Loader2,
  PlusIcon,
  PencilIcon,
  Search,
  X,
} from "lucide-react";

const PERSONA_PAGE_SIZE = 8;

/**
 * The persona the free edition ships with.
 *
 * Interview coaching is what this app is for, so the interview coach is the one
 * that works — and "Create your own" is right there for anything else, with no
 * limit on it. The rest of the library stays visible but locked: the point of
 * showing them is that someone can see the shape of the full set before deciding
 * whether the hosted app is worth it, and a card you can read is a better pitch
 * than a feature bullet.
 *
 * NOT A SECURITY BOUNDARY. This is UI: the prompt text of every template is in
 * `src/config/sample-prompts.ts`, which is public source. Locking the card is an
 * honest signal about what the free edition supports, not an attempt to keep the
 * words secret.
 */
const FREE_PERSONA_IDS = new Set(["job-interview"]);

interface SamplePromptsProps {
  prompts: SystemPrompt[];
  selectedPromptId: number | null;
  createPrompt: (input: SystemPromptInput) => Promise<SystemPrompt>;
  handleSelectPrompt: (promptId: number) => void;
  /** Turn the active persona off — one is active at a time. */
  clearSelectedPrompt: () => void;
  onCreateClick: () => void;
}

export const SamplePrompts = ({
  prompts,
  selectedPromptId,
  createPrompt,
  handleSelectPrompt,
  clearSelectedPrompt,
  onCreateClick,
}: SamplePromptsProps) => {
  const { promptUpgrade } = useProUpsell();
  const [usingId, setUsingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  // The sample being previewed. By default the dialog is a read-only preview;
  // the user opts into editing a COPY (drafts) — the template never changes.
  const [preview, setPreview] = useState<SamplePrompt | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SAMPLE_SYSTEM_PROMPTS.filter((s) => {
      const matchesCategory = category === "all" || s.category === category;
      const matchesSearch =
        !q ||
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [search, category]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PERSONA_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PERSONA_PAGE_SIZE;
    return filtered.slice(start, start + PERSONA_PAGE_SIZE);
  }, [safePage, filtered]);

  // Reset to the first page when the search/filter changes or pages shrink.
  useEffect(() => setPage(1), [search, category]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  /** Locked cards pitch the hosted app instead of opening the preview. */
  const openTemplate = (sample: SamplePrompt) => {
    if (!FREE_PERSONA_IDS.has(sample.id)) {
      promptUpgrade(`The “${sample.title}” persona`);
      return;
    }
    openPreview(sample);
  };

  const openPreview = (sample: SamplePrompt) => {
    setPreview(sample);
    setEditMode(false);
    setDraftName(sample.title);
    setDraftPrompt(sample.prompt);
  };

  const closePreview = () => {
    setPreview(null);
    setEditMode(false);
  };

  /**
   * Confirm using the previewed prompt. Reuses an existing saved prompt when it
   * matches the (possibly edited) name + content; otherwise creates a new one.
   */
  const handleConfirmUse = async () => {
    if (!preview) return;
    // As-is uses the template verbatim; in edit mode we use the edited copy.
    const name = editMode ? draftName.trim() || preview.title : preview.title;
    const prompt = editMode ? draftPrompt.trim() : preview.prompt;
    if (!prompt) return;
    try {
      setUsingId(preview.id);
      const existing = prompts.find((p) => p.name === name);
      if (existing && existing.prompt === prompt) {
        handleSelectPrompt(existing.id);
      } else {
        const created = await createPrompt({ name, prompt });
        handleSelectPrompt(created.id);
      }
      closePreview();
    } catch (err) {
      console.error("Failed to use sample prompt:", err);
    } finally {
      setUsingId(null);
    }
  };

  const isSampleSelected = (sample: SamplePrompt) => {
    const existing = prompts.find((p) => p.name === sample.title);
    return !!existing && existing.id === selectedPromptId;
  };

  const renderPagination = (placement: "top" | "bottom") => {
    if (totalPages <= 1) {
      if (placement === "top") {
        return (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {filtered.length} template
              {filtered.length === 1 ? "" : "s"}
            </span>
          </div>
        );
      }
      return null;
    }

    if (placement === "top") {
      return (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {(safePage - 1) * PERSONA_PAGE_SIZE + 1}–
            {Math.min(safePage * PERSONA_PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="tabular-nums text-xs">
              Page {safePage} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={safePage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              size="sm"
              variant={n === safePage ? "default" : "ghost"}
              className="h-8 w-8 p-0 tabular-nums"
              onClick={() => setPage(n)}
            >
              {n}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={safePage >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="border-t border-input/50 pt-6">
        <Header
          title="Persona templates"
          description="Ready-made personas for common roles and scenarios, layered on top of the core system prompt. The free edition ships with the interview coach — plus as many of your own as you like. The rest of the library comes with the hosted app. With no persona, the assistant just uses the system prompt."
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-1/2 lg:w-1/3 select-none">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search templates..."
            className="pl-9 pr-9 focus-visible:ring-0 focus-visible:ring-offset-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {TEMPLATE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {renderPagination("top")}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 pb-4">
        {pageItems.map((sample) => {
          const Icon = sample.icon;
          const locked = !FREE_PERSONA_IDS.has(sample.id);
          const isSelected = isSampleSelected(sample);
          const isUsing = usingId === sample.id;
          return (
            <Card
              key={sample.id}
              role="button"
              tabIndex={0}
              onClick={() => openTemplate(sample)}
              title={
                locked
                  ? "In the hosted app"
                  : isSelected
                  ? "In use — open it to stop using it"
                  : "Preview & use"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTemplate(sample);
                }
              }}
              className={`relative border shadow-none p-4 pb-10 gap-0 group cursor-pointer transition-colors ${
                isSelected
                  ? "!bg-primary/5 dark:!bg-primary/10 border-primary"
                  : "!bg-muted/40 border-border/60 hover:border-primary/40"
              }`}
            >
              {isSelected && (
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0 absolute top-2 right-2" />
              )}
              {locked && (
                <LockIcon className="absolute right-3 top-3 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <CardHeader className="p-0 pb-0 select-none">
                <div className="flex items-start gap-3">
                  <div
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                      locked
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <Icon className="size-4.5" />
                  </div>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base line-clamp-1 flex-1 pr-3">
                        {sample.title}
                      </CardTitle>
                    </div>
                    <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
                      {sample.category}
                    </span>
                    <CardDescription className="h-10 line-clamp-2 text-xs leading-relaxed">
                      {sample.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <div className="absolute bottom-2 left-4 right-4 flex items-center">
                {locked ? (
                  <span className="flex items-center gap-1 text-3xs lg:text-xs font-medium text-muted-foreground select-none">
                    <LockIcon className="size-3.5" /> In the hosted app
                  </span>
                ) : isSelected ? (
                  <span className="flex items-center gap-1 text-3xs lg:text-xs font-medium text-green-600 select-none">
                    <CheckCircle2 className="size-3.5" /> In use
                  </span>
                ) : isUsing ? (
                  <span className="flex items-center gap-1 text-3xs lg:text-xs text-muted-foreground select-none">
                    <Loader2 className="size-3 animate-spin" /> Adding…
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-3xs lg:text-xs font-medium text-primary select-none">
                    <Eye className="size-3.5" /> Preview &amp; use
                  </span>
                )}
              </div>
            </Card>
          );
        })}

        {/* Always on every page */}
        <Card
          role="button"
          tabIndex={0}
          onClick={onCreateClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCreateClick();
            }
          }}
          className="relative border-2 border-dashed border-input shadow-none p-4 gap-0 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:border-primary hover:bg-primary/5 min-h-[8.75rem]"
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
            <PlusIcon className="size-4.5" />
          </div>
          <p className="text-sm font-medium">Create your own</p>
          <p className="text-xs text-muted-foreground mt-1 select-none">
            Start from a blank prompt or generate one with AI
          </p>
        </Card>
      </div>

      {renderPagination("bottom")}

      {/* Preview dialog — read-only by default; editing works on a COPY so the
          template itself is never changed. */}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent className="sm:max-w-[37.5rem] max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="mt-4 px-6 shrink-0">
            <DialogTitle>{editMode ? "Edit" : preview?.title}</DialogTitle>
            <DialogDescription className="mt-1">
              {editMode ? "Changes only affect your copy." : preview?.category ?? ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1">
            {editMode ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">
                    Name
                  </label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">
                    System Prompt
                  </label>
                  <Textarea
                    value={draftPrompt}
                    onChange={(e) => setDraftPrompt(e.target.value)}
                    className="min-h-[15rem] max-h-[25rem] resize-none overflow-y-auto"
                  />
                </div>
              </>
            ) : (
              <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
                {preview?.prompt}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 shrink-0 sm:justify-between">
            <Button variant="outline" onClick={closePreview}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {!editMode && preview && isSampleSelected(preview) && (
                // The one persona in use, turned off from where it was turned on.
                <Button
                  variant="outline"
                  onClick={() => {
                    clearSelectedPrompt();
                    closePreview();
                  }}
                >
                  Stop using
                </Button>
              )}
              {!editMode && (
                <Button variant="outline" onClick={() => setEditMode(true)}>
                  <PencilIcon className="size-4" />
                  Edit
                </Button>
              )}
              <Button
                onClick={handleConfirmUse}
                disabled={
                  (editMode && (!draftName.trim() || !draftPrompt.trim())) ||
                  usingId === preview?.id
                }
              >
                {usingId === preview?.id ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Using…
                  </>
                ) : editMode ? (
                  "Use this copy"
                ) : (
                  "Use this prompt"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
