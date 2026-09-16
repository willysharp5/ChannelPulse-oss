import { getSupabase } from "@/lib/auth/client";

export interface ResearchRun {
  id: string;
  kind: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  sources_checked: number;
  sources_changed: number;
  questions_added: number;
  questions_verified: number;
  notes: string | null;
}

export interface SourceStatus {
  id: string;
  url: string;
  source_type: string;
  last_status: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  questions_from_source: number;
  monitor_pending?: boolean;
  firecrawl_monitor_id?: string | null;
  company_name?: string;
}

const RUN_SELECT =
  "id,kind,status,trigger,started_at,finished_at,sources_checked,sources_changed,questions_added,questions_verified,notes";

/** Recent research runs (admin-only via RLS). */
export async function listResearchRuns(limit = 15): Promise<ResearchRun[]> {
  const { rows } = await listResearchRunsPage({ page: 0, pageSize: limit });
  return rows;
}

/** Paginated / filtered research runs for the admin Recent runs table. */
export async function listResearchRunsPage(opts: {
  page: number;
  pageSize?: number;
  kind?: string;
  status?: string;
  search?: string;
}): Promise<{ rows: ResearchRun[]; count: number }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], count: 0 };
  const pageSize = opts.pageSize ?? 12;
  const from = Math.max(0, opts.page) * pageSize;
  let q = sb
    .from("research_runs")
    .select(RUN_SELECT, { count: "exact" })
    .order("started_at", { ascending: false });
  if (opts.kind && opts.kind !== "all") q = q.eq("kind", opts.kind);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  const search = (opts.search ?? "").trim();
  if (search) {
    const safe = search.replace(/[%_,]/g, "");
    if (safe) {
      q = q.or(
        `notes.ilike.%${safe}%,trigger.ilike.%${safe}%,kind.ilike.%${safe}%,status.ilike.%${safe}%`
      );
    }
  }
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) {
    console.warn("listResearchRunsPage failed:", error.message);
    return { rows: [], count: 0 };
  }
  return { rows: (data ?? []) as ResearchRun[], count: count ?? 0 };
}

function mapSourceRows(data: unknown[]): SourceStatus[] {
  return (data as any[]).map((r) => ({
    id: r.id,
    url: r.url,
    source_type: r.source_type,
    last_status: r.last_status,
    last_checked_at: r.last_checked_at,
    last_changed_at: r.last_changed_at,
    questions_from_source: r.questions_from_source,
    monitor_pending: !!r.monitor_pending,
    firecrawl_monitor_id: r.firecrawl_monitor_id ?? null,
    company_name: r.companies?.name,
  }));
}

/** Tracked sources, most-recently-checked first (admin-only). */
export async function listSourceStatus(limit = 100): Promise<SourceStatus[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("interview_sources")
    .select(
      "id,url,source_type,last_status,last_checked_at,last_changed_at,questions_from_source,monitor_pending,firecrawl_monitor_id,companies(name)"
    )
    .order("last_checked_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn("listSourceStatus failed:", error.message);
    return [];
  }
  return mapSourceRows(data ?? []);
}

/** Active tracked sources for selective refresh (admin-only). */
export async function listActiveSourcesForRefresh(
  limit = 500
): Promise<SourceStatus[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("interview_sources")
    .select(
      "id,url,source_type,last_status,last_checked_at,last_changed_at,questions_from_source,monitor_pending,firecrawl_monitor_id,companies(name)"
    )
    .eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) {
    console.warn("listActiveSourcesForRefresh failed:", error.message);
    return [];
  }
  return mapSourceRows(data ?? []);
}

export interface VerifiedStats {
  total: number;
  sources: number;
  companiesWithSources: number;
}

/** Bank-wide research coverage stats. */
export async function getVerifiedStats(): Promise<VerifiedStats> {
  const sb = getSupabase();
  if (!sb) return { total: 0, sources: 0, companiesWithSources: 0 };
  const [{ count: total }, srcRes] = await Promise.all([
    sb.from("interview_questions").select("id", { count: "exact", head: true }),
    sb.from("interview_sources").select("company_id"),
  ]);
  const rows = (srcRes.data ?? []) as { company_id: string }[];
  const companies = new Set(rows.map((r) => r.company_id));
  return {
    total: total ?? 0,
    sources: rows.length,
    companiesWithSources: companies.size,
  };
}
