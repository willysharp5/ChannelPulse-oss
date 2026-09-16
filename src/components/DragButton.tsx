import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GripVerticalIcon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  GetLicense,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components";
import { useWindowResize } from "@/hooks";

export const DragButton = () => {
  const { hasActiveLicense } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const { resizeWindow } = useWindowResize();

  useEffect(() => {
    if (!hasActiveLicense) {
      resizeWindow(isOpen);
    }
  }, [hasActiveLicense, isOpen, resizeWindow]);

  if (!hasActiveLicense) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild className="border-none hover:bg-transparent">
          <Button
            variant="ghost"
            size="icon"
            className={`-ml-[2px] w-fit`}
            title="Drag to move the panel"
          >
            <GripVerticalIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-fit select-none p-4 border overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col gap-2 w-116">
            <div className="flex flex-col gap-1 pb-2">
              <p className="text-md font-medium">
                You need an active license to use this feature.
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                Once you complete your purchase, you'll receive a license key
                via email. Paste in the Settings → ChannelPulse Access section to
                activate.
              </p>
            </div>
            <GetLicense setState={setIsOpen} />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`-ml-[2px] w-fit`}
      data-tauri-drag-region={hasActiveLicense}
      // Double-click snaps the overlay back to the top centre of whichever
      // display the cursor is on — the way back when it has been dragged (or
      // widened) so far to one side that most of it is off the screen.
      onDoubleClick={() => {
        invoke("center_overlay").catch((err) =>
          console.error("Failed to center the overlay:", err)
        );
      }}
      title="Drag to move the panel. Double-click to re-center it"
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
