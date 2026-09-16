import { CSSProperties, ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How close the tooltip can get to a clipping edge before nudging back. */
const EDGE_MARGIN = 6;

/**
 * The box that actually clips this tooltip's paint, which is NOT always the
 * window: the overlay's popover content has its own `overflow-hidden`
 * containers (e.g. `speech/index.tsx`'s `PopoverContent` and its content
 * column) well inside the (possibly much wider) native window. `position:
 * absolute` only escapes normal flow, not an ancestor's overflow clipping —
 * so we walk up from the trigger to find the nearest one and clamp against
 * *its* bounds. Falls back to the viewport if nothing clips.
 */
const getClipBounds = (from: HTMLElement): { left: number; right: number } => {
  let node = from.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (
      cs.overflow === "hidden" ||
      cs.overflowX === "hidden" ||
      cs.overflow === "clip" ||
      cs.overflowX === "clip"
    ) {
      const r = node.getBoundingClientRect();
      return { left: r.left + EDGE_MARGIN, right: r.right - EDGE_MARGIN };
    }
    node = node.parentElement;
  }
  return { left: EDGE_MARGIN, right: window.innerWidth - EDGE_MARGIN };
};

/**
 * Lightweight hover tooltip for the floating overlay. Native `title` tooltips
 * don't render in the borderless, non-focusing always-on-top window, so this
 * renders a small dark pill on hover using CSS only (no portal / no window
 * focus needed). Positioned below the trigger by default so it stays inside
 * the window bounds vertically.
 *
 * Horizontally it self-clamps on hover against the nearest clipping ancestor
 * (see `getClipBounds`) — several triggers (e.g. the Privacy Mode toggle) sit
 * close enough to one that a `wide`, `align="end"` label got clipped
 * mid-word. Measured via `getBoundingClientRect()` on mouseenter (layout
 * position is correct even at `opacity:0`) and nudged back inside through a
 * CSS custom property consumed by an arbitrary-value `translate-x-[...]`
 * utility — NOT an inline `transform`, which would silently clobber the
 * `scale-95`/`group-hover:scale-100` open/close animation below (they share
 * the `transform` property; the custom-property route only touches
 * `--tw-translate-x`, so they keep composing correctly).
 */
export const Tooltip = ({
  label,
  children,
  side = "bottom",
  align = "center",
  className,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "top";
  align?: "center" | "start" | "end";
  className?: string;
  /** Allow the label to wrap (with a max width) instead of a single line. */
  wide?: boolean;
}) => {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [clampShift, setClampShift] = useState(0);

  const baseTranslate = align === "center" ? "-50%" : "0px";
  const alignClass =
    align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2";

  const handleMouseEnter = () => {
    const wrapper = wrapperRef.current;
    const el = tooltipRef.current;
    if (!wrapper || !el) return;
    const bounds = getClipBounds(wrapper);
    const rect = el.getBoundingClientRect();
    let shift = 0;
    if (rect.left < bounds.left) shift = bounds.left - rect.left;
    else if (rect.right > bounds.right) shift = bounds.right - rect.right;
    setClampShift(shift);
  };

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-flex group/tooltip", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setClampShift(0)}
    >
      {children}
      <span
        ref={tooltipRef}
        role="tooltip"
        style={
          {
            "--tooltip-shift": `calc(${baseTranslate} + ${clampShift}px)`,
          } as CSSProperties
        }
        className={cn(
          "pointer-events-none absolute z-[60] translate-x-[var(--tooltip-shift)] rounded-md bg-foreground px-2 py-1 text-2xs font-medium text-background shadow-md opacity-0 scale-95 transition-all duration-150 group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100",
          wide
            ? "w-max max-w-[13.75rem] whitespace-normal leading-snug"
            : "whitespace-nowrap",
          alignClass,
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        )}
      >
        {label}
      </span>
    </span>
  );
};
