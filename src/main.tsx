import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import {
  AppProvider,
  ThemeProvider,
  AuthProvider,
  BugReportProvider,
} from "./contexts";
import { Toaster } from "./components/ui/toaster";
// Figtree — the same UI text font used on the marketing site. Bundled locally
// (via @fontsource) so it works offline inside the desktop webview.
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
// EB Garamond — the marketing site's elegant display serif (used for onboarding
// headings). Bundled locally so it works offline inside the desktop webview.
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/500.css";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";

// Falls back to "main" outside a real Tauri webview (e.g. running the Vite
// dev server directly in a browser for debugging) instead of crashing before
// React even mounts.
let windowLabel = "main";
try {
  windowLabel = getCurrentWindow().label;
} catch {
  // Not running inside Tauri — keep the "main" fallback.
}

// Render different components based on window label
if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Overlay monitorIndex={monitorIndex} />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <AppProvider>
            <BugReportProvider>
              <AppRoutes />
              <Toaster />
            </BugReportProvider>
          </AppProvider>
        </AuthProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}
