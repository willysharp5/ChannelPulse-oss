import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, Input } from "@/components";
import { QuestionCard } from "./QuestionCard";
import { QuestionFilterBar } from "./QuestionFilterBar";
import {
  CATEGORY_LABELS,
  buildBankPracticeTemplate,
  industryLabel,
  listBankCompanies,
  listBankQuestions,
  listCompanyRoles,
  listQuestionFacets,
  getQuestionCounts,
  MAX_BANK_PRACTICE,
  buildPracticedQuestionIndex,
  getPracticedQuestionInfo,
  queryQuestions,
  type BankCompany,
  type BankQuestion,
  type CompanyCounts,
  type InterviewTemplate,
  type QuestionCategory,
  type QuestionDifficulty,
  type QuestionFilters,
} from "@/lib/interview";
import { cn } from "@/lib/utils";

const INDUSTRY_ORDER = [
  "big_tech",
  "ai",
  "fintech",
  "consumer",
  "data_infra",
  "saas",
  "high_growth",
  "other",
];
import {
  Building2,
  Search,
  ArrowLeft,
  Play,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  Check,
} from "lucide-react";

const QUESTIONS_PAGE_SIZE = 15;
const BROWSE_PAGE_SIZE = 20;
const COMPANIES_PAGE_SIZE = 12;

function PagerBar({
  label,
  page,
  totalPages,
  onPage,
}: {
  label: string;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          <ChevronLeft className="size-3.5" />
          Prev
        </Button>
        <span className="tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={page >= totalPages}
          onClick={() => onPage(Math.min(totalPages, page + 1))}
        >
          Next
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

const CATS: (QuestionCategory | "all")[] = [
  "all",
  "technical",
  "behavioral",
  "coding",
  "system_design",
];
const DIFFS: (QuestionDifficulty | "all")[] = ["all", "easy", "medium", "hard"];

interface CompanyBankProps {
  /** Start a practice session against the given questions. */
  onStart: (template: InterviewTemplate) => void;
}

function CompanyGridCard({
  c,
  counts,
  onOpen,
  selected,
  onToggleSelect,
}: {
  c: BankCompany;
  counts: Record<string, CompanyCounts>;
  onOpen: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const n = counts[c.id]?.total ?? 0;
  const disabled = n === 0;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => !disabled && onOpen()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) onOpen();
      }}
      className={cn(
        "gap-2 p-4 transition-shadow !bg-muted/40 border-border/60",
        disabled
          ? "opacity-60"
          : "cursor-pointer hover:border-primary/40 hover:shadow-sm",
        selected && "border-primary ring-1 ring-primary/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!disabled ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              aria-label={selected ? "Deselect company" : "Select company"}
              title={selected ? "Deselect" : "Select for a mixed session"}
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 hover:border-primary/60"
              )}
            >
              {selected ? <Check className="size-3" /> : null}
            </button>
          ) : null}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold" title={c.name}>
              {c.name}
            </p>
            <p className="text-xs text-muted-foreground">{industryLabel(c.category)}</p>
          </div>
        </div>
        <Badge
          variant={disabled ? "outline" : "secondary"}
          className="shrink-0 tabular-nums"
        >
          {n}
        </Badge>
      </div>
      {n > 0 ? (
        <div className="flex flex-wrap gap-1">
          {(Object.keys(CATEGORY_LABELS) as QuestionCategory[]).map((cat) =>
            counts[c.id]?.byCategory[cat] ? (
              <Badge key={cat} variant="outline" className="text-xs">
                {CATEGORY_LABELS[cat]} {counts[c.id]!.byCategory[cat]}
              </Badge>
            ) : null
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Questions coming soon.</p>
      )}
    </Card>
  );
}

export function CompanyBank({ onStart }: CompanyBankProps) {
  const [companies, setCompanies] = useState<BankCompany[]>([]);
  const [counts, setCounts] = useState<Record<string, CompanyCounts>>({});
  const [loading, setLoading] = useState(true);
  const [companySearch, setCompanySearch] = useState("");
  const [industry, setIndustry] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<BankCompany | null>(null);
  const [filters, setFilters] = useState<QuestionFilters>({});
  const [facets, setFacets] = useState<{ roles: string[]; stages: string[] }>({
    roles: [],
    stages: [],
  });
  const [browse, setBrowse] = useState<{ rows: BankQuestion[]; total: number }>({
    rows: [],
    total: 0,
  });
  const [browsePage, setBrowsePage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [qExpanded, setQExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [cos, cnts] = await Promise.all([
        listBankCompanies(),
        getQuestionCounts(),
      ]);
      if (cancelled) return;
      setCompanies(cos);
      setCounts(cnts);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter dropdown options (roles, rounds) across the whole bank.
  useEffect(() => {
    listQuestionFacets().then(setFacets);
  }, []);

  const anyFilter =
    !!filters.companyId ||
    (filters.companyIds?.length ?? 0) > 0 ||
    !!filters.role ||
    !!filters.category ||
    (filters.categories?.length ?? 0) > 0 ||
    !!filters.difficulty ||
    (filters.difficulties?.length ?? 0) > 0 ||
    !!filters.stage ||
    !!filters.seniority;
  const hasQuery = companySearch.trim().length >= 2;
  const browsing = hasQuery || anyFilter;

  // Reset to page 1 whenever the query or filters change.
  useEffect(() => {
    setBrowsePage(1);
  }, [companySearch, filters]);

  // Unified question browse: text query + structured filters, paginated.
  useEffect(() => {
    if (!browsing) {
      setBrowse({ rows: [], total: 0 });
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await queryQuestions(
        { ...filters, query: hasQuery ? companySearch.trim() : undefined },
        { limit: BROWSE_PAGE_SIZE, offset: (browsePage - 1) * BROWSE_PAGE_SIZE }
      );
      setBrowse(res);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySearch, filters, browsePage]);

  // Industries present, ordered.
  const industries = useMemo(() => {
    const set = new Set(companies.map((c) => c.category));
    return INDUSTRY_ORDER.filter((i) => set.has(i)).concat(
      [...set].filter((i) => !INDUSTRY_ORDER.includes(i))
    );
  }, [companies]);

  const visibleCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    return companies
      .filter(
        (c) =>
          (industry === "all" || c.category === industry) &&
          (q ? c.name.toLowerCase().includes(q) : true)
      )
      .sort((a, b) => {
        const ca = counts[a.id]?.total ?? 0;
        const cb = counts[b.id]?.total ?? 0;
        if ((ca > 0) !== (cb > 0)) return cb - ca > 0 ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [companies, companySearch, industry, counts]);

  const totalPages = Math.max(
    1,
    Math.ceil(visibleCompanies.length / COMPANIES_PAGE_SIZE)
  );
  const safePage = Math.min(page, totalPages);
  const pageCompanies = useMemo(() => {
    const start = (safePage - 1) * COMPANIES_PAGE_SIZE;
    return visibleCompanies.slice(start, start + COMPANIES_PAGE_SIZE);
  }, [visibleCompanies, safePage]);

  // Group the current page by industry for section headers.
  const grouped = useMemo(() => {
    const map = new Map<string, BankCompany[]>();
    for (const c of pageCompanies) {
      const arr = map.get(c.category) ?? [];
      arr.push(c);
      map.set(c.category, arr);
    }
    const order = industries.filter((i) => map.has(i));
    return order.map((i) => [i, map.get(i)!] as [string, BankCompany[]]);
  }, [pageCompanies, industries]);

  useEffect(() => {
    setPage(1);
  }, [companySearch, industry]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const companyRangeLabel =
    visibleCompanies.length === 0
      ? "No companies"
      : `Showing ${(safePage - 1) * COMPANIES_PAGE_SIZE + 1}–${Math.min(
          safePage * COMPANIES_PAGE_SIZE,
          visibleCompanies.length
        )} of ${visibleCompanies.length}`;

  const toggleQ = (id: string) =>
    setQExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const companyById = (id: string) => companies.find((c) => c.id === id) ?? null;

  // Multi-select companies → one "mixed" practice session across all of them.
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(
    new Set()
  );
  const [buildingMixed, setBuildingMixed] = useState(false);
  const toggleCompany = (id: string) =>
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearCompanies = () => setSelectedCompanies(new Set());

  const startMixedPractice = async () => {
    const ids = [...selectedCompanies];
    if (ids.length === 0) return;
    setBuildingMixed(true);
    try {
      // Pull each company's questions, then interleave so a mixed session
      // rotates across companies rather than front-loading one.
      const perCompany = await Promise.all(
        ids.map((id) => listBankQuestions(id, {}))
      );
      const merged: BankQuestion[] = [];
      for (let i = 0; merged.length < MAX_BANK_PRACTICE; i++) {
        let addedAny = false;
        for (const list of perCompany) {
          if (list[i]) {
            merged.push(list[i]);
            addedAny = true;
            if (merged.length >= MAX_BANK_PRACTICE) break;
          }
        }
        if (!addedAny) break;
      }
      if (merged.length === 0) return;
      const names = ids
        .map((id) => companyById(id)?.name)
        .filter((n): n is string => !!n);
      const shortTitle =
        names.length <= 2
          ? names.join(" & ")
          : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      const template = buildBankPracticeTemplate({
        id: `bank-mixed-${Date.now().toString(36)}`,
        title: `Mixed: ${shortTitle}`,
        roleLevel: "Software Engineer",
        questions: merged,
        notes: `Mixed practice from ${names.join(", ")}.`,
      });
      if (template) onStart(template);
    } finally {
      setBuildingMixed(false);
    }
  };

  // Practice the currently filtered/searched question set (multi-select filters).
  const [buildingFiltered, setBuildingFiltered] = useState(false);
  const startFilteredPractice = async () => {
    setBuildingFiltered(true);
    try {
      const res = await queryQuestions(
        { ...filters, query: hasQuery ? companySearch.trim() : undefined },
        { limit: MAX_BANK_PRACTICE, offset: 0 }
      );
      if (res.rows.length === 0) return;
      const template = buildBankPracticeTemplate({
        id: `bank-filtered-${Date.now().toString(36)}`,
        title: "Filtered practice",
        roleLevel: "Software Engineer",
        questions: res.rows,
        notes: "Practice from your filtered question set.",
      });
      if (template) onStart(template);
    } finally {
      setBuildingFiltered(false);
    }
  };

  if (selected) {
    return (
      <CompanyDetail
        company={selected}
        onBack={() => setSelected(null)}
        onStart={onStart}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading companies…
      </div>
    );
  }

  const browseTotalPages = Math.max(
    1,
    Math.ceil(browse.total / BROWSE_PAGE_SIZE)
  );
  const browseRangeLabel =
    browse.total === 0
      ? "No questions"
      : `Showing ${(browsePage - 1) * BROWSE_PAGE_SIZE + 1}–${Math.min(
          browsePage * BROWSE_PAGE_SIZE,
          browse.total
        )} of ${browse.total}`;

  return (
    <div className="space-y-4">
      <div className="relative w-full md:w-2/3 lg:w-1/2">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={companySearch}
          onChange={(e) => setCompanySearch(e.target.value)}
          placeholder="Search companies or questions (topics, skills, keywords)…"
          className="pl-9 pr-9 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {companySearch ? (
          <button
            type="button"
            onClick={() => setCompanySearch("")}
            aria-label="Clear search"
            title="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Industry filter */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">Industry:</span>
        {["all", ...industries].map((i) => (
          <button
            key={i}
            onClick={() => setIndustry(i)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              industry === i
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 text-muted-foreground hover:bg-muted/60"
            )}
          >
            {i === "all" ? "All industries" : industryLabel(i)}
          </button>
        ))}
      </div>

      {/* Dropdown filter toolbar (Company · Role · Category · Difficulty · Round · Seniority) */}
      <QuestionFilterBar
        companies={companies}
        facets={facets}
        value={filters}
        onChange={setFilters}
      />

      {browsing ? (
        /* Filtered / searched questions across the whole bank */
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Questions
              {searching ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <span className="font-normal text-muted-foreground">
                  {browse.total}
                </span>
              )}
            </h3>
            {browse.total > 0 ? (
              <Button
                size="sm"
                className="ml-auto gap-1.5"
                onClick={startFilteredPractice}
                disabled={buildingFiltered}
                title="Practice this filtered set"
              >
                {buildingFiltered ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Practice these ({Math.min(browse.total, MAX_BANK_PRACTICE)})
              </Button>
            ) : null}
          </div>
          {browse.rows.length === 0 && !searching ? (
            <p className="text-xs text-muted-foreground">
              No questions match. Try different keywords or filters.
            </p>
          ) : (
            <div className="space-y-2">
              {browse.rows.map((q) => {
                const co = companyById(q.company_id);
                return (
                  <div key={q.id} className="space-y-1">
                    <QuestionCard
                      q={q}
                      open={qExpanded.has(q.id)}
                      onToggle={() => toggleQ(q.id)}
                      showCompany
                      query={companySearch}
                    />
                    {co ? (
                      <button
                        onClick={() => setSelected(co)}
                        className="ml-1 text-xs text-primary hover:underline"
                      >
                        Open {co.name} →
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {browseTotalPages > 1 ? (
                <PagerBar
                  label={browseRangeLabel}
                  page={browsePage}
                  totalPages={browseTotalPages}
                  onPage={setBrowsePage}
                />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <>
          {selectedCompanies.size > 0 ? (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 backdrop-blur">
              <span className="text-sm">
                <strong className="tabular-nums">
                  {selectedCompanies.size}
                </strong>{" "}
                {selectedCompanies.size === 1 ? "company" : "companies"} selected
              </span>
              <span className="text-xs text-muted-foreground">
                · up to {MAX_BANK_PRACTICE} questions, mixed across them
              </span>
              <Button
                size="sm"
                className="ml-auto gap-1.5"
                onClick={startMixedPractice}
                disabled={buildingMixed}
              >
                {buildingMixed ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Practice mixed
              </Button>
              <Button size="sm" variant="ghost" onClick={clearCompanies}>
                Clear
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Browse real-world interview questions by industry and company, then
            practice against them. Tick the checkbox on multiple companies to
            practice a mixed session. Hundreds of companies have questions.
          </p>

          {/* Companies grouped by industry (paged) */}
          {visibleCompanies.length === 0 ? (
            <Empty
              icon={Building2}
              title="No companies match"
              description="Try a different search or industry."
            />
          ) : (
            <div className="space-y-3">
              <PagerBar
                label={companyRangeLabel}
                page={safePage}
                totalPages={totalPages}
                onPage={setPage}
              />
              {grouped.map(([ind, list]) => (
                <div key={ind} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    {industryLabel(ind)}
                    <span className="font-normal text-muted-foreground">
                      {list.length}
                    </span>
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((c) => (
                      <CompanyGridCard
                        key={c.id}
                        c={c}
                        counts={counts}
                        onOpen={() => setSelected(c)}
                        selected={selectedCompanies.has(c.id)}
                        onToggleSelect={() => toggleCompany(c.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <PagerBar
                label={companyRangeLabel}
                page={safePage}
                totalPages={totalPages}
                onPage={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CompanyDetail({
  company,
  onBack,
  onStart,
}: {
  company: BankCompany;
  onBack: () => void;
  onStart: (template: InterviewTemplate) => void;
}) {
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<QuestionCategory | "all">("all");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "all">(
    "all"
  );
  const [role, setRole] = useState<string>("all");
  const [roles, setRoles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  // Rebuild when this detail view mounts (e.g. after finishing a session).
  const [practicedIndex, setPracticedIndex] = useState(() =>
    buildPracticedQuestionIndex()
  );

  useEffect(() => {
    setPracticedIndex(buildPracticedQuestionIndex());
  }, [company.id]);

  useEffect(() => {
    listCompanyRoles(company.id).then(setRoles);
  }, [company.id]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = await listBankQuestions(company.id, {
      category,
      difficulty,
      role,
      query,
    });
    setQuestions(qs);
    setPage(1);
    setLoading(false);
  }, [company.id, category, difficulty, role, query]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(questions.length / QUESTIONS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageQuestions = questions.slice(
    (safePage - 1) * QUESTIONS_PAGE_SIZE,
    safePage * QUESTIONS_PAGE_SIZE
  );
  const questionsRangeLabel =
    questions.length === 0
      ? "No questions"
      : `Showing ${(safePage - 1) * QUESTIONS_PAGE_SIZE + 1}–${Math.min(
          safePage * QUESTIONS_PAGE_SIZE,
          questions.length
        )} of ${questions.length}`;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Drop selections that no longer match the filtered list; clear on filter change.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [category, difficulty, role, query]);

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
    const template = buildBankPracticeTemplate({
      id: `bank-${company.slug}-${Date.now().toString(36)}`,
      title: `${company.name}${
        category !== "all" ? ` · ${CATEGORY_LABELS[category]}` : ""
      }`,
      roleLevel: "Software Engineer",
      questions: qs,
      notes: `Practice from the ${company.name} question bank.`,
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
          <h2 className="text-base font-semibold">{company.name}</h2>
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

      {/* Role filter (grouped by role) */}
      {roles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Role:</span>
          {["all", "general", ...roles].map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                role === r
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {r === "all" ? "All roles" : r === "general" ? "General" : r}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading questions…
        </div>
      ) : questions.length === 0 ? (
        <Empty
          icon={Building2}
          title="No questions match"
          description="Try clearing the filters."
        />
      ) : (
        <div className="space-y-2">
          <PagerBar
            label={questionsRangeLabel}
            page={safePage}
            totalPages={totalPages}
            onPage={setPage}
          />
          {pageQuestions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              open={expanded.has(q.id)}
              onToggle={() => toggle(q.id)}
              selectable
              selected={selectedIds.has(q.id)}
              onSelectedChange={(next) => toggleSelected(q.id, next)}
              onPractice={() => startPractice([q])}
              practiced={getPracticedQuestionInfo(q, practicedIndex)}
              query={query}
            />
          ))}
          <PagerBar
            label={questionsRangeLabel}
            page={safePage}
            totalPages={totalPages}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  );
}
