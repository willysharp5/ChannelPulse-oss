import { Navigate, useLocation } from "react-router-dom";
import { SignIn } from "@/components";
import { useAuth } from "@/contexts";
import { LoaderIcon } from "lucide-react";

/**
 * The sign-in screen at a real URL.
 *
 * `DashboardLayout` used to render `<SignIn />` in place of whatever page you
 * asked for, which meant there was no address anyone could be *sent* to in
 * order to sign in: the marketing pages had to link at a gated app route and
 * trust that the gate appeared. Two things fall out of that. The URL bar keeps
 * saying the page you asked for while a login form is on screen, and once the
 * code is verified the reader is dropped wherever the app defaults to instead of
 * the page they clicked. Anything that redirects here passes `?next=<path>`.
 *
 * Safe to link to unconditionally — an already-signed-in visitor is bounced
 * straight to `next` without ever seeing the form.
 */

/** `next` is honoured only as a same-origin absolute path. A full URL or a
 * protocol-relative `//host` would turn this route into an open redirect. */
const safeNext = (raw: string | null): string => {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
};

export default function Login() {
  const { configured, loading, isSignedIn } = useAuth();
  const next = safeNext(new URLSearchParams(useLocation().search).get("next"));

  // Auth turned off (no Supabase keys in the build) — there is nothing to sign
  // in to, so don't strand the reader on a form that can't work.
  if (!configured) return <Navigate to={next} replace />;

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isSignedIn) return <Navigate to={next} replace />;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* Keeps the desktop window draggable by its top edge, same as the
          dashboard shell — the login screen has no title bar of its own. */}
      <div
        className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
        data-tauri-drag-region={true}
      />
      <SignIn />
    </div>
  );
}
