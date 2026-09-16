import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getFirecrawlApiKey } from "./settings";

// ChannelPulse OSS is local-first / BYOK: web search and scraping use the user's
// OWN Firecrawl API key (entered in Settings) and call Firecrawl directly. There
// is no hosted proxy — the managed `/websearch` and `/firecrawl-scrape` backend
// paths from the commercial build are intentionally absent here.

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

export interface FirecrawlResult {
  title: string;
  url: string;
  description?: string;
  markdown?: string;
}

export type FirecrawlSearchOptions = {
  /**
   * When true (default), ask Firecrawl to scrape each hit to markdown.
   * Discover should pass false — it scrapes chosen URLs separately.
   */
  scrape?: boolean;
  /** When true, surface failures instead of returning []. */
  throwOnError?: boolean;
  /**
   * Hostnames to exclude from search (Firecrawl -site: filters). Use for
   * domains already in the knowledge base so Discover prefers new sites.
   */
  excludeDomains?: string[];
  /**
   * Exact URLs already ingested — appended to the query as negative terms so
   * Firecrawl is less likely to return the same pages again.
   */
  excludeUrls?: string[];
};

/**
 * Dedicated Firecrawl web search (not MCP). Returns LLM-ready results for the
 * given query. By default falls back to [] on error so it never blocks an AI
 * response; pass throwOnError for admin Discover.
 */
export async function firecrawlSearch(
  query: string,
  limit = 4,
  opts?: FirecrawlSearchOptions
): Promise<FirecrawlResult[]> {
  if (!query.trim()) return [];
  const scrape = opts?.scrape !== false;
  const key = getFirecrawlApiKey();
  if (!key) {
    if (opts?.throwOnError) {
      throw new Error(
        "Firecrawl search unavailable. Add your Firecrawl API key in Settings."
      );
    }
    return [];
  }

  // Steer Firecrawl away from pages we already have (query negatives + domains).
  const excludeUrls = (opts?.excludeUrls ?? [])
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 8);
  const excludeDomains = [
    ...new Set(
      (opts?.excludeDomains ?? [])
        .map((d) => d.trim().toLowerCase().replace(/^www\./, ""))
        .filter(Boolean)
    ),
  ].slice(0, 20);

  let searchQuery = query.trim();
  if (excludeUrls.length) {
    const negatives = excludeUrls.map((u) => `-"${u}"`).join(" ");
    const combined = `${searchQuery} ${negatives}`.trim();
    searchQuery = combined.slice(0, 400);
  }

  try {
    const body: Record<string, unknown> = {
      query: searchQuery.slice(0, 400),
      limit,
    };
    if (scrape) body.scrapeOptions = { formats: ["markdown"] };
    if (excludeDomains.length) body.excludeDomains = excludeDomains;
    const res = await tauriFetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Firecrawl search failed ${res.status}: ${detail}`);
    }
    const json: any = await res.json();

    // Firecrawl v2: { success, data: { web: [...] } }. Also accept flat shapes.
    const web: any[] = Array.isArray(json?.data?.web)
      ? json.data.web
      : Array.isArray(json?.web)
        ? json.web
        : Array.isArray(json?.data) && !json.data.web
          ? json.data
          : Array.isArray(json?.results)
            ? json.results
            : [];
    return web
      .slice(0, limit)
      .map((r) => ({
        title: r.title ?? r.url ?? "Result",
        url: r.url ?? r.link ?? "",
        description: r.description ?? r.snippet ?? "",
        markdown: r.markdown ?? r.content ?? "",
      }))
      .filter((r) => !!r.url);
  } catch (err) {
    console.warn("Firecrawl search error:", err);
    if (opts?.throwOnError) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    return [];
  }
}

/**
 * GitHub repo pages often block Firecrawl / return thin HTML. Prefer the raw
 * README when the URL looks like a repo (or blob README).
 */
async function fetchGithubReadmeFallback(url: string): Promise<string> {
  let path = "";
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return "";
    path = u.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }

  const blob = path.match(
    /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+\.(md|markdown|rst|txt))$/i
  );
  const candidates: string[] = [];
  if (blob) {
    candidates.push(
      `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`
    );
  } else {
    const repo = path.match(/^\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/[^/]+)?(?:\/.*)?$/);
    if (!repo) return "";
    const [, owner, name] = repo;
    for (const branch of ["HEAD", "main", "master"]) {
      candidates.push(
        `https://raw.githubusercontent.com/${owner}/${name}/${branch}/README.md`
      );
    }
  }

  for (const raw of candidates) {
    try {
      const res = await tauriFetch(raw, { method: "GET" });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.trim().length > 80) return text.slice(0, 20000);
    } catch {
      /* try next */
    }
  }
  return "";
}

export type FirecrawlScrapeOptions = {
  /** Skip change-tracking (faster; better for link re-checks). */
  simple?: boolean;
};

/**
 * Scrape a single URL (e.g. a job posting) to Markdown. Prefers a direct
 * Firecrawl call with the user's own API key. For GitHub repos, falls back to
 * the raw README if Firecrawl is blocked. Returns "" on any failure so callers
 * can degrade gracefully.
 */
export async function firecrawlScrape(
  url: string,
  opts?: FirecrawlScrapeOptions
): Promise<string> {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "";
  const key = getFirecrawlApiKey();
  // `opts.simple` is retained in the type for call-site compatibility; with the
  // managed change-tracking proxy gone it no longer affects a direct scrape.
  void opts?.simple;
  try {
    if (key) {
      const res = await tauriFetch(FIRECRAWL_SCRAPE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          url: u,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      });
      if (res.ok) {
        const json: any = await res.json();
        const md = json?.data?.markdown ?? json?.markdown ?? "";
        if (String(md).trim().length > 0) return String(md).slice(0, 20000);
      } else {
        console.warn("Firecrawl scrape failed:", res.status);
      }
    }
  } catch (err) {
    console.warn("Firecrawl scrape error:", err);
  }

  // Browser can open GitHub while Firecrawl is blocked — try raw README.
  const gh = await fetchGithubReadmeFallback(u);
  if (gh) return gh;
  return "";
}
