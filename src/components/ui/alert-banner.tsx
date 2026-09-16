import type { ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertBannerVariant =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "loading";

const VARIANTS: Record<
  AlertBannerVariant,
  { wrap: string; icon: string; Icon: React.ElementType; spin?: boolean }
> = {
  // Soft-orange card (matches the reference design) — used for errors so any
  // failure reads as an actionable, non-alarming notice.
  error: {
    wrap: "border-orange-200/80 bg-orange-50 text-orange-900 dark:border-orange-900/40 dark:bg-orange-950/40 dark:text-orange-100",
    icon: "text-orange-500 dark:text-orange-400",
    Icon: AlertTriangleIcon,
  },
  warning: {
    wrap: "border-amber-200/80 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
    icon: "text-amber-500 dark:text-amber-400",
    Icon: AlertTriangleIcon,
  },
  success: {
    wrap: "border-green-200/80 bg-green-50 text-green-900 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-100",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle2Icon,
  },
  info: {
    wrap: "border-primary/20 bg-primary/5 text-foreground",
    icon: "text-primary",
    Icon: InfoIcon,
  },
  loading: {
    wrap: "border-primary/20 bg-primary/5 text-foreground",
    icon: "text-primary",
    Icon: Loader2Icon,
    spin: true,
  },
};

export interface AlertBannerProps {
  variant?: AlertBannerVariant;
  title: string;
  description?: ReactNode;
  /** Optional right-aligned action (e.g. a <Button>). */
  action?: ReactNode;
  /** When provided, shows a dismiss (×) button. */
  onClose?: () => void;
  className?: string;
}

/**
 * A soft, inline notice card: an icon, a bold title, a description, and an
 * optional action button on the right. Styled after the reference "Auto
 * recharge is off" banner — used for upload results and other error/status
 * messages so they read clearly and consistently.
 */
export function AlertBanner({
  variant = "info",
  title,
  description,
  action,
  onClose,
  className,
}: AlertBannerProps) {
  const v = VARIANTS[variant];
  const Icon = v.Icon;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        v.wrap,
        className
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", v.icon, v.spin && "animate-spin")}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
