import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  Maximize2,
  Minimize2,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  Button,
  Highlight,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { Tooltip } from "@/components/Tooltip";
import {
  blockMatches,
  docOutline,
  listReferenceDocs,
  loadReferenceDoc,
  parseDocBlocks,
  pinKey,
  readLastReferenceDoc,
  toggleReferencePin,
  writeLastReferenceDoc,
  type ReferenceBlock,
  type ReferenceDoc,
  type ReferencePin,
} from "@/lib/reference";
import { cn } from "@/lib/utils";

type Props = {
  /** Rail width in px — the window is widened by exactly this much. */
  width: number;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
  pins: ReferencePin[];
  onPinsChange: (pins: ReferencePin[]) => void;
};

/**
 * Reference rail — read your resume or notes while the conversation is being
 * recorded.
 *
 * It docks to the right and widens the window (same trick as the chat panel) so
 * it sits BESIDE the transcript instead of covering it: during a live call you
 * need both at once. Content comes from the existing Files system, so anything
 * uploaded in Settings → Files is instantly available here with no second
 * import step. Everything is read-only; editing stays in Settings.
 */
export const ReferencePanel = ({
  width,
  wide,
  onToggleWide,
  onClose,
  pins,
  onPinsChange,
}: Props) => {
  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [source, setSource] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingBody, setLoadingBody] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const refreshDocs = useCallback(async () => {
    setLoadingDocs(true);
    setError("");
    try {
      const list = await listReferenceDocs();
      setDocs(list);
      setSource((current) => {
        if (current && list.some((d) => d.source === current)) return current;
        const remembered = readLastReferenceDoc();
        if (remembered && list.some((d) => d.source === remembered)) {
          return remembered;
        }
        return list[0]?.source || "";
      });
    } catch (err) {
      console.error("Failed to list reference docs:", err);
      setError("Couldn't load your files.");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocs();
  }, [refreshDocs]);

  // Load the selected doc's text. `cancelled` guards a fast doc switch from
  // having the slower earlier load overwrite the newer one.
  useEffect(() => {
    if (!source) {
      setBody("");
      return;
    }
    let cancelled = false;
    setLoadingBody(true);
    loadReferenceDoc(source)
      .then((text) => {
        if (cancelled) return;
        setBody(text);
        writeLastReferenceDoc(source);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load reference doc:", err);
        setBody("");
        setError("Couldn't open that file.");
      })
      .finally(() => {
        if (!cancelled) setLoadingBody(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const blocks = useMemo(() => parseDocBlocks(body), [body]);
  const outline = useMemo(() => docOutline(blocks), [blocks]);
  const visible = useMemo(
    () => blocks.filter((b) => blockMatches(b, query)),
    [blocks, query]
  );

  const activeDoc = docs.find((d) => d.source === source);
  const pinnedKeys = useMemo(
    () => new Set(pins.map((p) => pinKey(p.source, p.text))),
    [pins]
  );

  const jumpTo = (id: string) => {
    // Clearing the filter first, so a heading hidden by the search is mounted
    // by the time we try to scroll to it.
    setQuery("");
    requestAnimationFrame(() => {
      blockRefs.current[id]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  };

  const togglePin = (block: ReferenceBlock) => {
    if (!activeDoc) return;
    onPinsChange(
      toggleReferencePin({
        source: activeDoc.source,
        docLabel: activeDoc.label,
        text: block.text,
      })
    );
  };

  return (
    <aside
      style={{
        width,
        backgroundColor:
          "rgb(from var(--background) r g b / var(--opacity, 1))",
      }}
      className="flex shrink-0 flex-col border-l border-border/50"
    >
      {/* Header: what this is + rail controls */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileTextIcon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs font-medium">Reference</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip label="Reload files" align="end">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => void refreshDocs()}
              disabled={loadingDocs}
            >
              <RefreshCwIcon
                className={cn("h-3.5 w-3.5", loadingDocs && "animate-spin")}
              />
            </Button>
          </Tooltip>
          <Tooltip
            label={wide ? "Shrink reference" : "Expand reference"}
            align="end"
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={onToggleWide}
            >
              {wide ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>
          <Tooltip label="Close reference" align="end">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={onClose}
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Doc picker + search */}
      {docs.length > 0 && (
        <div className="flex-shrink-0 space-y-1.5 border-b border-border/50 p-2">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-7 w-full text-2xs">
              <SelectValue placeholder="Choose a file" />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.source} value={d.source}>
                  <span className="flex items-center gap-1.5">
                    {d.origin === "research" ? (
                      <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileTextIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{d.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in file…"
              className="h-7 w-full rounded-md border border-border/60 bg-transparent pl-7 pr-6 text-2xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>

          {/* Section chips — jump straight to a part of the doc. */}
          {outline.length > 1 && !query && (
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {outline.map((item) => (
                <button
                  key={item.id}
                  onClick={() => jumpTo(item.id)}
                  title={item.text}
                  className="max-w-[10rem] shrink-0 truncate rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  {item.text}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {error && (
            <p className="rounded-md bg-red-50 px-2 py-1.5 text-[10px] text-red-700">
              {error}
            </p>
          )}

          {loadingDocs || loadingBody ? (
            <div className="flex items-center gap-1.5 px-1 py-4 text-2xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Loading…
            </div>
          ) : docs.length === 0 ? (
            <div className="space-y-1 px-1 py-6 text-center">
              <FileTextIcon className="mx-auto size-5 text-muted-foreground/60" />
              <p className="text-2xs font-medium">No files yet</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Add your resume or notes in Settings → Files and they'll show up
                here to read while you record.
              </p>
            </div>
          ) : blocks.length === 0 ? (
            <p className="px-1 py-6 text-center text-[10px] text-muted-foreground">
              No readable text in this file.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-6 text-center text-[10px] text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            visible.map((block) => {
              const pinned = pinnedKeys.has(pinKey(source, block.text));
              return (
                <div
                  key={block.id}
                  ref={(el) => {
                    blockRefs.current[block.id] = el;
                  }}
                  // Nested bullets indent 10px per level so a sub-point reads as
                  // subordinate instead of as another top-level line.
                  style={
                    block.depth > 0
                      ? { paddingLeft: 4 + block.depth * 10 }
                      : undefined
                  }
                  className={cn(
                    "group/block relative rounded-md pr-6 px-1 transition-colors",
                    // Air above a heading, and a rule above each section, so the
                    // doc scans as sections rather than one continuous column.
                    block.level === 1 && "mt-3 first:mt-0 py-0.5",
                    block.level === 2 &&
                      "mt-4 first:mt-0 border-t border-border/40 pt-2.5",
                    block.level === 3 && "mt-3 first:mt-0 py-0.5",
                    block.level === 0 && block.bullet && "py-px",
                    pinned && "bg-primary/5"
                  )}
                >
                  <p
                    className={cn(
                      "select-text",
                      // Doc title.
                      block.level === 1 && "text-xs font-semibold text-foreground",
                      // Section banner ("EXPERIENCE", "SKILLS").
                      block.level === 2 &&
                        "text-[10px] font-semibold uppercase tracking-wider text-primary",
                      // Entry header ("Acme — Jan 2021 – Present").
                      block.level === 3 &&
                        "text-2xs font-medium leading-snug text-foreground",
                      block.level === 0 &&
                        "text-2xs leading-relaxed text-muted-foreground",
                      block.bullet && "pl-3"
                    )}
                  >
                    {block.bullet && (
                      <span className="absolute left-1 text-muted-foreground/70">
                        •
                      </span>
                    )}
                    <Highlight text={block.text} query={query} />
                  </p>

                  {/* Pin a line so it stays visible even with this rail closed. */}
                  <button
                    onClick={() => togglePin(block)}
                    aria-label={pinned ? "Unpin line" : "Pin line"}
                    title={
                      pinned
                        ? "Unpin, remove from the strip above the transcript"
                        : "Pin, keep this line above the transcript"
                    }
                    className={cn(
                      "absolute right-0.5 top-0.5 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
                      pinned
                        ? "text-primary opacity-100"
                        : "opacity-0 group-hover/block:opacity-100 focus-visible:opacity-100"
                    )}
                  >
                    {pinned ? (
                      <PinOffIcon className="size-3" />
                    ) : (
                      <PinIcon className="size-3" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {activeDoc && (
        <div className="flex-shrink-0 border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
          <span className="truncate">
            {query
              ? `${visible.length} of ${blocks.length} lines`
              : `${blocks.length} lines · read-only`}
          </span>
        </div>
      )}
    </aside>
  );
};
