import { useState } from "react";
import { PinIcon, XIcon } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  clearReferencePins,
  pinKey,
  removeReferencePin,
  type ReferencePin,
} from "@/lib/reference";
import { cn } from "@/lib/utils";

type Props = {
  pins: ReferencePin[];
  onPinsChange: (pins: ReferencePin[]) => void;
};

/**
 * The few reference lines someone wants on screen no matter what — a headline
 * metric, an exact title, a date. Sits directly above the transcript so it
 * survives closing the reference rail, which is the whole point: mid-answer you
 * shouldn't have to reopen a panel to recall one number.
 *
 * Chips are truncated to keep the bar one line tall; clicking one expands it in
 * place for the full sentence.
 */
export const PinnedStrip = ({ pins, onPinsChange }: Props) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (pins.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-border/50 bg-primary/5 px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <Tooltip label="Pinned from your reference files" side="bottom">
          <PinIcon className="mt-0.5 size-3 shrink-0 text-primary" />
        </Tooltip>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {pins.map((pin) => {
            const key = pinKey(pin.source, pin.text);
            const isOpen = expanded === key;
            return (
              <span
                key={key}
                className={cn(
                  "group/pin inline-flex items-start gap-1 rounded-full border border-primary/25 bg-background/70 px-2 py-0.5 text-[10px]",
                  isOpen ? "w-full rounded-md" : "max-w-[13rem]"
                )}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : key)}
                  title={`${pin.docLabel}, click to ${
                    isOpen ? "collapse" : "expand"
                  }`}
                  className={cn(
                    "min-w-0 select-text text-left leading-snug",
                    isOpen ? "whitespace-normal" : "truncate"
                  )}
                >
                  {pin.text}
                </button>
                <button
                  onClick={() => {
                    onPinsChange(removeReferencePin(pin.source, pin.text));
                    if (isOpen) setExpanded(null);
                  }}
                  aria-label="Unpin"
                  className="mt-px shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/pin:opacity-100 focus-visible:opacity-100"
                >
                  <XIcon className="size-2.5" />
                </button>
              </span>
            );
          })}
        </div>
        {pins.length > 1 && (
          <button
            onClick={() => {
              onPinsChange(clearReferencePins());
              setExpanded(null);
            }}
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};
