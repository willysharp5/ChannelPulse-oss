import {
  Sidebar,
  AccountButton,
  BugReportCaptureBar,
  ProUpsellProvider,
} from "@/components";
import { Outlet } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "./ErrorLayout";
import { useAuth } from "@/contexts";
import { LoaderIcon } from "lucide-react";

/**
 * ChannelPulse OSS is local-first and free: the whole app is usable with no
 * account and no network, and NOTHING here is gated behind sign-in. There is no
 * account-only feature left in this edition — signing in is only useful to
 * someone running their own backend, where it turns on cross-device sync and
 * the question bank. The account button is therefore shown only when a backend
 * is configured, and hidden entirely in fully-local mode.
 */
export const DashboardLayout = () => {
  const { configured, loading, isSignedIn } = useAuth();

  // Auth enabled + still resolving the session: brief spinner so the account
  // button doesn't flicker. Never blocks the app itself.
  if (configured && loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallbackRender={({ error }) => {
        return <ErrorLayout message={error?.message} />;
      }}
      onError={(error, info) => {
        console.error("DashboardLayout caught an error:", error, info);
      }}
      resetKeys={["dashboard-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div className="relative flex h-screen w-screen overflow-hidden bg-background">
        {/* Draggable region */}
        <div
          className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
          data-tauri-drag-region={true}
        />

        {/* Sidebar */}
        <Sidebar />
        {/* Main Content */}
        <main className="flex flex-1 flex-col overflow-hidden px-8">
          {/* Account control (top-right). Only meaningful when a backend is
              configured (self-hosters), where signing in enables sync and the
              question bank. Hidden entirely in fully-local mode. */}
          {configured && isSignedIn && (
            <div className="absolute right-6 top-2 z-50 flex items-center gap-2">
              <AccountButton />
            </div>
          )}

          {/* Provider for the shared "that's in the hosted app" dialog. Opened
              by the locked persona templates; sends people to the pricing page
              in a browser, since this build has no checkout. */}
          <ProUpsellProvider>
            <Outlet />
          </ProUpsellProvider>
        </main>

        {/* Visible on every dashboard tab while a bug-report session is active */}
        <BugReportCaptureBar />
      </div>
    </ErrorBoundary>
  );
};
