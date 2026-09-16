import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";

// The two heights the overlay toggles between (logical px). The collapsed one
// leaves room below the bar for hover tooltips. Both are 1.125x their original
// 600/88, matching the app-wide type scale in global.css and BAR_HEIGHT in
// src-tauri/src/window.rs.
const BAR_HEIGHT = 99;
const PANEL_HEIGHT = 675;

/**
 * How far the window's real height may sit from the height we asked for and
 * still count as "our own resize landing" — covers rounding between logical and
 * physical pixels on fractional-scale displays.
 */
const HEIGHT_SLACK = 12;

/**
 * The height we last asked the backend for, or `null` when we don't know what
 * the window is doing (nothing applied yet, or something outside this hook
 * resized it). Module scope on purpose: `useSystemAudio` and the overlay panel
 * both call `resizeWindow`, so they have to share one view of the window or
 * they can't dedupe against each other.
 */
let requestedHeight: number | null = null;

/**
 * The height the user dragged the window to. While it's set we stop
 * auto-expanding, so a pane you sized by hand survives new data arriving — the
 * live effects ask to expand on every transcription chunk and every streamed
 * token. Only an explicit collapse clears it.
 */
let userHeight: number | null = null;

/** Installed once per webview; there's no useful moment to tear it down. */
let sizeWatcher: Promise<void> | null = null;

/**
 * Remember the panel's expanded footprint so reopening restores the exact size
 * the user last had — a hand-dragged size, a maximize, or a rail width — no
 * matter which path closed the panel (collapse button, stopping capture, or a
 * click outside). Writing on every expanded resize (rather than only in the
 * collapse handler) is what makes this close-path-independent. We skip the
 * write when nothing changed so a streaming answer doesn't hammer storage.
 */
const persistExpandedSize = (width: number, height: number): void => {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.PANEL_LAYOUT);
    const layout = raw ? JSON.parse(raw) : {};
    if (layout.expandedWidth === width && layout.expandedHeight === height) {
      return;
    }
    layout.expandedWidth = width;
    layout.expandedHeight = height;
    safeLocalStorage.setItem(STORAGE_KEYS.PANEL_LAYOUT, JSON.stringify(layout));
  } catch {
    // Storage unavailable — the panel just won't remember its size.
  }
}

/**
 * Watch the window's real size so a manual resize can be told apart from ours.
 * This is what lets a dragged size stick: the drag handle and the panel's
 * expand/shrink toggle both bypass `resizeWindow`, and until we noticed them the
 * next transcription chunk snapped the window straight back.
 */
const watchWindowSize = (): Promise<void> => {
  if (sizeWatcher) return sizeWatcher;
  sizeWatcher = (async () => {
    try {
      const win = getCurrentWebviewWindow();
      const scale = await win.scaleFactor();
      await win.onResized(({ payload }) => {
        const width = Math.round(payload.width / scale);
        const height = Math.round(payload.height / scale);
        // Any expanded footprint — whether we asked for it, the user dragged it,
        // or a rail toggle produced it — is the size we want to reopen at, so
        // remember it eagerly. Guarded well above the bar so a collapse never
        // gets recorded as the "expanded" size.
        if (height > BAR_HEIGHT + HEIGHT_SLACK) {
          persistExpandedSize(width, height);
        }
        // The bar's own height is never a "user size" — it's where we put the
        // window every time we collapse.
        if (Math.abs(height - BAR_HEIGHT) <= HEIGHT_SLACK) {
          requestedHeight = BAR_HEIGHT;
          userHeight = null;
          return;
        }
        // Our own resize landing: keep the dedupe cache warm and move on.
        if (
          requestedHeight !== null &&
          Math.abs(height - requestedHeight) <= HEIGHT_SLACK
        ) {
          return;
        }
        // Anything else came from the user (corner drag) or from a direct
        // set_window_size call, so we no longer know what we last applied.
        userHeight = height;
        requestedHeight = null;
      });
    } catch {
      // Not running under Tauri (browser dev) — nothing to watch.
    }
  })();
  return sizeWatcher;
};

// Helper function to check if any popover is open in the DOM
const isAnyPopoverOpen = (): boolean => {
  const popoverContents = document.querySelectorAll(
    "[data-radix-popper-content-wrapper]"
  );
  return popoverContents.length > 0;
};

export const useWindowResize = () => {
  const resizeWindow = useCallback(async (expanded: boolean) => {
    const height = expanded ? PANEL_HEIGHT : BAR_HEIGHT;

    if (!expanded && isAnyPopoverOpen()) return;

    // Don't fight a size the user chose. Live transcription and streaming
    // answers both ask to expand continuously; without this guard a manually
    // resized pane was reset every time new data landed.
    if (expanded && userHeight !== null) return;

    // Already where we're being asked to go — skip the IPC. Each of these is a
    // real window resize, i.e. a full relayout of the webview, and the live
    // effects fire them many times a second while a response streams in.
    if (requestedHeight === height) return;

    const previous = requestedHeight;
    requestedHeight = height;
    // An explicit collapse is the one thing allowed to overrule a manual size.
    if (!expanded) userHeight = null;

    try {
      // When collapsing we also reset to the bar width; when expanding the
      // backend preserves the current width so a manual maximize isn't undone.
      await invoke("set_window_height", {
        window: getCurrentWebviewWindow(),
        height,
        resetWidth: !expanded,
      });
    } catch (error) {
      requestedHeight = previous;
      console.error("Failed to resize window:", error);
    }
  }, []);

  // Setup drag handling and popover monitoring
  useEffect(() => {
    void watchWindowSize();

    let isDragging = false;
    let popoverWasOpen = isAnyPopoverOpen();
    let pendingCheck: number | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isDragRegion = target.closest('[data-tauri-drag-region="true"]');

      if (isDragRegion) {
        isDragging = true;
      }
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;

      setTimeout(() => {
        if (!isAnyPopoverOpen()) {
          void resizeWindow(false);
        }
      }, 100);
    };

    // Collapse when a popover actually closes — i.e. on an open -> closed
    // transition, checked at most once per interval. The mutation callback
    // itself has to stay trivial: it runs for every DOM change under the body,
    // which during a streaming answer means once per token.
    const scheduleCheck = () => {
      if (pendingCheck !== null) return;
      pendingCheck = window.setTimeout(() => {
        pendingCheck = null;
        const open = isAnyPopoverOpen();
        const justClosed = popoverWasOpen && !open;
        popoverWasOpen = open;
        if (justClosed) void resizeWindow(false);
      }, 80);
    };

    const observer = new MutationObserver(scheduleCheck);

    // Observe the body for changes to detect popover open/close
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
      if (pendingCheck !== null) window.clearTimeout(pendingCheck);
    };
  }, [resizeWindow]);

  return { resizeWindow };
};

/**
 * Reopen the overlay at an exact size (logical px), used when the details panel
 * comes back so it lands on the same footprint the user last had. This is a
 * plain module function (not a hook) so callers don't spin up a second
 * `useWindowResize` instance — it just drives the shared window state.
 *
 * Marking the size as user-owned up front is the important part: `resizeWindow`
 * treats a set `userHeight` as sticky and skips its 675 preset, so the
 * auto-expand path can't clobber the size we're restoring even if it fires in
 * the same tick.
 */
export const restoreWindowSize = async (
  width: number,
  height: number
): Promise<void> => {
  userHeight = height;
  requestedHeight = height;
  try {
    await invoke("set_window_size", {
      window: getCurrentWebviewWindow(),
      width,
      height,
    });
  } catch (error) {
    console.error("Failed to restore window size:", error);
  }
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
