import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  Highlight,
  Input,
  Textarea,
  ConfirmDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@/components";
import {
  deleteInterviewTemplate,
  getInterviewCategoryLabel,
  getInterviewVoiceLabel,
  INTERVIEW_CATEGORIES,
  INTERVIEW_PAGE_SIZE,
  INTERVIEW_VOICES,
  listInterviewTemplates,
  updateInterviewTemplateSettings,
  getEffectiveQuestionCount,
  subscribeCuration,
  getActiveCurationCount,
  CURATION_DONE_EVENT,
  type InterviewCategoryId,
  type InterviewDifficulty,
  type InterviewTemplate,
  type InterviewVoiceId,
} from "@/lib/interview";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  LockIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Play,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_CUSTOM_INTERVIEWS } from "@/config";
import { useProUpsell } from "@/components/pro-upsell";
import { TemplateEditor } from "./TemplateEditor";
import { CreateInterviewFlow } from "./CreateInterviewFlow";
import { QuestionsAssistant } from "./QuestionsAssistant";

interface SetupScreenProps {
  onStart: (template: InterviewTemplate) => void;
}

/**
 * The one ready-made interview this edition runs.
 *
 * Same shape as `FREE_PERSONA_IDS` in `pages/system-prompts/SamplePrompts.tsx`:
 * one works, the rest stay readable but locked, because a card you can see is a
 * better argument for the hosted app than a feature bullet. General Behavioral
 * is the one that's free because it's the one that fits every role — and you can
 * do anything with it (customize it, refine its questions, sit it as often as
 * you like), on top of the one interview of your own below.
 *
 * NOT A SECURITY BOUNDARY, same as `FREE_PERSONA_IDS`: every template is in
 * `lib/interview/templates.ts`, which is public source. Locking the card is an
 * honest signal about what this edition carries, not an attempt to hide words.
 */
const FREE_INTERVIEW_IDS = new Set(["builtin-general-behavioral"]);

type CategoryFilter = "all" | InterviewCategoryId;

/** Creation time parsed from a custom template id ("custom-<ts36>-…"). */
function customCreatedAt(t: InterviewTemplate): number {
  const m = t.id.match(/^custom-([a-z0-9]+)-/i);
  if (m) {
    const n = parseInt(m[1], 36);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function SetupScreen({ onStart }: SetupScreenProps) {
  const { promptUpgrade } = useProUpsell();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<InterviewTemplate | null>(null);
  const [assisting, setAssisting] = useState<InterviewTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [page, setPage] = useState(1);
  const [customPage, setCustomPage] = useState(1);
  const [setupTab, setSetupTab] = useState<"personalized" | "templates">(
    "personalized"
  );
  // Pending delete uses the shared destructive ConfirmDialog (not window.confirm).
  const [pendingDelete, setPendingDelete] =
    useState<InterviewTemplate | null>(null);
  // Background curation research jobs currently running.
  const [activeJobs, setActiveJobs] = useState(getActiveCurationCount());
  // Newly-finished interview to surface first + highlight as "New".
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);

  const templates = useMemo(() => listInterviewTemplates(), [version]);

  // Refresh the list when a background curation finishes, highlight the new
  // interview, and track running jobs.
  useEffect(() => {
    const onDone = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined;
      setVersion((v) => v + 1);
      // Keep the "New" highlight until the user opens/starts it.
      if (id) {
        setNewTemplateId(id);
        setSetupTab("personalized");
      }
    };
    window.addEventListener(CURATION_DONE_EVENT, onDone as EventListener);
    const unsub = subscribeCuration(() =>
      setActiveJobs(getActiveCurationCount())
    );
    return () => {
      window.removeEventListener(CURATION_DONE_EVENT, onDone as EventListener);
      unsub();
    };
  }, []);

  const matchesSearch = (t: InterviewTemplate, q: string) => {
    if (!q) return true;
    const haystack = [
      t.title,
      t.roleLevel,
      t.notes,
      getInterviewCategoryLabel(t.category),
      getInterviewVoiceLabel(t.voice),
      ...(t.customQuestions ?? []),
      ...t.focusAreas,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  };

  const customTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates
      .filter((t) => !t.builtIn && matchesSearch(t, q))
      .sort((a, b) => {
        // Newly-finished interview pinned first, then most-recently created.
        if (a.id === newTemplateId) return -1;
        if (b.id === newTemplateId) return 1;
        return customCreatedAt(b) - customCreatedAt(a);
      });
  }, [templates, search, newTemplateId]);

  const builtinFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (!t.builtIn) return false;
      if (category !== "all" && t.category !== category) return false;
      return matchesSearch(t, q);
    });
  }, [templates, search, category]);

  const totalPages = Math.max(
    1,
    Math.ceil(builtinFiltered.length / INTERVIEW_PAGE_SIZE)
  );
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * INTERVIEW_PAGE_SIZE;
    return builtinFiltered.slice(start, start + INTERVIEW_PAGE_SIZE);
  }, [builtinFiltered, safePage]);

  const customTotalPages = Math.max(
    1,
    Math.ceil(customTemplates.length / INTERVIEW_PAGE_SIZE)
  );
  const safeCustomPage = Math.min(customPage, customTotalPages);

  const customPageItems = useMemo(() => {
    const start = (safeCustomPage - 1) * INTERVIEW_PAGE_SIZE;
    return customTemplates.slice(start, start + INTERVIEW_PAGE_SIZE);
  }, [customTemplates, safeCustomPage]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
    setCustomPage(1);
  }, [search, category]);

  // Clamp page if the filtered set shrinks.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (customPage > customTotalPages) setCustomPage(customTotalPages);
  }, [customPage, customTotalPages]);

  const refresh = () => setVersion((v) => v + 1);

  const handleVoiceChange = (templateId: string, voice: InterviewVoiceId) => {
    updateInterviewTemplateSettings(templateId, { voice });
    refresh();
  };

  const handleSettingsChange = (
    templateId: string,
    patch: {
      difficulty?: InterviewDifficulty;
      focusAreas?: string[];
      notes?: string;
      productContext?: string;
      customQuestions?: string[];
      customQuestionCategories?: string[];
    }
  ) => {
    updateInterviewTemplateSettings(templateId, patch);
    refresh();
  };

  const categoryCounts = useMemo(() => {
    const builtins = templates.filter((t) => t.builtIn);
    const counts: Record<string, number> = { all: builtins.length };
    for (const c of INTERVIEW_CATEGORIES) counts[c.id] = 0;
    for (const t of builtins) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return counts;
  }, [templates]);

  const allCustomCount = useMemo(
    () => templates.filter((t) => !t.builtIn).length,
    [templates]
  );

  /** A ready-made interview this edition doesn't run — see FREE_INTERVIEW_IDS. */
  const isLocked = (t: InterviewTemplate) =>
    t.builtIn && !FREE_INTERVIEW_IDS.has(t.id);

  /**
   * Reaching for a second ready-made interview. Nothing is disabled and nothing
   * fails silently: the card is the pitch, so say which interview they wanted
   * and let the dialog make the case for the hosted app.
   */
  const pitchLocked = (t: InterviewTemplate) =>
    promptUpgrade(`The “${t.title}” interview`);

  /**
   * Building an interview of your own, one at a time. This edition keeps
   * MAX_CUSTOM_INTERVIEWS of them; delete the one you have and the next is free.
   * The built-in templates aren't counted — you don't keep those, you run them.
   */
  const startCreating = () => {
    if (allCustomCount >= MAX_CUSTOM_INTERVIEWS) {
      promptUpgrade(
        MAX_CUSTOM_INTERVIEWS === 1
          ? "More than one interview of your own"
          : `More than ${MAX_CUSTOM_INTERVIEWS} interviews of your own`
      );
      return;
    }
    setCreating(true);
  };

  if (creating) {
    return (
      <CreateInterviewFlow
        onCancel={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          setSetupTab("personalized");
          refresh();
        }}
      />
    );
  }

  if (editing) {
    return (
      <TemplateEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setSetupTab("personalized");
          refresh();
        }}
      />
    );
  }

  if (assisting) {
    return (
      <QuestionsAssistant
        template={assisting}
        onClose={() => setAssisting(null)}
        onChanged={refresh}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {activeJobs > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span>
            Researching {activeJobs} interview{activeJobs === 1 ? "" : "s"} in
            the background; we’ll add {activeJobs === 1 ? "it" : "them"} here and
            notify you when ready.
          </span>
        </div>
      ) : null}

      {/* Compact, pinned controls: search · category · create (stays under the
          sticky page tabs so you can search / filter / create without scrolling). */}
      <div className="sticky top-11 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background px-1 py-2">
        <div className="relative min-w-[11rem] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={
              setupTab === "personalized"
                ? "Search personalized…"
                : "Search templates…"
            }
            className="h-9 pl-9 pr-9 focus-visible:ring-0 focus-visible:ring-offset-0"
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
        {setupTab === "templates" ? (
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as CategoryFilter)}
          >
            <SelectTrigger
              className="h-9 w-[10rem]"
              title="Filter templates by category"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All · {categoryCounts.all}</SelectItem>
              {INTERVIEW_CATEGORIES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label} · {categoryCounts[c.id] || 0}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button variant="default" onClick={startCreating}>
          <Plus className="size-4" />
          Create New
        </Button>
      </div>

      <Tabs
        value={setupTab}
        onValueChange={(v) => setSetupTab(v as "personalized" | "templates")}
        className="gap-4"
      >
        <TabsList>
          <TabsTrigger value="personalized">
            Personalized
            {allCustomCount > 0 ? (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-3xs">
                {allCustomCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="templates">Interview templates</TabsTrigger>
        </TabsList>

        <TabsContent value="personalized" className="space-y-3 outline-none">
          <p className="text-xs text-muted-foreground">
            Interviews you created or customized from a template. Edits stay
            here and leave the original unchanged.
            {allCustomCount >= MAX_CUSTOM_INTERVIEWS
              ? MAX_CUSTOM_INTERVIEWS === 1
                ? " One of your own at a time in this edition — delete this one to build a different interview."
                : ` ${MAX_CUSTOM_INTERVIEWS} of your own at a time in this edition — delete one to build another.`
              : ""}
          </p>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {customTemplates.length === 0
                ? search.trim()
                  ? "No matches"
                  : "No personalized interviews yet"
                : `Showing ${(safeCustomPage - 1) * INTERVIEW_PAGE_SIZE + 1}–${Math.min(
                    safeCustomPage * INTERVIEW_PAGE_SIZE,
                    customTemplates.length
                  )} of ${customTemplates.length}`}
            </span>
            {customTotalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safeCustomPage <= 1}
                  onClick={() => setCustomPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <span className="tabular-nums text-xs">
                  Page {safeCustomPage} / {customTotalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safeCustomPage >= customTotalPages}
                  onClick={() =>
                    setCustomPage((p) => Math.min(customTotalPages, p + 1))
                  }
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>

          {customTemplates.length === 0 ? (
            <div className="space-y-4">
              <Empty
                icon={Plus}
                title="No personalized interviews yet"
                description={
                  search.trim()
                    ? "Nothing matches your search here."
                    : "Create one from scratch, or customize a template; edits save here and leave the original unchanged."
                }
              />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-4">
                <CreateOwnCard onClick={startCreating} />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-4">
              {customPageItems.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  query={search}
                  isNew={template.id === newTemplateId}
                  expanded={expandedId === template.id}
                  editingSettings={editingId === template.id}
                  onToggleExpand={() => {
                    if (template.id === newTemplateId) setNewTemplateId(null);
                    if (expandedId === template.id) {
                      setExpandedId(null);
                      setEditingId(null);
                    } else {
                      setExpandedId(template.id);
                      setEditingId(null);
                    }
                  }}
                  onStartEditSettings={() => setEditingId(template.id)}
                  onDoneEditSettings={() => setEditingId(null)}
                  onStart={(t) => {
                    if (t.id === newTemplateId) setNewTemplateId(null);
                    onStart(t);
                  }}
                  onEditType={() => setEditing(template)}
                  onAssist={() => setAssisting(template)}
                  onDelete={() => setPendingDelete(template)}
                  onVoiceChange={(voice) =>
                    handleVoiceChange(template.id, voice)
                  }
                  onSettingsChange={(patch) =>
                    handleSettingsChange(template.id, patch)
                  }
                />
              ))}
              <CreateOwnCard onClick={startCreating} />
            </div>
          )}

          {customTotalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={safeCustomPage <= 1}
                onClick={() => setCustomPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: customTotalPages }, (_, i) => i + 1).map(
                  (n) => (
                    <Button
                      key={n}
                      size="sm"
                      variant={n === safeCustomPage ? "default" : "ghost"}
                      className="h-8 w-8 p-0 tabular-nums"
                      onClick={() => setCustomPage(n)}
                    >
                      {n}
                    </Button>
                  )
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={safeCustomPage >= customTotalPages}
                onClick={() =>
                  setCustomPage((p) => Math.min(customTotalPages, p + 1))
                }
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 outline-none">
          <p className="text-xs text-muted-foreground">
            Ready-made job interviews: start one, or customize it into
            Personalized. This edition runs one of them — General Behavioral,
            under General — and you can do anything with it. The rest are here to
            read; sitting one of those comes with the hosted app.
          </p>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {builtinFiltered.length === 0
                ? "No templates match"
                : `Showing ${(safePage - 1) * INTERVIEW_PAGE_SIZE + 1}–${Math.min(
                    safePage * INTERVIEW_PAGE_SIZE,
                    builtinFiltered.length
                  )} of ${builtinFiltered.length}`}
            </span>
            {totalPages > 1 ? (
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
            ) : null}
          </div>

          {pageItems.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
                <p className="text-sm font-medium">No matches in templates</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try another category or clear the search.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearch("");
                    setCategory("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-4">
                <CreateOwnCard onClick={startCreating} />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-4">
              {pageItems.map((template) => {
                // A locked card still renders in full — you can read what the
                // interview is — but every way in leads to the pitch instead.
                const locked = isLocked(template);
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    query={search}
                    locked={locked}
                    expanded={expandedId === template.id}
                    editingSettings={false}
                    onToggleExpand={() => {
                      if (locked) return pitchLocked(template);
                      if (expandedId === template.id) {
                        setExpandedId(null);
                        setEditingId(null);
                      } else {
                        setExpandedId(template.id);
                        setEditingId(null);
                      }
                    }}
                    onStartEditSettings={() =>
                      locked ? pitchLocked(template) : setEditing(template)
                    }
                    onDoneEditSettings={() => {}}
                    onStart={(t) => (locked ? pitchLocked(t) : onStart(t))}
                    onCustomize={() =>
                      locked ? pitchLocked(template) : setEditing(template)
                    }
                    onVoiceChange={() => {}}
                    onSettingsChange={() => {}}
                  />
                );
              })}
              <CreateOwnCard onClick={startCreating} />
            </div>
          )}

          {totalPages > 1 ? (
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
          ) : null}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete interview"
        description={
          pendingDelete
            ? `Delete “${pendingDelete.title}”? This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (!pendingDelete) return;
          const t = pendingDelete;
          deleteInterviewTemplate(t.id);
          if (expandedId === t.id) {
            setExpandedId(null);
            setEditingId(null);
          }
          refresh();
          toast("Interview deleted", {
            description: t.title,
            variant: "info",
          });
        }}
      />
    </div>
  );
}

function CreateOwnCard({ onClick }: { onClick: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="relative border-2 border-dashed border-input shadow-none p-4 gap-0 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:border-primary hover:bg-primary/5 min-h-[8.75rem]"
    >
      <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
        <Plus className="size-4.5" />
      </div>
      <p className="text-sm font-medium">Create your own</p>
      <p className="text-xs text-muted-foreground mt-1 select-none">
        Start from scratch for a role or company
      </p>
    </Card>
  );
}

function TemplateCard({
  template,
  isNew,
  locked,
  expanded,
  editingSettings,
  onToggleExpand,
  onStartEditSettings,
  onDoneEditSettings,
  onStart,
  onEditType,
  onAssist,
  onDelete,
  onCustomize,
  onVoiceChange,
  onSettingsChange,
  query,
}: {
  template: InterviewTemplate;
  isNew?: boolean;
  /**
   * A ready-made interview this edition doesn't run. The card stays fully
   * readable — that's the point — but every handler is the pitch, so the caller
   * routes them all to `promptUpgrade` rather than disabling anything here.
   */
  locked?: boolean;
  /** Active search query — highlights matches in the title. */
  query?: string;
  expanded: boolean;
  editingSettings: boolean;
  onToggleExpand: () => void;
  onStartEditSettings: () => void;
  onDoneEditSettings: () => void;
  onStart: (template: InterviewTemplate) => void;
  onEditType?: () => void;
  /** Personalized only: open the AI question assistant. */
  onAssist?: () => void;
  onDelete?: () => void;
  /** Built-in only: open editor that saves a personalized copy. */
  onCustomize?: () => void;
  onVoiceChange: (voice: InterviewVoiceId) => void;
  onSettingsChange: (patch: {
    difficulty?: InterviewDifficulty;
    focusAreas?: string[];
    notes?: string;
    productContext?: string;
    customQuestions?: string[];
    customQuestionCategories?: string[];
  }) => void;
}) {
  const cardQuestions = template.customQuestions ?? [];
  const hasCustom = cardQuestions.length > 0;
  // Which prepared questions to actually run. Defaults to all; the user can
  // uncheck any they want to skip from the expanded details.
  const [selectedQ, setSelectedQ] = useState<Set<number>>(
    () => new Set(cardQuestions.map((_, i) => i))
  );
  // Re-sync when the questions change (edits, or a different template reuses this card).
  useEffect(() => {
    setSelectedQ(new Set((template.customQuestions ?? []).map((_, i) => i)));
  }, [template.id, (template.customQuestions ?? []).join("\u0001")]);

  const toggleQ = (i: number) =>
    setSelectedQ((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const setAllQ = (all: boolean) =>
    setSelectedQ(all ? new Set(cardQuestions.map((_, i) => i)) : new Set());

  const startWithSelection = () => {
    // Locked cards hand straight off to the caller (which pitches) — no
    // question-selection rule should be able to swallow that click.
    if (locked) return onStart(template);
    if (!hasCustom) return onStart(template);
    if (selectedQ.size === 0) return;
    // All selected → start the template as-is.
    if (selectedQ.size === cardQuestions.length) return onStart(template);
    const cats = template.customQuestionCategories ?? [];
    const idxs = [...selectedQ].sort((a, b) => a - b);
    onStart({
      ...template,
      customQuestions: idxs.map((i) => cardQuestions[i]),
      customQuestionCategories: cats.length
        ? idxs.map((i) => cats[i] ?? cats[0] ?? "behavioral")
        : template.customQuestionCategories,
    });
  };

  return (
    <Card
      className={cn(
        "gap-0 py-0 overflow-hidden transition-shadow border shadow-none",
        // Expanded cards take the full row width, pushing the others down so
        // the details have room to breathe.
        expanded && "ring-1 ring-border shadow-sm col-span-full",
        "!bg-muted/40 border-border/60",
        isNew &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/40"
      )}
    >
      {/* Top action toolbar — sits at the very top, above the title & category
          tag, so the icons never squeeze the title. */}
      {(!template.builtIn && (onEditType || onDelete)) ||
      (template.builtIn && onCustomize) ? (
        <div className="flex items-center justify-end gap-0.5 px-3 pt-2">
          {!template.builtIn && onEditType ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              title="Edit type details"
              onClick={onEditType}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {template.builtIn && onCustomize ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              title={
                locked
                  ? "In the hosted app"
                  : "Customize (saves to Personalized)"
              }
              onClick={onCustomize}
            >
              {locked ? (
                <LockIcon className="h-3.5 w-3.5" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : null}
          {!template.builtIn && onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-destructive"
              title="Delete"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="w-full text-left px-5 pb-4 pt-1 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-expanded={expanded}
        onClick={onToggleExpand}
      >
        <CardHeader className="p-0 gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Highlight text={template.title} query={query} />
              {isNew ? (
                <Badge className="bg-primary text-primary-foreground">New</Badge>
              ) : null}
            </CardTitle>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="outline">
                {getInterviewCategoryLabel(template.category)}
              </Badge>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </div>
          </div>
          <CardDescription className="text-sm">
            {template.roleLevel}
          </CardDescription>
        </CardHeader>

        {/* One tidy meta line — enough to know what it's about, without clutter. */}
        <p className="mt-2 text-xs text-muted-foreground">
          {[
            template.difficulty.charAt(0).toUpperCase() +
              template.difficulty.slice(1),
            `${getEffectiveQuestionCount(template)} questions`,
            ...template.focusAreas.slice(0, 2),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </button>

      {expanded ? (
        <TemplateDetails
          template={template}
          editing={editingSettings}
          onStartEdit={onStartEditSettings}
          onDoneEdit={onDoneEditSettings}
          onCustomize={onCustomize}
          onVoiceChange={onVoiceChange}
          onSettingsChange={onSettingsChange}
          selectedQuestions={selectedQ}
          onToggleQuestion={toggleQ}
          onSelectAllQuestions={setAllQ}
        />
      ) : null}

      <CardContent className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-3">
        <Button
          className="min-w-0 flex-1 basis-36"
          // Not disabled on a locked card: a dead button explains nothing, and
          // this one's whole job is to say where the other interviews live.
          variant={locked ? "outline" : "default"}
          disabled={!locked && hasCustom && selectedQ.size === 0}
          title={locked ? "This interview comes with the hosted app" : undefined}
          onClick={startWithSelection}
        >
          {locked ? (
            <>
              <LockIcon className="h-4 w-4 shrink-0" />
              In the hosted app
            </>
          ) : (
            <>
              <Play className="h-4 w-4 shrink-0" />
              {hasCustom &&
              expanded &&
              selectedQ.size > 0 &&
              selectedQ.size !== cardQuestions.length
                ? `Practice ${selectedQ.size} selected`
                : "Start practice"}
            </>
          )}
        </Button>
        {!template.builtIn && onAssist ? (
          <Button
            variant="outline"
            className="shrink-0"
            title="Refine with AI: add or research more questions"
            onClick={onAssist}
          >
            <Sparkles className="h-4 w-4" />
            Refine
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TemplateDetails({
  template,
  editing,
  onStartEdit,
  onDoneEdit,
  onCustomize,
  onVoiceChange,
  onSettingsChange,
  selectedQuestions,
  onToggleQuestion,
  onSelectAllQuestions,
}: {
  template: InterviewTemplate;
  editing: boolean;
  onStartEdit: () => void;
  onDoneEdit: () => void;
  onCustomize?: () => void;
  onVoiceChange: (voice: InterviewVoiceId) => void;
  onSettingsChange: (patch: {
    difficulty?: InterviewDifficulty;
    focusAreas?: string[];
    notes?: string;
    productContext?: string;
    customQuestions?: string[];
    customQuestionCategories?: string[];
  }) => void;
  /** View-mode question picker: which prepared questions will run. */
  selectedQuestions?: Set<number>;
  onToggleQuestion?: (index: number) => void;
  onSelectAllQuestions?: (all: boolean) => void;
}) {
  const customQuestions = template.customQuestions ?? [];
  // Built-ins are view-only; Edit customizes a personalized copy.
  const canEditInPlace = !template.builtIn;
  const selectedCount = selectedQuestions?.size ?? customQuestions.length;
  const pickable = !!onToggleQuestion && customQuestions.length > 0;

  return (
    <div
      className="px-5 pb-2 space-y-3 border-t border-border/50 pt-3 animate-in fade-in-0 slide-in-from-top-1 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {editing && canEditInPlace ? "Editing settings" : "Details"}
        </p>
        {canEditInPlace ? (
          editing ? (
            <Button size="sm" variant="outline" onClick={onDoneEdit}>
              <Check className="h-3.5 w-3.5" />
              Done
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )
        ) : onCustomize ? (
          <Button size="sm" variant="outline" onClick={onCustomize}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}
      </div>

      {!canEditInPlace ? (
        <p className="text-2xs text-muted-foreground">
          Edit saves a personalized copy; this template stays unchanged.
        </p>
      ) : null}

      <DetailRow label="Role / level" value={template.roleLevel} />
      <DetailRow
        label="Category"
        value={getInterviewCategoryLabel(template.category)}
      />

      {editing && canEditInPlace ? (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Difficulty
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["easy", "medium", "hard"] as InterviewDifficulty[]).map(
                (level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onSettingsChange({ difficulty: level })}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-center text-xs font-medium capitalize transition-colors",
                      template.difficulty === level
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/60 bg-background hover:bg-muted/60"
                    )}
                  >
                    {level}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Interviewer voice
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {INTERVIEW_VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  title={v.description}
                  onClick={() => onVoiceChange(v.id)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors",
                    template.voice === v.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-background hover:bg-muted/60"
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <FocusAreasEditor
            key={`${template.id}-focus-edit`}
            initial={template.focusAreas}
            onSave={(focusAreas) => onSettingsChange({ focusAreas })}
          />

          <CustomQuestionsEditor
            key={`${template.id}-questions-edit`}
            initial={customQuestions}
            initialCategories={template.customQuestionCategories}
            defaultCategory={
              template.answerMode === "coding"
                ? "coding"
                : template.answerMode === "system_design"
                  ? "system_design"
                  : "behavioral"
            }
            onSave={(questions, categories) =>
              onSettingsChange({
                customQuestions: questions,
                customQuestionCategories: categories,
              })
            }
          />

          <NotesEditor
            key={`${template.id}-notes-edit`}
            label="Notes for the interviewer"
            initial={template.notes}
            placeholder="Tone, company context, topics to dig into or avoid…"
            onSave={(notes) => onSettingsChange({ notes })}
          />
        </>
      ) : (
        <>
          <DetailRow
            label="Difficulty"
            value={
              template.difficulty.charAt(0).toUpperCase() +
              template.difficulty.slice(1)
            }
          />
          <DetailRow
            label="Questions"
            value={
              customQuestions.length > 0
                ? `${customQuestions.length} prepared`
                : `${getEffectiveQuestionCount(template)} (AI-generated)`
            }
          />
          <DetailRow
            label="Interviewer voice"
            value={getInterviewVoiceLabel(template.voice)}
          />

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Focus areas
            </div>
            {template.focusAreas.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {template.focusAreas.map((area) => (
                  <Badge key={area} variant="outline">
                    {area}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                General fit for the role
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                Your questions
              </div>
              {pickable ? (
                <div className="flex items-center gap-2 text-2xs">
                  <span className="tabular-nums text-muted-foreground">
                    {selectedCount}/{customQuestions.length} selected
                  </span>
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() =>
                      onSelectAllQuestions?.(
                        selectedCount !== customQuestions.length
                      )
                    }
                  >
                    {selectedCount === customQuestions.length
                      ? "Clear"
                      : "Select all"}
                  </button>
                </div>
              ) : null}
            </div>
            {pickable ? (
              <>
                <p className="text-2xs text-muted-foreground">
                  Uncheck any you want to skip; only checked questions run.
                </p>
                <ul className="space-y-1.5">
                  {customQuestions.map((q, i) => {
                    const on = selectedQuestions?.has(i) ?? true;
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => onToggleQuestion?.(i)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                            on
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/60 bg-background hover:bg-muted/50"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/40"
                            )}
                          >
                            {on ? <Check className="size-3" /> : null}
                          </span>
                          <span className={cn(!on && "text-muted-foreground")}>
                            {q}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {selectedCount === 0 ? (
                  <p className="text-2xs text-destructive">
                    Select at least one question to start.
                  </p>
                ) : null}
              </>
            ) : customQuestions.length > 0 ? (
              <ol className="list-decimal pl-4 space-y-1 text-sm">
                {customQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                {canEditInPlace
                  ? "None. The AI will generate questions. Click Edit to add your own."
                  : "None. The AI will generate questions. Customize to add your own."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Notes for the interviewer
            </div>
            {template.notes.trim() ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {template.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FocusAreasEditor({
  initial,
  onSave,
}: {
  initial: string[];
  onSave: (areas: string[]) => void;
}) {
  const [text, setText] = useState(initial.join(", "));

  const commit = () => {
    const areas = text
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const prev = initial.join("|");
    const next = areas.join("|");
    if (prev !== next) onSave(areas);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        Focus areas
      </div>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="leadership, system design, communication"
        className="h-9"
      />
      <p className="text-2xs text-muted-foreground">
        Comma-separated. Press Enter or click away to save.
      </p>
    </div>
  );
}

const QUESTION_CATEGORY_OPTIONS = [
  { id: "behavioral", label: "Behavioral" },
  { id: "technical", label: "Technical" },
  { id: "coding", label: "Coding" },
  { id: "system_design", label: "System design" },
] as const;

function CustomQuestionsEditor({
  initial,
  initialCategories,
  defaultCategory = "behavioral",
  onSave,
}: {
  initial: string[];
  initialCategories?: string[];
  defaultCategory?: string;
  onSave: (questions: string[], categories: string[]) => void;
}) {
  const [items, setItems] = useState<string[]>(
    initial.length > 0 ? initial : [""]
  );
  const [cats, setCats] = useState<string[]>(() =>
    (initial.length > 0 ? initial : [""]).map(
      (_, i) => initialCategories?.[i] || defaultCategory
    )
  );

  const commit = (nextItems: string[], nextCats: string[]) => {
    const pairs = nextItems
      .map((q, i) => [q.trim(), nextCats[i] || defaultCategory] as const)
      .filter(([q]) => q)
      .slice(0, 20);
    const cleanedQ = pairs.map(([q]) => q);
    const cleanedC = pairs.map(([, c]) => c);
    const changed =
      initial.join("|") !== cleanedQ.join("|") ||
      (initialCategories ?? []).join("|") !== cleanedC.join("|");
    if (changed) onSave(cleanedQ, cleanedC);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          Practice questions
        </div>
        <span className="text-2xs text-muted-foreground tabular-nums">
          {items.filter((q) => q.trim()).length}/20
        </span>
      </div>
      <p className="text-2xs text-muted-foreground">
        Asked in order, each in its own workbench by category. Leave empty and
        the AI generates the session.
      </p>
      <div className="space-y-2">
        {items.map((q, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-2.5 w-4 shrink-0 text-2xs tabular-nums text-muted-foreground">
              {i + 1}.
            </span>
            <div className="flex flex-1 flex-col gap-1.5">
              <Input
                value={q}
                placeholder="e.g. Tell me about a time you led a difficult project."
                className="h-9"
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  setItems(next);
                }}
                onBlur={() => commit(items, cats)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(items, cats);
                  }
                }}
              />
              <Select
                value={cats[i] || defaultCategory}
                onValueChange={(v) => {
                  const next = [...cats];
                  next[i] = v;
                  setCats(next);
                  commit(items, next);
                }}
              >
                <SelectTrigger className="h-8 w-[10.5rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.id} value={o.id} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="mt-0.5 h-9 w-9 shrink-0"
              title="Remove question"
              onClick={() => {
                const nextItems = items.filter((_, idx) => idx !== i);
                const nextCats = cats.filter((_, idx) => idx !== i);
                const ensuredItems = nextItems.length > 0 ? nextItems : [""];
                const ensuredCats =
                  nextCats.length > 0 ? nextCats : [defaultCategory];
                setItems(ensuredItems);
                setCats(ensuredCats);
                commit(ensuredItems, ensuredCats);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      {items.length < 20 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            setItems((prev) => [...prev, ""]);
            setCats((prev) => [...prev, defaultCategory]);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add question
        </Button>
      ) : null}
    </div>
  );
}

function NotesEditor({
  initial,
  onSave,
  label = "Notes for the interviewer",
  placeholder = "Tone, company context, topics to dig into or avoid…",
}: {
  initial: string;
  onSave: (notes: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(initial);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== initial) onSave(text);
        }}
        rows={3}
        placeholder={placeholder}
        className="min-h-[4.5rem] max-h-32 resize-y overflow-y-auto field-sizing-fixed text-sm"
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="text-sm">{value}</p>
    </div>
  );
}
