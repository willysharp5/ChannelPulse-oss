import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Input,
  DateRangePicker,
  type DateRangeValue,
} from "@/components";
import {
  deleteInterviewResult,
  deleteInterviewResults,
  listInterviewResults,
  type SavedInterviewResult,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import moment from "moment";
import {
  ClipboardList,
  Eye,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
} from "lucide-react";

const PAGE_SIZE = 9;

interface ResultsScreenProps {
  onView: (result: SavedInterviewResult) => void;
}

export function ResultsScreen({ onView }: ResultsScreenProps) {
  const [results, setResults] = useState<SavedInterviewResult[]>([]);
  const [pendingDelete, setPendingDelete] =
    useState<SavedInterviewResult | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRangeValue>({ from: null, to: null });
  const [page, setPage] = useState(1);
  // Multi-select delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const refresh = useCallback(() => {
    setResults(listInterviewResults());
  }, []);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fromTs = range.from ? range.from.getTime() : null;
  // Include the whole "to" day (end of day).
  const toTs = range.to ? range.to.getTime() + 24 * 60 * 60 * 1000 - 1 : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results.filter((r) => {
      if (fromTs != null && r.createdAt < fromTs) return false;
      if (toTs != null && r.createdAt > toTs) return false;
      if (!q) return true;
      const haystack = [
        r.templateTitle,
        r.assessment.overallSummary,
        ...r.turns.map((t) => `${t.question} ${t.answer}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [results, query, fromTs, toTs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const allFilteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const selectAll = () =>
    setSelected(new Set(allSelected ? [] : allFilteredIds));
  const deleteSelected = () => {
    deleteInterviewResults([...selected]);
    clearSelection();
    setBulkConfirm(false);
    refresh();
  };

  const renderCheckbox = (id: string) => (
    <button
      type="button"
      onClick={() => toggleSelect(id)}
      aria-label={selected.has(id) ? "Deselect" : "Select"}
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        selected.has(id)
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent hover:border-primary/60"
      )}
    >
      <Check className="size-3" />
    </button>
  );

  const renderPagination = () =>
    filtered.length > 0 && totalPages > 1 ? (
      <div className="flex items-center justify-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={safePage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              size="sm"
              variant={n === safePage ? "default" : "ghost"}
              className="h-8 w-8 p-0 tabular-nums"
              onClick={() => setPage(n)}
            >
              {n}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={safePage >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    ) : null;

  // Reset to page 1 when the filters change.
  useEffect(() => {
    setPage(1);
  }, [query, fromTs, toTs]);

  if (results.length === 0) {
    return (
      <Empty
        icon={ClipboardList}
        title="No saved results yet"
        description="Finish a practice session and its assessment will be saved here so you can review it anytime."
      />
    );
  }

  const scoreVariant = (score: number) =>
    score >= 4 ? "default" : score >= 3 ? "secondary" : "destructive";

  return (
    <div className="space-y-3">
      {/* Filters: search + date range */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search results…"
            className="h-9 pl-8 pr-8 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <DateRangePicker value={range} onChange={setRange} className="h-9" />
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length === results.length
          ? "Your completed practice sessions and their assessments."
          : `${filtered.length} of ${results.length} result${
              results.length === 1 ? "" : "s"
            }`}
      </p>

      {selected.size > 0 ? (
        <div className="sticky top-11 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-3 py-2 backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={selectAll}>
            <Check className="h-4 w-4" />
            {allSelected ? "Deselect all" : "Select all"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="h-4 w-4" />
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setBulkConfirm(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete {selected.size}
            </Button>
          </div>
        </div>
      ) : null}

      {renderPagination()}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border/50 px-3 py-10 text-center text-sm text-muted-foreground">
          No results match your search or date range.
        </p>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pageItems.map((r) => (
          <Card
            key={r.id}
            className={cn(
              "group gap-3 p-4 transition-shadow !bg-muted/40 border-border/60 hover:shadow-sm",
              selected.has(r.id) && "ring-2 ring-primary"
            )}
          >
            <div className="flex items-start gap-2">
              {renderCheckbox(r.id)}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" title={r.templateTitle}>
                  {r.templateTitle}
                </p>
                <p className="text-xs text-muted-foreground">
                  {moment(r.createdAt).format("MMM D, YYYY · h:mm A")}
                </p>
              </div>
              <Badge
                variant={scoreVariant(r.assessment.overallScore)}
                className="shrink-0 tabular-nums"
              >
                {r.assessment.overallScore}/5
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="tabular-nums">
                {r.turns.length} question{r.turns.length === 1 ? "" : "s"}
              </Badge>
            </div>

            <p className="line-clamp-2 text-xs text-muted-foreground">
              {r.assessment.overallSummary}
            </p>

            <div className="mt-auto flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onView(r)}
              >
                <Eye className="h-4 w-4" />
                View results
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="text-destructive hover:text-destructive"
                title="Delete result"
                onClick={() => setPendingDelete(r)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
      )}

      {renderPagination()}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete result"
        description={
          pendingDelete
            ? `Delete the saved result for “${pendingDelete.templateTitle}”? This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteInterviewResult(pendingDelete.id);
          refresh();
        }}
      />

      <ConfirmDialog
        open={bulkConfirm}
        onOpenChange={(open) => {
          if (!open) setBulkConfirm(false);
        }}
        title="Delete results"
        description={`Delete ${selected.size} saved result${
          selected.size === 1 ? "" : "s"
        }? This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={deleteSelected}
      />
    </div>
  );
}
