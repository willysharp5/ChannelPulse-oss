import {
  Badge,
  Input,
  Card,
  Empty,
  Button,
  ConfirmDialog,
  DateRangePicker,
  type DateRangeValue,
} from "@/components";
import { useHistory } from "@/hooks";
import { PageLayout } from "@/layouts";
import {
  MessageCircleIcon,
  Search,
  LoaderIcon,
  LayoutGridIcon,
  ListIcon,
  CheckIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import moment from "moment";
import { useNavigate } from "react-router-dom";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { deleteConversation } from "@/lib";
import { scheduleSync } from "@/lib/sync";
import { safeLocalStorage } from "@/lib/storage";
import { readAllScorecards } from "@/lib/scorecard";
import { onSyncedKeys } from "@/lib/sync/kv";
import { STORAGE_KEYS } from "@/config";
import { scoreTone } from "@/components";

// How many conversations to render per page as the user scrolls.
const PAGE_SIZE = 30;

type ViewMode = "list" | "cards";
// Bumped to _v2 when the default flipped from "list" to "cards", so an old
// stored "list" (often just the previous default, saved by one stray toggle)
// doesn't hide the new default. An explicit choice made from here on sticks.
const VIEW_MODE_KEY = "chats_view_mode_v2";

const Dashboard = () => {
  const conversations = useHistory();
  const navigate = useNavigate();

  // Cached scorecards, read purely to badge rows. This never generates
  // anything — a conversation only shows a score once its scorecard has been
  // built on the conversation page (or on another device: scorecards sync, and
  // a pull can land while this list is open, hence the re-read below).
  const [scorecards, setScorecards] = useState(() => readAllScorecards());
  useEffect(() => {
    return onSyncedKeys([STORAGE_KEYS.CONVERSATION_SCORECARDS], () => {
      setScorecards(readAllScorecards());
    });
  }, []);

  // Let the user choose how conversations are shown (a grid of cards or a
  // compact list). Persisted so the choice sticks across visits; **cards is the
  // default** — a recap is a thing you skim, and the card shows a preview and
  // the score badge, which a one-line row can't.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    safeLocalStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "cards"
  );
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    safeLocalStorage.setItem(VIEW_MODE_KEY, mode);
  };

  // Multi-select for bulk deletion.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectionActive = selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      for (const id of ids) {
        await deleteConversation(id);
        // Keep other windows/components in sync (mirrors single delete).
        window.dispatchEvent(
          new CustomEvent("conversationDeleted", { detail: id })
        );
      }
    } catch (err) {
      console.error("Failed to delete conversations:", err);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
      clearSelection();
      conversations.refreshConversations();
      // Push tombstones to the server promptly.
      scheduleSync(1000);
    }
  };

  const query = (conversations.search || "").toLowerCase().trim();

  // Filter conversations by when they were last updated.
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const fromTs = range.from ? range.from.getTime() : null;
  const toTs = range.to ? range.to.getTime() : null;
  const dateFilterActive = fromTs !== null || toTs !== null;

  type Conversation = (typeof conversations.conversations)[number];

  // Match on title OR anything in the transcript. Transcript matches come from
  // the DB-backed search (searchSnippets is keyed by conversation id).
  const matchesQuery = (doc: Conversation) =>
    !query ||
    doc.title?.toLowerCase().includes(query) ||
    conversations.searchSnippets.has(doc.id);

  const matchesDate = (doc: Conversation) => {
    if (fromTs !== null && doc.updatedAt < fromTs) return false;
    if (toTs !== null && doc.updatedAt > toTs) return false;
    return true;
  };

  // Flat, filtered, most-recent-first list (source list is already DESC).
  const filtered = useMemo(
    () =>
      conversations.conversations
        .filter(matchesQuery)
        .filter(matchesDate)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations.conversations, conversations.searchSnippets, query, fromTs, toTs]
  );

  // Infinite scroll: only render the first `visibleCount` conversations and
  // reveal more as a sentinel near the bottom scrolls into view.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset the window whenever the result set changes (e.g. new search/filter).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, fromTs, toTs, conversations.conversations.length]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Reveal more when the sentinel enters the scroll viewport.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = el.closest(
      "[data-radix-scroll-area-viewport]"
    ) as Element | null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + PAGE_SIZE);
        }
      },
      { root, rootMargin: "300px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, query]);

  // Group the currently-visible conversations by date for rendering.
  const groupedConversations = visible.reduce((acc, doc) => {
    const dateKey = moment(doc.updatedAt).format("YYYY-MM-DD");
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(doc);
    return acc;
  }, {} as Record<string, Conversation[]>);

  const visibleDates = Object.keys(groupedConversations)
    .sort((a, b) => moment(b).diff(moment(a)))
    .map((dateKey) => ({ dateKey, docs: groupedConversations[dateKey] }));

  // Wrap every occurrence of the query in a highlight <mark>.
  const highlight = (value: string): ReactNode => {
    if (!query || !value) return value;
    const lower = value.toLowerCase();
    const nodes: ReactNode[] = [];
    let last = 0;
    let key = 0;
    let i = lower.indexOf(query);
    while (i !== -1) {
      if (i > last) nodes.push(value.slice(last, i));
      nodes.push(
        <mark
          key={key++}
          className="rounded bg-primary/25 px-0.5 text-foreground"
        >
          {value.slice(i, i + query.length)}
        </mark>
      );
      last = i + query.length;
      i = lower.indexOf(query, last);
    }
    if (last < value.length) nodes.push(value.slice(last));
    return nodes;
  };

  // A short transcript snippet around the first match, built DB-side.
  const getSnippet = (doc: Conversation): string | null =>
    conversations.searchSnippets.get(doc.id) ?? null;

  // First bit of the conversation, used as a preview in card view.
  const getPreview = (doc: Conversation): string | null => doc.preview;

  // Click selects while in selection mode, otherwise opens the conversation.
  const openConversation = (doc: Conversation) => {
    if (selectionActive) toggleSelect(doc.id);
    else navigate(`/chats/view/${doc.id}`);
  };

  // Selection checkbox shown on hover (and always once selecting), shared by
  // both layouts.
  const renderCheckbox = (doc: Conversation, isSel: boolean) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggleSelect(doc.id);
      }}
      title={isSel ? "Deselect" : "Select"}
      aria-label={isSel ? "Deselect conversation" : "Select conversation"}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        isSel
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40 opacity-0 group-hover:opacity-100 focus:opacity-100"
      )}
    >
      {isSel && <CheckIcon className="size-3" />}
    </button>
  );

  // Overall score from a cached scorecard (interviews only — a meeting summary
  // isn't graded). Colour matches the dial on the scorecard itself.
  const renderScoreBadge = (doc: Conversation) => {
    const card = scorecards[doc.id]?.scorecard;
    if (!card || card.kind !== "interview") return null;
    const tone = scoreTone(card.overallScore);
    return (
      <Badge
        variant="outline"
        className={cn("text-xs", tone.text)}
        title={`Interview scorecard: ${card.overallScore}/5 · ${tone.word}`}
      >
        {card.overallScore}/5
      </Badge>
    );
  };

  const renderConversation = (doc: Conversation) => {
    const snippet = getSnippet(doc);
    const isSel = selected.has(doc.id);

    if (viewMode === "cards") {
      const preview = snippet || getPreview(doc);
      return (
        <Card
          key={doc.id}
          className={cn(
            "group relative flex h-full cursor-pointer select-none gap-3 p-4 shadow-none transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50",
            isSel && "!border-primary ring-1 ring-primary/40"
          )}
          onClick={() => openConversation(doc)}
        >
          {/* Selection lives in a dedicated left column so the title, preview,
              and badges all stay flush-left (balanced) regardless of hover. */}
          <div className="pt-0.5">{renderCheckbox(doc, isSel)}</div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="line-clamp-2 text-base font-medium">
              {highlight(doc.title)}
            </p>
            {preview && (
              <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">
                {highlight(preview)}
              </p>
            )}
            <div className="mt-3 flex items-center gap-1">
              {renderScoreBadge(doc)}
              <Badge variant="outline" className="text-xs">
                {doc.messageCount} messages
              </Badge>
              <Badge variant="outline" className="text-xs">
                {moment(doc.updatedAt).format("hh:mm A")}
              </Badge>
            </div>
          </div>
        </Card>
      );
    }

    // List (compact rows)
    return (
      <Card
        key={doc.id}
        className={cn(
          "group relative cursor-pointer select-none gap-0 px-3 py-2.5 shadow-none transition-all !bg-black/5 dark:!bg-white/5 hover:!border-primary/50",
          isSel && "!border-primary ring-1 ring-primary/40"
        )}
        onClick={() => openConversation(doc)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="mr-4 flex min-w-0 items-center gap-2">
            {renderCheckbox(doc, isSel)}
            <p className="line-clamp-1 text-base">{highlight(doc.title)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {renderScoreBadge(doc)}
            <Badge variant="outline" className="text-xs">
              {doc.messageCount} messages
            </Badge>
            <Badge variant="outline" className="text-xs">
              {moment(doc.updatedAt).format("hh:mm A")}
            </Badge>
          </div>
        </div>
        {snippet && (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {highlight(snippet)}
          </p>
        )}
      </Card>
    );
  };

  return (
    <PageLayout
      title="Recaps"
      description="Every conversation, reviewed: scores and feedback for interviews, key points for meetings"
    >
      <>
        {conversations.conversations.length === 0 ? (
          <Empty
            isLoading={conversations.isLoading}
            icon={MessageCircleIcon}
            title="No conversations found"
            description="Start a new conversation to get started"
          />
        ) : (
          <div className="flex flex-col gap-6 pb-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="relative w-1/3">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search conversations..."
                  className="pl-9 pr-9 focus-visible:ring-0 focus-visible:ring-offset-0"
                  value={conversations.search}
                  onChange={(e) => conversations.setSearch(e.target.value)}
                />
                {conversations.search ? (
                  <button
                    type="button"
                    onClick={() => conversations.setSearch("")}
                    aria-label="Clear search"
                    title="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-4" />
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {/* Date range filter */}
                <DateRangePicker value={range} onChange={setRange} />

                {/* List / Cards view toggle */}
                <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5">
                  <button
                    onClick={() => changeViewMode("list")}
                  title="List view"
                  aria-pressed={viewMode === "list"}
                  className={cn(
                    "flex items-center justify-center rounded-md px-2.5 py-1.5 transition-colors",
                    viewMode === "list"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ListIcon className="size-4" />
                </button>
                <button
                  onClick={() => changeViewMode("cards")}
                  title="Card view"
                  aria-pressed={viewMode === "cards"}
                  className={cn(
                    "flex items-center justify-center rounded-md px-2.5 py-1.5 transition-colors",
                    viewMode === "cards"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutGridIcon className="size-4" />
                </button>
                </div>
              </div>
            </div>

            {/* Multi-select toolbar → delete selected conversations */}
            {selectionActive && (
              <div className="sticky top-0 z-10 -mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 backdrop-blur">
                <span className="text-base font-medium">
                  {selected.size} selected
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set(filtered.map((d) => d.id)))}
                  className="gap-1.5"
                >
                  <CheckIcon className="size-3.5" />
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                  disabled={deleting}
                  className="ml-auto gap-1.5"
                >
                  {deleting ? (
                    <LoaderIcon className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3.5" />
                  )}
                  Delete {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  className="gap-1.5"
                >
                  <XIcon className="size-3.5" />
                  Clear
                </Button>
              </div>
            )}
            {(query || dateFilterActive) && filtered.length === 0 ? (
              <Empty
                isLoading={false}
                icon={Search}
                title="No matching conversations"
                description={
                  dateFilterActive && !query
                    ? "No conversations in this date range."
                    : "Try a different search term or date range."
                }
              />
            ) : (
              <>
                {visibleDates.map(({ dateKey, docs }) => (
                <div key={dateKey} className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground select-none font-medium">
                    {moment(dateKey).format("ddd, MMM D")}
                  </p>
                  <div
                    className={cn(
                      viewMode === "cards"
                        ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                        : "flex flex-col gap-2"
                    )}
                  >
                    {docs.map(renderConversation)}
                  </div>
                </div>
                ))}

                {/* Infinite-scroll sentinel + loading indicator */}
                {hasMore && (
                  <div
                    ref={sentinelRef}
                    className="flex items-center justify-center py-4 text-sm text-muted-foreground"
                  >
                    <LoaderIcon className="mr-2 size-3.5 animate-spin" />
                    Loading more…
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open && !deleting) setConfirmOpen(false);
          }}
          title={`Delete ${selected.size} conversation${
            selected.size === 1 ? "" : "s"
          }?`}
          description="This permanently removes the selected conversations and their transcripts. This can't be undone."
          confirmLabel={`Delete ${selected.size}`}
          onConfirm={deleteSelected}
        />
      </>
    </PageLayout>
  );
};

export default Dashboard;
