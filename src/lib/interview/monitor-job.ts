import { backendFirecrawlMonitor } from "@/lib/backend";
import { getSupabase } from "@/lib/auth/client";
import { runVerifiedRefresh, type RefreshProgress } from "./refresh-job";

export interface FirecrawlMonitorRow {
  id: string;
  firecrawl_id: string;
  name: string;
  kind: string;
  status: string;
  schedule_cron: string | null;
  schedule_text: string | null;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_check_summary: Record<string, number> | null;
  estimated_credits_per_month: number | null;
  source_url_count: number;
}

export interface PendingMonitorSource {
  id: string;
  url: string;
  last_status: string | null;
  last_changed_at: string | null;
  company_name?: string;
}

export interface MonitorStatus {
  monitors: FirecrawlMonitorRow[];
  pendingEvents: number;
  pendingSources: number;
  /** Active sources with `monitor_pending` (Firecrawl flagged a meaningful change). */
  pendingList: PendingMonitorSource[];
}

/**
 * List synced Firecrawl monitors + pending change counts.
 * Reads from Postgres directly (admin RLS) so the admin console works even
 * when the firecrawl-monitor edge function isn't deployed yet. Sync/run still
 * go through the edge function.
 */
export async function getFirecrawlMonitorStatus(): Promise<MonitorStatus> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");

  const [monitorsRes, eventsRes, pendingCountRes, pendingRes] =
    await Promise.all([
      sb
        .from("firecrawl_monitors")
        .select(
          "id,firecrawl_id,name,kind,status,schedule_cron,schedule_text,timezone,next_run_at,last_run_at,last_check_summary,estimated_credits_per_month,source_url_count"
        )
        .order("created_at", { ascending: false }),
      sb
        .from("firecrawl_monitor_events")
        .select("id", { count: "exact", head: true })
        .eq("processed", false)
        .in("page_status", ["changed", "new"]),
      sb
        .from("interview_sources")
        .select("id", { count: "exact", head: true })
        .eq("monitor_pending", true)
        .eq("active", true),
      sb
        .from("interview_sources")
        .select("id,url,last_status,last_changed_at,companies(name)")
        .eq("monitor_pending", true)
        .eq("active", true)
        .order("last_changed_at", { ascending: false, nullsFirst: false })
        .limit(100),
    ]);

  if (monitorsRes.error) throw new Error(monitorsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (pendingCountRes.error) throw new Error(pendingCountRes.error.message);
  if (pendingRes.error) throw new Error(pendingRes.error.message);

  const pendingList: PendingMonitorSource[] = (
    (pendingRes.data ?? []) as any[]
  ).map((r) => ({
    id: r.id,
    url: r.url,
    last_status: r.last_status ?? null,
    last_changed_at: r.last_changed_at ?? null,
    company_name: r.companies?.name,
  }));

  return {
    monitors: (monitorsRes.data ?? []) as FirecrawlMonitorRow[],
    pendingEvents: eventsRes.count ?? 0,
    pendingSources: pendingCountRes.count ?? 0,
    pendingList,
  };
}

/**
 * Create/replace scheduled Firecrawl monitors for all active interview_sources
 * (batched scrape targets) + optional PracHub crawl. Webhooks update source
 * status when pages change.
 */
export async function syncFirecrawlMonitors(opts?: {
  scheduleText?: string;
  timezone?: string;
  includePrachubCrawl?: boolean;
}): Promise<{
  ok: boolean;
  sourceUrls: number;
  monitorsCreated: number;
  webhookUrl?: string;
  scheduleText?: string;
}> {
  return backendFirecrawlMonitor({
    action: "sync",
    scheduleText: opts?.scheduleText || "daily at 6:00",
    timezone: opts?.timezone || "UTC",
    includePrachubCrawl: opts?.includePrachubCrawl !== false,
  });
}

/** Trigger an immediate Firecrawl check for one monitor. */
export async function runFirecrawlMonitorNow(
  firecrawlId: string
): Promise<unknown> {
  return backendFirecrawlMonitor({ action: "run", firecrawlId });
}

/** Delete a Firecrawl monitor and clear source links. */
export async function deleteFirecrawlMonitor(
  firecrawlId: string
): Promise<unknown> {
  return backendFirecrawlMonitor({ action: "delete", firecrawlId });
}

/**
 * Process sources flagged by monitor webhooks (`monitor_pending`), using the
 * existing change-tracked scrape + extract path. Clears the pending flag after.
 */
export async function processMonitorPending(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: RefreshProgress) => void;
}): Promise<{ added: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Not signed in.");

  const { data: pending, error } = await sb
    .from("interview_sources")
    .select("id")
    .eq("active", true)
    .eq("monitor_pending", true);
  if (error) throw new Error(error.message);
  const ids = (pending ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    opts?.onProgress?.({
      done: 0,
      total: 0,
      added: 0,
      message: "No monitor-flagged sources to process.",
    });
    return { added: 0 };
  }

  const result = await runVerifiedRefresh({
    signal: opts?.signal,
    onProgress: opts?.onProgress,
    onlySourceIds: ids,
  });

  await sb
    .from("interview_sources")
    .update({ monitor_pending: false })
    .in("id", ids);

  await sb
    .from("firecrawl_monitor_events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("processed", false)
    .in(
      "source_id",
      ids
    );

  return result;
}
