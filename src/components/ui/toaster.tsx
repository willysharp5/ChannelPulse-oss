import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  AlertTriangleIcon,
  InfoIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "info" | "loading";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

const EVENT = "channelpulse-toast";
let counter = 0;

export interface ToastOptions {
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after ms (0 = sticky). */
  duration?: number;
}

/**
 * Fire a toast from anywhere (no provider/context needed). Dispatches a window
 * event the mounted <Toaster/> renders.
 */
export function toast(title: string, opts: ToastOptions = {}): void {
  const detail: ToastItem = {
    id: ++counter,
    title,
    description: opts.description,
    variant: opts.variant ?? "success",
    duration: opts.duration ?? 3200,
  };
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  } catch {
    // no-op (non-browser)
  }
}

const META: Record<
  ToastVariant,
  { wrap: string; icon: string; Icon: React.ElementType }
> = {
  success: {
    wrap: "border-green-500/30 bg-background text-foreground",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle2Icon,
  },
  error: {
    wrap: "border-orange-400/40 bg-background text-foreground",
    icon: "text-orange-500 dark:text-orange-400",
    Icon: AlertTriangleIcon,
  },
  info: {
    wrap: "border-primary/30 bg-background text-foreground",
    icon: "text-primary",
    Icon: InfoIcon,
  },
  loading: {
    wrap: "border-primary/30 bg-background text-foreground",
    icon: "text-primary",
    Icon: Loader2Icon,
  },
};

/** Renders active toasts. Mount once near the app root. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent).detail as ToastItem;
      if (!t || typeof t.id !== "number") return;
      setItems((prev) => [...prev.slice(-3), t]);
      if (t.duration > 0) {
        setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== t.id));
        }, t.duration);
      }
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  const remove = (id: number) =>
    setItems((prev) => prev.filter((x) => x.id !== id));

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {items.map((t) => {
        const m = META[t.variant];
        const Icon = m.Icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur",
              "animate-in fade-in slide-in-from-bottom-2",
              m.wrap
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                m.icon,
                t.variant === "loading" && "animate-spin"
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
