import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  HeadphonesIcon,
  UserIcon,
} from "lucide-react";
import type { Citation } from "@/types/completion";
import { cn } from "@/lib/utils";

/**
 * Always-visible clue that Profile / Files / transcript / web were injected
 * into this answer.
 */
export function ContextUsed({
  citations,
  className,
  compact,
}: {
  citations?: Citation[] | null;
  className?: string;
  /** Smaller chips for the overlay. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = citations ?? [];
  const profile = list.find((c) => c.type === "profile");
  const transcript = list.find((c) => c.type === "transcript");
  const files = list.filter((c) => c.type === "file");
  const web = list.filter((c) => c.type === "web");
  if (!profile && !transcript && files.length === 0 && web.length === 0) {
    return null;
  }

  const chip = compact
    ? "inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-3xs font-medium text-foreground/90"
    : "inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 text-2xs font-medium text-foreground/90";

  const details = [
    ...(transcript
      ? [
          {
            key: "transcript",
            icon: HeadphonesIcon,
            title: "Conversation transcript",
            snippet: transcript.snippet,
          },
        ]
      : []),
    ...(profile
      ? [
          {
            key: "profile",
            icon: UserIcon,
            title: "Your profile",
            snippet: profile.snippet,
          },
        ]
      : []),
    ...files.map((f) => ({
      key: `file-${f.n}-${f.title}`,
      icon: FileTextIcon,
      title: f.title.replace(/^File:\s*/i, "") || "File",
      snippet: f.snippet,
    })),
    ...web.map((w) => ({
      key: `web-${w.n}`,
      icon: GlobeIcon,
      title: w.title || w.url || "Web",
      snippet: w.snippet,
    })),
  ];

  return (
    <div className={cn("mt-1.5 w-full", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "text-muted-foreground",
            compact ? "text-3xs" : "text-3xs"
          )}
        >
          Using
        </span>
        {transcript ? (
          <span className={chip}>
            <HeadphonesIcon className={compact ? "size-2.5" : "size-3"} />
            Transcript
          </span>
        ) : null}
        {profile ? (
          <span className={chip}>
            <UserIcon className={compact ? "size-2.5" : "size-3"} />
            Profile
          </span>
        ) : null}
        {files.map((f) => (
          <span key={`chip-${f.n}-${f.title}`} className={chip} title={f.title}>
            <FileTextIcon className={compact ? "size-2.5" : "size-3"} />
            <span className="max-w-[10rem] truncate">
              {f.title.replace(/^File:\s*/i, "") || "File"}
            </span>
          </span>
        ))}
        {web.length > 0 ? (
          <span className={chip}>
            <GlobeIcon className={compact ? "size-2.5" : "size-3"} />
            Web ({web.length})
          </span>
        ) : null}
        {details.some((d) => d.snippet) ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground",
              compact ? "text-3xs" : "text-3xs"
            )}
          >
            {open ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            details
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-1.5">
          {details.map((d) => (
            <li
              key={d.key}
              className="rounded-md border border-border/60 bg-muted/30 p-2 text-2xs"
            >
              <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                <d.icon className="size-3 shrink-0 text-primary" />
                <span className="truncate">{d.title}</span>
              </div>
              {d.snippet ? (
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {d.snippet}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** @deprecated Use {@link ContextUsed} */
export const MemoryUsed = ContextUsed;
