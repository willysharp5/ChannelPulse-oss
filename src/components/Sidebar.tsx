import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useBugReport } from "@/contexts";
import { useMenuItems, useVersion } from "@/hooks";

/**
 * "Setup needed" red dot with a hover reveal. The sidebar `nav` uses
 * `overflow-y-auto` (which also clips overflow-x), so a normal in-flow tooltip
 * gets cut off. This renders the reveal in a portal with fixed coordinates,
 * opening to the right of the dot (into open space) so it's never clipped.
 */
const AlertDot = ({ reason }: { reason: string }) => {
  const dotRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = dotRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top + r.height / 2, left: r.right + 10 });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={dotRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="size-2 shrink-0 rounded-full bg-red-500 ring-2 ring-red-500/20"
        aria-label="Setup needed"
      />
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            className="pointer-events-none fixed z-[100] max-w-[15rem] -translate-y-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-2xs font-medium leading-snug text-background shadow-md"
          >
            {reason}
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * Preferred dashboard height (logical px). Mirrors DASHBOARD_HEIGHT in
 * src-tauri/src/window.rs, which also clamps it to the display it opens on.
 */
const DASHBOARD_HEIGHT = 1010;

/**
 * Snap the dashboard to the preferred height when it's still on an old default.
 * Does not fight other manual sizes.
 */
async function fitDashboardHeight() {
  try {
    const win = getCurrentWebviewWindow();
    if (win.label !== "dashboard") return;

    const scale = await win.scaleFactor();
    const inner = await win.innerSize();
    const currentH = inner.height / scale;
    const currentW = inner.width / scale;

    const nearOld =
      Math.abs(currentH - 700) < 8 ||
      Math.abs(currentH - 820) < 8 ||
      Math.abs(currentH - 900) < 8 ||
      (currentH > 960 && currentH < 1000);
    if (!nearOld) return;

    await invoke("set_window_size", {
      width: Math.round(currentW),
      height: DASHBOARD_HEIGHT,
    });
  } catch {
    // Browser / non-Tauri — ignore.
  }
}

export const Sidebar = () => {
  const { version, isLoading } = useVersion();
  const { menuGroups, footerItems, footerLinks } = useMenuItems();
  const { startSession } = useBugReport();
  const didFitHeight = useRef(false);

  const navigate = useNavigate();
  const activeRoute = useLocation().pathname;

  useLayoutEffect(() => {
    if (didFitHeight.current) return;
    const id = requestAnimationFrame(() => {
      void fitDashboardHeight().then(() => {
        didFitHeight.current = true;
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <aside className="flex w-56 flex-col select-none pt-2">
      {/* Logo */}
      <div
        data-sidebar-logo
        onClick={() => navigate("/dashboard")}
        className="flex h-16 items-center px-4 pt-10 gap-1.5"
      >
        <img
          src="/app-icon.png"
          alt="ChannelPulse"
          className="size-6 lg:size-7 rounded-lg transition-all duration-300"
        />
        <div className="flex flex-col">
          <h1 className="text-xs lg:text-md font-semibold text-foreground transition-all duration-300">
            ChannelPulse
          </h1>
          <span className="text-3xs lg:text-2xs text-muted-foreground -mt-1 block">
            {isLoading ? "Loading..." : `(v${version})`}
          </span>
        </div>
      </div>

      {/* Navigation — clustered into titled group cards */}
      <nav
        data-sidebar-nav
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
      >
        {menuGroups.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.title}
            </p>
            <div className="space-y-0.5 rounded-xl border border-border/40 bg-muted/20 p-1">
              {group.items.map((item, index) => {
                const active = activeRoute.includes(item.href);
                return (
                  <button
                    onClick={() => navigate(item.href)}
                    key={`${item.label}-${index}`}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs lg:text-sm text-sidebar-foreground/70 transition-all duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      active &&
                        "font-medium bg-sidebar-accent text-sidebar-accent-foreground",
                      // Core feature: soft weight/tint, not a loud promo chip
                      item.featured &&
                        !active &&
                        "font-semibold text-sidebar-foreground bg-primary/[0.06] hover:bg-primary/[0.1]",
                      item.featured && active && "font-semibold"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon
                        className={cn(
                          "size-3 lg:size-4 transition-all duration-300",
                          item.featured && "text-primary"
                        )}
                      />
                      {item.label}
                    </div>
                    {item.alert ? (
                      <AlertDot
                        reason={
                          item.alertReason ??
                          "Set this up to get the most out of ChannelPulse"
                        }
                      />
                    ) : item.count ? (
                      <span className="flex size-5 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div data-sidebar-footer className="flex flex-col space-y-1 px-3 pb-3">
        {footerLinks.length > 0
          ? footerLinks.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                type="button"
                data-tour={item.title.toLowerCase() === "help" ? "help" : undefined}
                title={`${item.title}, opens in your browser`}
                onClick={() => openUrl(item.link).catch(() => {})}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs lg:text-sm text-sidebar-foreground/70 transition-all duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="size-3 lg:size-4 transition-all duration-300" />
                {item.title}
              </button>
            ))
          : null}
        {footerItems.map((item, index) => {
          const className = cn(
            "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs lg:text-sm text-sidebar-foreground/70 transition-all duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            item.href &&
              !item.href.startsWith("http") &&
              activeRoute.includes(item.href) &&
              "font-medium bg-sidebar-accent text-sidebar-accent-foreground"
          );
          const body = (
            <div className="flex items-center gap-3">
              <item.icon className="size-3 lg:size-4 transition-all duration-300" />
              {item.label}
            </div>
          );

          if (item.action) {
            return (
              <button
                type="button"
                key={`${item.label}-${index}`}
                className={className}
                onClick={() => void item.action?.()}
              >
                {body}
              </button>
            );
          }

          if (item.href?.startsWith("http")) {
            return (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                key={`${item.label}-${index}`}
                className={className}
              >
                {body}
              </a>
            );
          }

          return (
            <button
              type="button"
              key={`${item.label}-${index}`}
              className={className}
              onClick={() => {
                if (!item.href) return;
                if (item.href === "/report-bug") startSession();
                navigate(item.href);
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
    </aside>
  );
};
