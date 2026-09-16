import { openUrl } from "@tauri-apps/plugin-opener";
import { GlobeIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button, toast } from "@/components/ui";
import { WEB_APP_URL } from "@/config";
import { isWeb } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Routes the web build also serves, so "view this in the browser" can land on
 * the *same* page rather than dumping you on the dashboard. Must stay in step
 * with `src/routes/web.tsx` — `/audio`, `/screenshot` and `/shortcuts` are
 * desktop-only (native capture / global shortcuts) and are not in here.
 */
const SHARED_ROUTES = [
  "/dashboard",
  "/profile",
  "/chats",
  "/personas",
  "/memory",
  "/interview-practice",
  "/responses",
  "/settings",
  "/report-bug",
];

/** The web URL for a desktop route, falling back to the web app's own entry. */
export function webAppUrlForPath(pathname: string): string {
  const match = SHARED_ROUTES.find(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  return match ? `${WEB_APP_URL}${pathname}` : WEB_APP_URL;
}

interface OpenInWebProps {
  /** Override the destination — defaults to the page you're currently on. */
  path?: string;
  className?: string;
}

const LABEL = "Open in browser";

/**
 * "Open in browser" — the same page in the web app.
 *
 * Lives in exactly one place: the icon beside the account button in
 * `DashboardLayout`'s top-right cluster. That's already on every dashboard page,
 * so per-page copies of it are just clutter.
 *
 * Renders **nothing on the web build**: there it would link the browser to
 * itself. This is the one direction that makes sense, since the desktop app is
 * the install and the web app is the thing you can reach from a locked-down
 * work laptop. Deep-links to the current route when the web build serves it.
 */
export function OpenInWeb({ path, className }: OpenInWebProps) {
  const location = useLocation();
  // Already in a browser — there's nowhere to send them.
  if (isWeb()) return null;

  const url = webAppUrlForPath(path ?? location.pathname);
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("size-8 text-muted-foreground", className)}
      onClick={() => {
        openUrl(url).catch(() => {
          toast("Couldn't open your browser", {
            description: url,
            variant: "error",
          });
        });
      }}
      title={`${LABEL} · ${url}`}
      aria-label={LABEL}
    >
      <GlobeIcon className="size-4" />
    </Button>
  );
}
