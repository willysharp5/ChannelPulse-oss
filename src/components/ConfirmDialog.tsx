import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "@/components/ui";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (default true). */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Reusable "are you sure?" confirmation dialog. Mirrors the existing delete
 * confirmation styling used across the app (icon + destructive action).
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) => {
  const [isBusy, setIsBusy] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsBusy(true);
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error("Confirmation action failed:", error);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {destructive && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            )}
            <div className="flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isBusy}
          >
            {isBusy ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
