/**
 * Runtime discriminator: are we inside the native Tauri webview, or a plain
 * browser (the web build)? Tauri injects `__TAURI_INTERNALS__` onto `window`
 * before any app code runs, so its presence is a reliable signal. Everything
 * that reaches into a Tauri-only capability (system audio, global shortcuts,
 * window chrome, native SQLite) should gate on this so the same `src/` code
 * runs unchanged in both targets.
 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Inverse of {@link isTauri} — running as the browser web app. */
export const isWeb = (): boolean => !isTauri();

/**
 * Send a URL to the user's browser.
 *
 * The Tauri webview will not navigate away from the app on a plain anchor or
 * `window.open`, so on desktop the URL has to be handed to the OS. Every
 * "read more on the site" link in the app goes through here so neither build
 * has to think about it.
 */
export const openExternal = (url: string): void => {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // Imported lazily: the web build never needs the Tauri plugin.
  void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
};

/**
 * Get current platform
 */
export const getPlatform = (): "macos" | "windows" | "linux" => {
  // Try modern API first (if available)
  if ((navigator as any).userAgentData?.platform) {
    const platform = (navigator as any).userAgentData.platform.toLowerCase();
    if (platform.includes("mac")) return "macos";
    if (platform.includes("win")) return "windows";
    return "linux";
  }

  // Fallback to deprecated API
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  return "linux";
};

/**
 * Check if current platform is macOS
 */
export const isMacOS = (): boolean => getPlatform() === "macos";

/**
 * Check if current platform is Windows
 */
export const isWindows = (): boolean => getPlatform() === "windows";

/**
 * Check if current platform is Linux
 */
export const isLinux = (): boolean => getPlatform() === "linux";
