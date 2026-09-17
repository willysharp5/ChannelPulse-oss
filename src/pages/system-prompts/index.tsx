import moment from "moment";
import {
  Input,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Button,
  Empty,
} from "@/components";
import { useSystemPrompts } from "@/hooks";
import {
  Search,
  MoreHorizontal,
  PlusIcon,
  Pencil,
  Trash2,
  CheckCircle2,
  WandSparklesIcon,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DeleteSystemPrompt } from "./Delete";
import { CreateEditDialog } from "./CreateEditDialog";
import { SamplePrompts } from "./SamplePrompts";
import { useEffect, useMemo, useState } from "react";

const PERSONA_PAGE_SIZE = 8;
import { PageLayout } from "@/layouts";

const SystemPrompts = () => {
  const {
    prompts,
    isLoading,
    error,
    createPrompt,
    deletePrompt,
    updatePrompt,
    selectedPromptId,
    handleSelectPrompt,
    clearSelectedPrompt,
    clearError,
  } = useSystemPrompts();

  const [search, setSearch] = useState("");
  const [isCreateEditDialogOpen, setIsCreateEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<{
    id?: number;
    name: string;
    prompt: string;
  }>({
    name: "",
    prompt: "",
  });

  /**
   * Handle opening create dialog
   */
  const handleCreateClick = () => {
    setForm({ name: "", prompt: "" });
    setIsCreateEditDialogOpen(true);
  };

  /**
   * Handle opening edit dialog
   */
  const handleEditClick = (promptId: number) => {
    const promptToEdit = prompts.find((p) => p.id === promptId);
    if (promptToEdit) {
      setForm({
        id: promptToEdit.id,
        name: promptToEdit.name,
        prompt: promptToEdit.prompt,
      });
      setIsCreateEditDialogOpen(true);
    }
  };

  /**
   * Handle opening delete dialog
   */
  const handleDeleteClick = (promptId: number) => {
    const promptToDelete = prompts.find((p) => p.id === promptId);
    if (promptToDelete) {
      setForm({
        id: promptToDelete.id,
        name: promptToDelete.name,
        prompt: promptToDelete.prompt,
      });
      setIsDeleteDialogOpen(true);
    }
  };

  /**
   * Handle saving (create or update)
   */
  const handleSave = async () => {
    try {
      setIsSaving(true);
      clearError();

      if (form.id) {
        // Update existing prompt
        await updatePrompt(form.id, {
          name: form.name,
          prompt: form.prompt,
        });
      } else {
        // Create new prompt
        const newPrompt = await createPrompt({
          name: form.name,
          prompt: form.prompt,
        });
        // Auto-select the newly created prompt
        handleSelectPrompt(newPrompt.id);
      }

      setForm({ name: "", prompt: "" });
      setIsCreateEditDialogOpen(false);
    } catch (err) {
      console.error("Failed to save prompt:", err);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Handle delete confirmation
   */
  const handleDeleteConfirm = async (id: number) => {
    await deletePrompt(id);
    setForm({ name: "", prompt: "" });
    setIsDeleteDialogOpen(false);
  };

  /**
   * Handle AI generation
   */
  const handleGenerate = (
    generatedPrompt: string,
    generatedPromptName: string
  ) => {
    setForm((prev) => ({
      ...prev,
      prompt: generatedPrompt,
      name: generatedPromptName,
    }));
  };

  /**
   * A card click picks that persona — or, on the one already in use, puts it
   * back. One is active at a time, so this is the only way to run with none.
   */
  const handleCardClick = (promptId: number) => {
    if (promptId === selectedPromptId) {
      clearSelectedPrompt();
      return;
    }
    handleSelectPrompt(promptId);
  };

  /**
   * Filter prompts based on search
   */
  const filteredPrompts = prompts.filter(
    (prompt) =>
      prompt.name.toLowerCase().includes(search.toLowerCase()) ||
      prompt.prompt.toLowerCase().includes(search.toLowerCase())
  );

  // Newest first, then paginate.
  const [page, setPage] = useState(1);
  const orderedPrompts = useMemo(
    () => [...filteredPrompts].reverse(),
    [filteredPrompts]
  );
  const totalPages = Math.max(
    1,
    Math.ceil(orderedPrompts.length / PERSONA_PAGE_SIZE)
  );
  const safePage = Math.min(page, totalPages);
  const pagedPrompts = useMemo(
    () =>
      orderedPrompts.slice(
        (safePage - 1) * PERSONA_PAGE_SIZE,
        safePage * PERSONA_PAGE_SIZE
      ),
    [orderedPrompts, safePage]
  );
  // Reset to the first page whenever the search changes or pages shrink.
  useEffect(() => setPage(1), [search]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <PageLayout
      title="Personas"
      description="Specialize the assistant for your role or scenario (e.g. interview, studying, meetings). Personas layer on top of the core system prompt; they don't replace it. One is active at a time — click the one in use to turn it off."
    >
      {/* Error Display */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {/* Search Bar */}
      <div className="flex items-center gap-2 justify-between">
        <div className="relative w-full md:w-1/2 lg:w-1/3 select-none">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search personas..."
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
        <Button variant="default" size="default" onClick={handleCreateClick}>
          <PlusIcon className="size-4" />
          Create New
        </Button>
      </div>
      {filteredPrompts.length === 0 ? (
        <Empty
          isLoading={isLoading}
          icon={WandSparklesIcon}
          title="No personas yet"
          description="Create a persona or pick a template below to get started"
        />
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 pb-4">
          {pagedPrompts.map((prompt) => {
            const isSelected = selectedPromptId === prompt.id;
            return (
              <Card
                key={prompt.id}
                className={`relative border shadow-none p-4 pb-10 gap-0 group cursor-pointer transition-colors ${
                  isSelected
                    ? "!bg-primary/5 dark:!bg-primary/10 border-primary"
                    : "!bg-muted/40 border-border/60 hover:border-primary/40"
                }`}
                onClick={() => handleCardClick(prompt.id)}
                title={
                  isSelected
                    ? "In use — click to turn it off"
                    : "Click to use this persona"
                }
              >
                {isSelected && (
                  <CheckCircle2 className="size-5 text-green-500 flex-shrink-0 absolute top-2 right-2" />
                )}
                <CardHeader className="p-0 pb-0 select-none">
                  <div className="flex items-start justify-between gap-2 relative">
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-3xs text-base line-clamp-1 flex-1 pr-3">
                          {prompt.name}
                        </CardTitle>
                      </div>
                      <CardDescription className="h-14 line-clamp-3 text-xs leading-relaxed">
                        {prompt.prompt}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <div className="absolute bottom-2 left-4 w-full flex items-center justify-between">
                  <span className="text-3xs lg:text-xs text-muted-foreground select-none">
                    {prompt.created_at
                      ? moment
                          .utc(prompt.created_at, [
                            "YYYY-MM-DD HH:mm:ss",
                            moment.ISO_8601,
                          ])
                          .local()
                          .format("MMM D, YYYY")
                      : ""}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild className="mr-6">
                      <button
                        className="flex size-8 items-center justify-center rounded-xl transition-opacity hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <MoreHorizontal className="size-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(prompt.id);
                        }}
                      >
                        <Pencil className="size-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(prompt.id);
                        }}
                      >
                        <Trash2 className="size-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pb-6">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <span className="tabular-nums text-xs text-muted-foreground">
              Page {safePage} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        </>
      )}

      {/* Create/Edit Dialog */}
      <CreateEditDialog
        isOpen={isCreateEditDialogOpen}
        onOpenChange={setIsCreateEditDialogOpen}
        form={form}
        setForm={setForm}
        onSave={handleSave}
        onGenerate={handleGenerate}
        isEditing={!!form.id}
        isSaving={isSaving}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteSystemPrompt
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        promptId={form.id}
        promptName={form.name}
        onDelete={handleDeleteConfirm}
      />

      {/* Sample prompt templates */}
      <SamplePrompts
        prompts={prompts}
        selectedPromptId={selectedPromptId}
        createPrompt={createPrompt}
        handleSelectPrompt={handleSelectPrompt}
        clearSelectedPrompt={clearSelectedPrompt}
        onCreateClick={handleCreateClick}
      />
    </PageLayout>
  );
};

export default SystemPrompts;
