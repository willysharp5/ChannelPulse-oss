import {
  ChevronDown,
  ClipboardCheck,
  MessagesSquare,
  RotateCcw,
} from "lucide-react";
import {
  Button,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components";
import { cn } from "@/lib/utils";
import type { ScorecardKind } from "@/lib/scorecard";
import moment from "moment";

/**
 * The bar above a finished conversation: which view you're on, and the actions
 * that belong to the scorecard (regenerate, re-grade as the other kind, copy).
 *
 * The Transcript side isn't decoration — the hover popovers quote it, so the
 * verbatim record has to stay one click away.
 */

export type ConversationView = "scorecard" | "transcript";

interface Props {
  view: ConversationView;
  onViewChange: (view: ConversationView) => void;
  /** Which review is showing; null before anything is generated. */
  kind: ScorecardKind | null;
  /** Markdown of the current scorecard, for Copy. Null when there isn't one. */
  markdown: string | null;
  generatedAt: number | null;
  stale: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onGradeAs: (kind: ScorecardKind) => void;
  messageCount: number;
}

export function ScorecardToolbar({
  view,
  onViewChange,
  kind,
  markdown,
  generatedAt,
  stale,
  busy,
  onRegenerate,
  onGradeAs,
  messageCount,
}: Props) {
  return (
    <div className="sticky top-0 z-20 -mx-2 mb-3 flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/95 px-2 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
        <ToggleButton
          active={view === "scorecard"}
          onClick={() => onViewChange("scorecard")}
          icon={<ClipboardCheck className="size-3.5" />}
          label="Scorecard"
        />
        <ToggleButton
          active={view === "transcript"}
          onClick={() => onViewChange("transcript")}
          icon={<MessagesSquare className="size-3.5" />}
          label="Transcript"
          count={messageCount}
        />
      </div>

      {view === "scorecard" ? (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {stale ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Conversation changed since this review
            </span>
          ) : generatedAt ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Reviewed {moment(generatedAt).fromNow()}
            </span>
          ) : null}

          {markdown ? (
            <CopyButton content={markdown} copyMessage="Scorecard copied" />
          ) : null}

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            onClick={onRegenerate}
            disabled={busy}
          >
            <RotateCcw className="size-3.5" />
            Regenerate
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-sm"
                disabled={busy}
                title="Review this conversation as a different kind"
              >
                {kind === "interview" ? "Interview" : "Meeting"}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-sm font-normal text-muted-foreground">
                Review this conversation as
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onGradeAs("interview")}>
                <ClipboardCheck className="size-3.5" />
                Interview: scores &amp; feedback
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onGradeAs("meeting")}>
                <MessagesSquare className="size-3.5" />
                Meeting: summary &amp; key points
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {typeof count === "number" ? (
        <span className="text-xs text-muted-foreground">{count}</span>
      ) : null}
    </button>
  );
}
