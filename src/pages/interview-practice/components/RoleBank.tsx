import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, Input } from "@/components";
import { QuestionCard } from "./QuestionCard";
import {
  CATEGORY_LABELS,
  buildBankPracticeTemplate,
  getRoleCounts,
  listQuestionsByRole,
  MAX_BANK_PRACTICE,
  buildPracticedQuestionIndex,
  getPracticedQuestionInfo,
  type BankQuestion,
  type InterviewTemplate,
  type QuestionCategory,
  type QuestionDifficulty,
  type RoleCounts,
} from "@/lib/interview";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Search,
  UserRound,
  X,
} from "lucide-react";

const QUESTIONS_PAGE_SIZE = 15;
const CATS: (QuestionCategory | "all")[] = [
  "all",
  "technical",
  "behavioral",
  "coding",
  "system_design",
  "product",
];
const DIFFS: (QuestionDifficulty | "all")[] = ["all", "easy", "medium", "hard"];

interface RoleBankProps {
  onStart: (template: InterviewTemplate) => void;
}

export function RoleBank({ onStart }: RoleBankProps) {
  const [counts, setCounts] = useState<Record<string, RoleCounts>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [roleQuery, setRoleQuery] = useState("");
  const [catFilter, setCatFilter] = useState<QuestionCategory | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const c = await getRoleCounts();
      if (cancelled) return;
      setCounts(c);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const roles = useMemo(
    () =>
      Object.entries(counts).sort((a, b) => b[1].total - a[1].total),
    [counts]
  );

  if (selected) {
    return (
      <RoleDetail
        role={selected}
        onBack={() => setSelected(null)}
        onStart={onStart}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading roles…
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <Empty
        icon={UserRound}
        title="No role-tagged questions yet"
        description="An admin can generate role-specific questions from Admin → Interview question research."
      />
    );
  }

  const rq = roleQuery.trim().toLowerCase();
  const filteredRoles = roles.filter(
    ([role, rc]) =>
      (!rq || role.toLowerCase().includes(rq)) &&
      (catFilter === "all" || (rc.byCategory[catFilter] ?? 0) > 0)
  );

  return (
    <div className="space-y-4">
      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={roleQuery}
            onChange={(e) => setRoleQuery(e.target.value)}
            placeholder="Search roles…"
            className="h-9 pl-8 pr-8 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {roleQuery ? (
            <button
              type="button"
              onClick={() => setRoleQuery("")}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                catFilter === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {c === "all" ? "All" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {filteredRoles.length === 0 ? (
        <Empty
          icon={UserRound}
          title="No roles match"
          description="Try a different search or category filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRoles.map(([role, rc]) => (
            <Card
              key={role}
          role="button"
          tabIndex={0}
          onClick={() => setSelected(role)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setSelected(role);
          }}
          className="cursor-pointer gap-2 p-5 transition-shadow !bg-muted/40 border-border/60 hover:border-primary/40 hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold" title={role}>
                  {role}
                </p>
                <p className="text-xs text-muted-foreground">
                  {rc.companies} compan{rc.companies === 1 ? "y" : "ies"}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {rc.total}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(CATEGORY_LABELS) as QuestionCategory[]).map((cat) =>
              rc.byCategory[cat] ? (
                <Badge key={cat} variant="outline" className="text-xs">
                  {CATEGORY_LABELS[cat]} {rc.byCategory[cat]}
                </Badge>
              ) : null
            )}
          </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleDetail({
  role,
  onBack,
  onStart,
}: {
  role: string;
  onBack: () => void;
  onStart: (template: InterviewTemplate) => void;
}) {
  const [all, setAll] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<QuestionCategory | "all">("all");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "all">(
    "all"
  );
  const [companyId, setCompanyId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [practicedIndex, setPracticedIndex] = useState(() =>
    buildPracticedQuestionIndex()
  );

  useEffect(() => {
    setPracticedIndex(buildPracticedQuestionIndex());
  }, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = await listQuestionsByRole(role);
    setAll(qs);
    setLoading(false);
  }, [role]);

  useEffect(() => {
    load();
  }, [load]);

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of all)
      if (q.company_id) map.set(q.company_id, q.company_name || "Company");
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const questions = useMemo(() => {
    const text = query.trim().toLowerCase();
    return all.filter(
      (q) =>
        (category === "all" || q.category === category) &&
        (difficulty === "all" || q.difficulty === difficulty) &&
        (companyId === "all" || q.company_id === companyId) &&
        (!text || q.question.toLowerCase().includes(text))
    );
  }, [all, category, difficulty, companyId, query]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [category, difficulty, companyId, query]);

  const totalPages = Math.max(1, Math.ceil(questions.length / QUESTIONS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageQuestions = questions.slice(
    (safePage - 1) * QUESTIONS_PAGE_SIZE,
    safePage * QUESTIONS_PAGE_SIZE
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedQuestions = useMemo(
    () => questions.filter((q) => selectedIds.has(q.id)),
    [questions, selectedIds]
  );
  const selectedCount = selectedQuestions.length;
  const unpracticedQuestions = useMemo(
    () =>
      questions.filter((q) => !getPracticedQuestionInfo(q, practicedIndex)),
    [questions, practicedIndex]
  );
  const practicedCount = questions.length - unpracticedQuestions.length;
  const nextSlice = useMemo(
    () => unpracticedQuestions.slice(0, MAX_BANK_PRACTICE),
    [unpracticedQuestions]
  );
  const selectableSlice = useMemo(
    () => questions.slice(0, MAX_BANK_PRACTICE),
    [questions]
  );
  const selectableCount = selectableSlice.length;
  const allSelected =
    selectableCount > 0 &&
    selectableSlice.every((q) => selectedIds.has(q.id)) &&
    selectedCount === selectableCount;
  const nextSelected =
    nextSlice.length > 0 &&
    nextSlice.every((q) => selectedIds.has(q.id)) &&
    selectedCount === nextSlice.length;

  const toggleSelected = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (next) {
        if (copy.size >= MAX_BANK_PRACTICE && !copy.has(id)) return prev;
        copy.add(id);
      } else {
        copy.delete(id);
      }
      return copy;
    });
  };

  const selectAllForPractice = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableSlice.map((q) => q.id)));
  };

  const selectNextUnpracticed = () => {
    if (nextSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(nextSlice.map((q) => q.id)));
  };

  const startPractice = (qs: BankQuestion[]) => {
    const companyName =
      companyId !== "all"
        ? companyOptions.find(([id]) => id === companyId)?.[1]
        : undefined;
    const template = buildBankPracticeTemplate({
      id: `role-${Date.now().toString(36)}`,
      title: `${role}${companyName ? ` @ ${companyName}` : ""}${
        category !== "all" ? ` · ${CATEGORY_LABELS[category]}` : ""
      }`,
      roleLevel: role,
      questions: qs,
      notes: `Practice for the ${role} role from the question bank.`,
    });
    if (template) onStart(template);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-semibold">{role}</h2>
          <Badge variant="secondary" className="tabular-nums">
            {questions.length}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={nextSlice.length === 0}
            onClick={selectNextUnpracticed}
            title="Select the next unfinished questions for practice"
          >
            {nextSelected
              ? "Deselect next"
              : nextSlice.length > 0
                ? `Select next (${nextSlice.length})`
                : "All done"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={selectableCount === 0}
            onClick={selectAllForPractice}
            title={
              questions.length > MAX_BANK_PRACTICE
                ? `Sessions include up to ${MAX_BANK_PRACTICE} questions`
                : undefined
            }
          >
            {allSelected
              ? "Deselect all"
              : questions.length > MAX_BANK_PRACTICE
                ? `Select all (${MAX_BANK_PRACTICE})`
                : "Select all"}
          </Button>
          {selectedCount > 0 && !allSelected && !nextSelected ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear ({selectedCount})
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={nextSlice.length === 0}
            onClick={() => startPractice(nextSlice)}
            title="Start practicing the next unfinished questions"
          >
            <Play className="h-3.5 w-3.5" />
            Practice next
            {nextSlice.length > 0 ? ` (${nextSlice.length})` : ""}
          </Button>
          <Button
            onClick={() => startPractice(selectedQuestions)}
            disabled={selectedCount === 0}
          >
            <Play className="h-4 w-4" />
            Practice selected ({selectedCount})
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {practicedCount > 0 ? (
          <>
            <span className="font-medium text-foreground">
              {practicedCount} done
            </span>
            {" · "}
            {unpracticedQuestions.length} remaining
            {" · "}
          </>
        ) : null}
        Questions you’ve assessed show a Done badge. Use Select next / Practice
        next for the unfinished set (up to {MAX_BANK_PRACTICE} per session).
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions…"
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
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                category === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {c === "all" ? "All" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {DIFFS.map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
                difficulty === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Company filter */}
      {companyOptions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Company:</span>
          {[["all", "All companies"] as [string, string], ...companyOptions].map(
            ([id, name]) => (
              <button
                key={id}
                onClick={() => setCompanyId(id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  companyId === id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {name}
              </button>
            )
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading questions…
        </div>
      ) : questions.length === 0 ? (
        <Empty
          icon={UserRound}
          title="No questions match"
          description="Try clearing the filters."
        />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {questions.length} question{questions.length === 1 ? "" : "s"}
            </span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  Prev
                </Button>
                <span className="tabular-nums">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
          {pageQuestions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              open={expanded.has(q.id)}
              onToggle={() => toggle(q.id)}
              showCompany
              selectable
              selected={selectedIds.has(q.id)}
              onSelectedChange={(next) => toggleSelected(q.id, next)}
              onPractice={() => startPractice([q])}
              practiced={getPracticedQuestionInfo(q, practicedIndex)}
              query={query}
            />
          ))}
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 pt-1 text-xs text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <span className="tabular-nums">
                Page {safePage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
