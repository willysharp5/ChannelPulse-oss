import {
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
import { GenerateSystemPrompt } from "./Generate";
import { SparklesIcon, Lightbulb } from "lucide-react";

interface CreateEditDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  form: {
    id?: number;
    name: string;
    prompt: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      id?: number;
      name: string;
      prompt: string;
    }>
  >;
  onSave: () => void;
  onGenerate: (prompt: string, promptName: string) => void;
  isEditing?: boolean;
  isSaving?: boolean;
}

export const CreateEditDialog = ({
  isOpen,
  onOpenChange,
  form,
  setForm,
  onSave,
  onGenerate,
  isEditing = false,
  isSaving = false,
}: CreateEditDialogProps) => {
  const isFormValid = form.name.trim() && form.prompt.trim();

  const handleSave = () => {
    onSave();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[37.5rem] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="mt-4 px-6 shrink-0">
          {/* Reserve room on the right so the AI-generate button doesn't crowd
              the dialog's absolute X close button (top-4 right-4). */}
          <div className="flex items-center justify-between gap-3 pr-8">
            <div>
              <DialogTitle>
                {isEditing ? "Edit Persona" : "Create Persona"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {isEditing
                  ? "Update this persona. It's layered on top of the core system prompt."
                  : "Define a persona (your role or scenario) to specialize the assistant. It's added on top of the system prompt."}
              </DialogDescription>
            </div>
            <GenerateSystemPrompt onGenerate={onGenerate} />
          </div>
        </DialogHeader>
        <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Name
            </label>
            <Input
              placeholder="e.g., Code Review Expert, Creative Writer..."
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={isSaving}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Persona
            </label>
            <Textarea
              placeholder="e.g. I'm a college student studying for finals. Explain answers simply and quiz me..."
              className="min-h-[12.5rem] max-h-[25rem] resize-none overflow-y-auto"
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground/70 flex items-start gap-1.5">
              <Lightbulb className="size-3.5 shrink-0 mt-0.5" />
              <span>
                Tip: Be specific about tone, expertise level, and response
                format
              </span>
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 pb-6 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isFormValid || isSaving}>
            {isSaving ? (
              <>
                <SparklesIcon className="h-4 w-4 animate-pulse" />
                {isEditing ? "Updating..." : "Creating..."}
              </>
            ) : isEditing ? (
              "Update"
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
