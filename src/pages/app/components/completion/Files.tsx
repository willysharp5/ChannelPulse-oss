import { useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button, ScrollArea } from "@/components";
import { ProCta, ProFeatureList } from "@/components/pro-upsell";
import {
  PaperclipIcon,
  XIcon,
  PlusIcon,
  TrashIcon,
  SparklesIcon,
} from "lucide-react";
import { UseCompletionReturn } from "@/types";
import { MAX_FILES } from "@/config";
import { useApp } from "@/contexts";

export const Files = ({
  attachedFiles,
  handleFileSelect,
  removeFile,
  onRemoveAllFiles,
  isLoading,
  isFilesPopoverOpen,
  setIsFilesPopoverOpen,
  fileLimitHit,
  setFileLimitHit,
}: UseCompletionReturn) => {
  const { supportsImages } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAddMore = attachedFiles.length < MAX_FILES;

  // At the limit, "add another" is the pitch rather than the picker. The overlay
  // is its own window and lives outside ProUpsellProvider (that wraps the
  // dashboard), so it shows the same copy inline instead of the shared dialog.
  const handleAddMoreClick = () => {
    if (!canAddMore) {
      setFileLimitHit(true);
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="relative">
      <Popover open={isFilesPopoverOpen} onOpenChange={setIsFilesPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            onClick={() => {
              if (attachedFiles.length === 0) {
                // If no files, directly open file picker
                fileInputRef.current?.click();
              } else {
                // If files exist, show popover
                setIsFilesPopoverOpen(true);
              }
            }}
            disabled={isLoading || !supportsImages}
            className="cursor-pointer"
            title={
              supportsImages
                ? "Attach images"
                : "Image upload not supported by current AI provider"
            }
          >
            <PaperclipIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>

        {/* File count badge */}
        {attachedFiles.length > 0 && (
          <div className="absolute -top-2 -right-2 bg-primary-foreground text-primary rounded-full h-5 w-5 flex border border-primary items-center justify-center text-xs font-medium">
            {attachedFiles.length}
          </div>
        )}

        {attachedFiles.length > 0 && (
          <PopoverContent
            align="end"
            side="bottom"
            className="w-screen p-0 border shadow-lg overflow-hidden"
            sideOffset={8}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <h3 className="font-semibold text-sm select-none">
                {MAX_FILES === 1 ? "Attached Image" : "Attached Images"} (
                {attachedFiles.length}/{MAX_FILES})
              </h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsFilesPopoverOpen(false)}
                className="cursor-pointer"
                title="Close"
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea
              className={`p-4 ${
                fileLimitHit ? "h-[calc(100vh-26rem)]" : "h-[calc(100vh-11rem)]"
              }`}
            >
              {/* Grid layout based on number of images */}
              <div
                className={`gap-3 ${
                  attachedFiles.length <= 2
                    ? "flex flex-col"
                    : "grid grid-cols-2"
                }`}
              >
                {attachedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="relative group border rounded-lg overflow-hidden bg-muted/20"
                  >
                    <img
                      src={`data:${file.type};base64,${file.base64}`}
                      alt={file.name}
                      className={`w-full object-cover h-full`}
                    />

                    {/* File info overlay */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 text-xs">
                      <div className="truncate font-medium">{file.name}</div>
                      <div className="text-gray-300">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>

                    {/* Remove button */}
                    <Button
                      size="icon"
                      variant="default"
                      className="absolute top-2 right-2 h-6 w-6 cursor-pointer"
                      onClick={() => removeFile(file.id)}
                      title="Remove image"
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* One image per message in this edition — reaching for a second
                one is where the hosted app gets to say what it's for. Same copy
                as the shared dialog, inline because the overlay is its own
                window (see handleAddMoreClick). */}
            {fileLimitHit && (
              <div className="border-t bg-muted/40 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SparklesIcon className="size-4 shrink-0 text-primary" />
                    <p className="text-sm font-semibold">
                      One image per message here
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="cursor-pointer"
                    onClick={() => setFileLimitHit(false)}
                    title="Dismiss"
                  >
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  The hosted app takes several at once, and adds:
                </p>
                <ProFeatureList className="mt-2 space-y-1.5" />
                <div className="mt-3">
                  <ProCta />
                </div>
              </div>
            )}

            {/* Sticky footer with Add More button */}
            <div className="sticky bottom-0 border-t bg-background p-3 flex flex-row gap-2">
              <Button
                onClick={handleAddMoreClick}
                disabled={isLoading}
                className="w-2/4"
                variant="outline"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                {canAddMore ? "Add More Images" : "Attach another image"}
              </Button>
              <Button
                className="w-2/4"
                variant="destructive"
                onClick={onRemoveAllFiles}
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                {attachedFiles.length > 1 ? "Remove All Images" : "Remove Image"}
              </Button>
            </div>
          </PopoverContent>
        )}
      </Popover>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};
