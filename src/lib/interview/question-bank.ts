import { getSupabase } from "@/lib/auth/client";

export type QuestionCategory =
  | "technical"
  | "behavioral"
  | "coding"
  | "system_design"
  | "product";
export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface BankCompany {
  id: string;
  slug: string;
  name: string;
  category: string;
}

export interface BankQuestion {
  id: string;
  company_id: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  role_level: string | null;
  question: string;
  model_answer: string | null;
  tags: string[];
  source_url?: string | null;
  /** When the question was last reported (from sources like PracHub). */
  reported_at?: string | null;
  /** Interview round/stage, e.g. "Onsite", "Technical Screen". */
  stage?: string | null;
  /** Populated when browsing across companies (e.g. by role). */
  company_name?: string;
}

export interface CompanyCounts {
  total: number;
  byCategory: Record<string, number>;
}

/** All companies in the bank (alphabetical). */
export async function listBankCompanies(): Promise<BankCompany[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("companies")
    .select("id,slug,name,category")
    .order("name");
  if (error) {
    console.warn("listBankCompanies failed:", error.message);
    return [];
  }
  return (data ?? []) as BankCompany[];
}

/**
 * Question counts per company (total + per-category). Pages through all rows —
 * Supabase's default max-rows (~1000) would otherwise make later companies look empty.
 */
export async function getQuestionCounts(): Promise<Record<string, CompanyCounts>> {
  const sb = getSupabase();
  if (!sb) return {};
  const map: Record<string, CompanyCounts> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("interview_questions")
      .select("company_id,category")
      .range(from, to);
    if (error) {
      console.warn("getQuestionCounts failed:", error.message);
      break;
    }
    const rows = (data ?? []) as { company_id: string; category: string }[];
    for (const row of rows) {
      const c = (map[row.company_id] ??= { total: 0, byCategory: {} });
      c.total += 1;
      c.byCategory[row.category] = (c.byCategory[row.category] || 0) + 1;
    }
    if (rows.length < pageSize) break;
  }
  return map;
}

/** Questions for one company, with optional category/difficulty/text filters. */
export async function listBankQuestions(
  companyId: string,
  opts: {
    category?: QuestionCategory | "all";
    difficulty?: QuestionDifficulty | "all";
    /** "all" | "general" (role-agnostic / null) | a specific role label. */
    role?: string;
    query?: string;
  } = {}
): Promise<BankQuestion[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("interview_questions")
    .select(
      "id,company_id,category,difficulty,role_level,question,model_answer,tags,source_url,reported_at,stage"
    )
    .eq("company_id", companyId);
  if (opts.category && opts.category !== "all") q = q.eq("category", opts.category);
  if (opts.difficulty && opts.difficulty !== "all")
    q = q.eq("difficulty", opts.difficulty);
  if (opts.role && opts.role !== "all") {
    if (opts.role === "general") q = q.is("role_level", null);
    else q = q.eq("role_level", opts.role);
  }
  const text = opts.query?.trim();
  if (text) q = q.ilike("question", `%${text}%`);
  const { data, error } = await q.order("category").limit(1000);
  if (error) {
    console.warn("listBankQuestions failed:", error.message);
    return [];
  }
  return (data ?? []) as BankQuestion[];
}

export interface QuestionFilters {
  companyId?: string;
  /** Multi-select companies (OR). Takes precedence over companyId when set. */
  companyIds?: string[];
  role?: string;
  category?: QuestionCategory;
  /** Multi-select categories (OR). */
  categories?: QuestionCategory[];
  difficulty?: QuestionDifficulty;
  /** Multi-select difficulties (OR). */
  difficulties?: QuestionDifficulty[];
  /** Interview round/stage. */
  stage?: string;
  /** Derived from role_level: intern|new_grad|junior|senior|staff|manager. */
  seniority?: string;
  query?: string;
  /** Only rows with a non-null model_answer (e.g. for a "reveal answer" UI). */
  requireModelAnswer?: boolean;
}

const SENIORITY_PATTERNS: Record<string, string[]> = {
  intern: ["intern"],
  new_grad: ["new grad", "graduate", "entry"],
  junior: ["junior"],
  senior: ["senior", "sr."],
  staff: ["staff", "principal", "lead"],
  manager: ["manager", "director", "head of", "vp"],
};

/** Distinct role + stage values across the bank, for filter dropdowns. */
export async function listQuestionFacets(): Promise<{
  roles: string[];
  stages: string[];
}> {
  const sb = getSupabase();
  if (!sb) return { roles: [], stages: [] };
  const [roleRes, stageRes] = await Promise.all([
    sb
      .from("interview_questions")
      .select("role_level")
      .not("role_level", "is", null)
      .limit(20000),
    sb
      .from("interview_questions")
      .select("stage")
      .not("stage", "is", null)
      .limit(20000),
  ]);
  const roles = new Set<string>();
  for (const r of (roleRes.data ?? []) as { role_level: string | null }[])
    if (r.role_level) roles.add(r.role_level);
  const stages = new Set<string>();
  for (const r of (stageRes.data ?? []) as { stage: string | null }[])
    if (r.stage) stages.add(r.stage);
  return {
    roles: [...roles].sort(),
    stages: [...stages].sort(),
  };
}

/**
 * Query the whole bank with structured filters (company, role, category,
 * difficulty, round/stage, seniority) + optional text — paginated. Powers the
 * dropdown filter toolbar.
 */
export async function queryQuestions(
  filters: QuestionFilters,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ rows: BankQuestion[]; total: number }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], total: 0 };
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  let q = sb
    .from("interview_questions")
    .select(
      "id,company_id,category,difficulty,role_level,question,model_answer,tags,source_url,reported_at,stage,companies(name)",
      { count: "exact" }
    );
  if (filters.companyIds?.length) q = q.in("company_id", filters.companyIds);
  else if (filters.companyId) q = q.eq("company_id", filters.companyId);
  if (filters.role) q = q.eq("role_level", filters.role);
  if (filters.categories?.length) q = q.in("category", filters.categories);
  else if (filters.category) q = q.eq("category", filters.category);
  if (filters.difficulties?.length) q = q.in("difficulty", filters.difficulties);
  else if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
  if (filters.stage) q = q.eq("stage", filters.stage);
  if (filters.seniority && SENIORITY_PATTERNS[filters.seniority]) {
    const pats = SENIORITY_PATTERNS[filters.seniority];
    q = q.or(pats.map((p) => `role_level.ilike.%${p}%`).join(","));
  }
  const text = filters.query?.trim();
  if (text) q = q.ilike("question", `%${text}%`);
  if (filters.requireModelAnswer) q = q.not("model_answer", "is", null);
  const { data, error, count } = await q
    .order("reported_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.warn("queryQuestions failed:", error.message);
    return { rows: [], total: 0 };
  }
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    company_id: r.company_id,
    category: r.category,
    difficulty: r.difficulty,
    role_level: r.role_level,
    question: r.question,
    model_answer: r.model_answer,
    tags: r.tags ?? [],
    source_url: r.source_url,
    reported_at: r.reported_at,
    stage: r.stage,
    company_name: r.companies?.name,
  })) as BankQuestion[];
  return { rows, total: count ?? rows.length };
}

export interface RoleCounts {
  total: number;
  byCategory: Record<string, number>;
  companies: number;
}

/** Question counts per role (total + per-category + distinct companies). */
export async function getRoleCounts(): Promise<Record<string, RoleCounts>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data, error } = await sb
    .from("interview_questions")
    .select("role_level,category,company_id")
    .not("role_level", "is", null)
    .limit(20000);
  if (error) {
    console.warn("getRoleCounts failed:", error.message);
    return {};
  }
  const map: Record<string, RoleCounts> = {};
  const companiesByRole: Record<string, Set<string>> = {};
  for (const row of (data ?? []) as {
    role_level: string;
    category: string;
    company_id: string;
  }[]) {
    const c = (map[row.role_level] ??= {
      total: 0,
      byCategory: {},
      companies: 0,
    });
    c.total += 1;
    c.byCategory[row.category] = (c.byCategory[row.category] || 0) + 1;
    (companiesByRole[row.role_level] ??= new Set()).add(row.company_id);
  }
  for (const role of Object.keys(map)) {
    map[role].companies = companiesByRole[role]?.size ?? 0;
  }
  return map;
}

/** Questions for one role across companies, with optional filters. */
export async function listQuestionsByRole(
  role: string,
  opts: {
    companyId?: string | "all";
    category?: QuestionCategory | "all";
    difficulty?: QuestionDifficulty | "all";
    query?: string;
  } = {}
): Promise<BankQuestion[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("interview_questions")
    .select(
      "id,company_id,category,difficulty,role_level,question,model_answer,tags,source_url,reported_at,stage,companies(name)"
    )
    .eq("role_level", role);
  if (opts.companyId && opts.companyId !== "all")
    q = q.eq("company_id", opts.companyId);
  if (opts.category && opts.category !== "all")
    q = q.eq("category", opts.category);
  if (opts.difficulty && opts.difficulty !== "all")
    q = q.eq("difficulty", opts.difficulty);
  const text = opts.query?.trim();
  if (text) q = q.ilike("question", `%${text}%`);
  const { data, error } = await q.order("company_id").limit(2000);
  if (error) {
    console.warn("listQuestionsByRole failed:", error.message);
    return [];
  }
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    company_id: r.company_id,
    category: r.category,
    difficulty: r.difficulty,
    role_level: r.role_level,
    question: r.question,
    model_answer: r.model_answer,
    tags: r.tags ?? [],
    source_url: r.source_url,
    reported_at: r.reported_at,
    stage: r.stage,
    company_name: r.companies?.name,
  })) as BankQuestion[];
}

/** Distinct role labels present for a company (for the role filter). */
export async function listCompanyRoles(companyId: string): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("interview_questions")
    .select("role_level")
    .eq("company_id", companyId)
    .not("role_level", "is", null)
    .limit(5000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of (data ?? []) as { role_level: string | null }[]) {
    if (r.role_level) set.add(r.role_level);
  }
  return [...set].sort();
}

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  coding: "Coding",
  system_design: "System design",
  // Also holds business cases (consulting profitability / market entry / market
  // sizing) and data-science product & metrics cases — not just PM questions.
  product: "Product & case",
};

export interface BankOverview {
  totalQuestions: number;
  companies: number;
  byCategory: Record<QuestionCategory, number>;
}

/**
 * Count the DISTINCT companies represented by a set of bank question ids — i.e.
 * the companies the user has actually practiced / built interviews from (not the
 * whole bank). Ids come from saved results + custom templates' bankQuestionIds.
 */
export async function countCompaniesForQuestions(
  questionIds: string[]
): Promise<number> {
  const sb = getSupabase();
  const ids = [...new Set(questionIds.filter(Boolean))];
  if (!sb || ids.length === 0) return 0;
  const companies = new Set<string>();
  // Chunk to stay well under URL/`in()` limits for large practice histories.
  const chunkSize = 300;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from("interview_questions")
      .select("company_id")
      .in("id", chunk);
    if (error || !data) continue;
    for (const r of data as { company_id: string | null }[]) {
      if (r.company_id) companies.add(r.company_id);
    }
  }
  return companies.size;
}

/**
 * Lightweight bank stats for the dashboard — uses HEAD count queries (no row
 * transfer), so it stays cheap even with thousands of questions. Unlike
 * getQuestionCounts (which pages every row), this only fetches counts.
 */
export async function getBankOverview(): Promise<BankOverview> {
  const empty: BankOverview = {
    totalQuestions: 0,
    companies: 0,
    byCategory: {
      technical: 0,
      behavioral: 0,
      coding: 0,
      system_design: 0,
      product: 0,
    },
  };
  const sb = getSupabase();
  if (!sb) return empty;

  const catCount = async (c: QuestionCategory): Promise<number> => {
    const { count } = await sb
      .from("interview_questions")
      .select("id", { count: "exact", head: true })
      .eq("category", c);
    return count ?? 0;
  };

  try {
    const [
      total,
      companies,
      technical,
      behavioral,
      coding,
      system_design,
      product,
    ] = await Promise.all([
      sb.from("interview_questions").select("id", { count: "exact", head: true }),
      sb.from("companies").select("id", { count: "exact", head: true }),
      catCount("technical"),
      catCount("behavioral"),
      catCount("coding"),
      catCount("system_design"),
      catCount("product"),
    ]);
    return {
      totalQuestions: total.count ?? 0,
      companies: companies.count ?? 0,
      byCategory: { technical, behavioral, coding, system_design, product },
    };
  } catch (err) {
    console.warn("getBankOverview failed:", err);
    return empty;
  }
}

/** Human labels for company `category` (industry). */
export const INDUSTRY_LABELS: Record<string, string> = {
  big_tech: "Tech",
  consumer: "Consumer",
  ai: "AI",
  fintech: "Fintech",
  data_infra: "Data & Infra",
  saas: "SaaS",
  high_growth: "High Growth",
  consulting: "Consulting",
  finance: "Finance & Banking",
  other: "Other",
};

export const industryLabel = (c: string) =>
  INDUSTRY_LABELS[c] ??
  c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * Search questions across ALL companies. Tokenizes the query and ranks results
 * by how many terms match the question text, tags, and company name — so a
 * search matches "anything", including question content, not just company names.
 */
export async function searchAllQuestions(
  query: string,
  limit = 40
): Promise<BankQuestion[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const tokens = query
    .toLowerCase()
    .replace(/[(),%*]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (tokens.length === 0) return [];

  const orExpr = tokens.map((t) => `question.ilike.%${t}%`).join(",");
  const { data, error } = await sb
    .from("interview_questions")
    .select(
      "id,company_id,category,difficulty,role_level,question,model_answer,tags,source_url,reported_at,stage,companies(name)"
    )
    .or(orExpr)
    .limit(300);
  if (error) {
    console.warn("searchAllQuestions failed:", error.message);
    return [];
  }
  const scored = ((data ?? []) as any[]).map((r) => {
    const hay = `${r.question} ${(r.tags ?? []).join(" ")} ${
      r.companies?.name ?? ""
    }`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 1;
    if (r.model_answer) score += 0.2;
    return {
      q: {
        id: r.id,
        company_id: r.company_id,
        category: r.category,
        difficulty: r.difficulty,
        role_level: r.role_level,
        question: r.question,
        model_answer: r.model_answer,
        tags: r.tags ?? [],
        source_url: r.source_url,
        reported_at: r.reported_at,
        stage: r.stage,
        company_name: r.companies?.name,
      } as BankQuestion,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.q);
}
