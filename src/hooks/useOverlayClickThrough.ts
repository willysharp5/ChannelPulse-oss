import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

/**
 * Makes the transparent floating overlay click-through everywhere except over
 * its visible controls — including the transcript/details panel, since it's a
 * Radix Popover and its portaled content picks up `data-radix-popper-content-
 * wrapper` automatically. Clicks anywhere else pass through to whatever's
 * behind the overlay (another app, or the desktop), even while the panel is
 * open — this is the whole point of a transparent overlay; don't reintroduce
 * a state that swallows the entire window's clicks.
 *
 * Interactive elements are found via `[data-overlay-interactive]` and Radix
 * popper wrappers. Reports the rectangles to the Rust side, which polls the
 * cursor and toggles `set_ignore_cursor_events` accordingly.
 *
 * The mutation observer deliberately watches only `document.body`'s direct
 * `childList` (no `subtree`, no `attributes`) — that's enough to react the
 * instant the popover wrapper mounts/unmounts, since Radix portals it
 * straight onto `body`. Watching the full subtree/attributes instead (as an
 * earlier version did) re-fired on every token while an answer streamed,
 * because Streamdown churns `class`/`style` many levels deep inside the
 * transcript — see the 2026-08-07 perf entry in AGENTS.md. Rarer changes this
 * narrower observer misses (e.g. the pill's own `isHidden` class toggling) are
 * still caught within 300ms by the safety-net interval below. `body` is
 * `h-screen`/`w-screen` (fixed to the window), so its own size doesn't change
 * with content either, keeping the ResizeObserver below equally quiet.
 *
 * `forceAll` is currently unused by any caller (kept as an escape hatch for a
 * future truly-modal state, e.g. a blocking confirmation dialog) — it makes
 * the whole window capture the mouse, at the cost of losing click-through
 * entirely while true.
 *
 * `panelOpacity` (0-1, matching the `--opacity` CSS var `ThemeProvider` sets
 * from the Window Transparency slider) makes the transcript/details panel
 * itself click-through once the window is nearly fully see-through — visually
 * transparent but still eating clicks was the complaint. Below the threshold
 * the panel behaves as usual (interactive). The always-present pill is
 * deliberately exempt: you need *some* way to interact with the app (stop
 * listening, re-open the panel) no matter how transparent it's set.
 */
export const FULLY_TRANSPARENT_OPACITY = 0.05;

export const useOverlayClickThrough = (
  forceAll: boolean,
  panelOpacity = 1
) => {
  const panelClickThrough = panelOpacity <= FULLY_TRANSPARENT_OPACITY;

  useEffect(() => {
    // Whole window interactive: the report is a constant, so send it once and
    // skip the observers below entirely.
    if (forceAll) {
      void invoke("set_overlay_hit_regions", {
        regions: [],
        forceAll: true,
      }).catch(() => {});
      return;
    }

    let raf = 0;
    // Last regions we sent, so unchanged layout costs no IPC.
    let lastSent = "";

    const report = () => {
      try {
        const els = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-overlay-interactive], [data-radix-popper-content-wrapper]"
          )
        ).filter((el) => {
          if (!panelClickThrough) return true;
          // Drop the popover wrapper and everything inside it (including its
          // own data-overlay-interactive elements, e.g. the resize handle) —
          // only the pill outside it stays interactive.
          return !el.closest("[data-radix-popper-content-wrapper]");
        });
        const regions: number[][] = [];
        els.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            // Pad a little so the very edges are easy to hit.
            regions.push([
              Math.round(r.left) - 2,
              Math.round(r.top) - 2,
              Math.round(r.width) + 4,
              Math.round(r.height) + 4,
            ]);
          }
        });

        const key = regions.map((r) => r.join(",")).join(";");
        if (key === lastSent) return;
        lastSent = key;

        void invoke("set_overlay_hit_regions", {
          regions,
          forceAll: false,
        }).catch(() => {});
      } catch {
        // Non-fatal — overlay just stays in its previous state.
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);

    // childList only, no subtree/attributes: this fires the instant the
    // popover wrapper mounts/unmounts (Radix portals it as a direct child of
    // body), without re-firing on class/style churn deep inside it while an
    // answer streams. Rarer changes this misses (e.g. the pill's own
    // isHidden toggle) are still caught by the 300ms interval below.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true });

    // Safety net for changes observers can miss (fonts, async layout, etc.).
    const interval = window.setInterval(report, 300);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("resize", schedule);
    };
  }, [forceAll, panelClickThrough]);
};
