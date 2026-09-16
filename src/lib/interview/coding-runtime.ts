import { SQL_FIXTURE_SQL, SQL_SCHEMA_SUMMARY } from "./sql-fixtures";

export type CodingLanguage = "javascript" | "python" | "sql";

/** Human-facing name for each editor language (for prompts and UI copy). */
export const CODING_LANGUAGE_LABELS: Record<CodingLanguage, string> = {
  javascript: "JavaScript",
  python: "Python",
  sql: "SQL",
};

/** The label for a language, or a neutral phrase when the round hasn't fixed one. */
export function codingLanguageLabel(lang?: CodingLanguage | null): string {
  return lang ? CODING_LANGUAGE_LABELS[lang] : "the in-app code editor";
}

export interface CodeRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Run candidate JavaScript in a dedicated Web Worker with a fake console.
 * Isolated from the app page; terminated on timeout.
 */
export async function runJavaScript(
  code: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CodeRunResult> {
  const started = performance.now();
  const workerSource = `
self.onmessage = (event) => {
  const { code } = event.data || {};
  const logs = [];
  const errLogs = [];
  const fakeConsole = {
    log: (...args) => logs.push(args.map(stringify).join(" ")),
    info: (...args) => logs.push(args.map(stringify).join(" ")),
    warn: (...args) => logs.push("[warn] " + args.map(stringify).join(" ")),
    error: (...args) => errLogs.push(args.map(stringify).join(" ")),
  };
  function stringify(v) {
    try {
      if (typeof v === "string") return v;
      if (typeof v === "undefined") return "undefined";
      if (typeof v === "symbol") return String(v);
      if (typeof v === "function") return v.toString();
      return JSON.stringify(v, null, 0) ?? String(v);
    } catch {
      return String(v);
    }
  }
  function assert(cond, msg) {
    if (!cond) throw new Error(msg || "Assertion failed");
  }
  try {
    const runner = new Function("console", "assert", String(code));
    const result = runner(fakeConsole, assert);
    if (typeof result !== "undefined") logs.push(stringify(result));
    self.postMessage({
      ok: errLogs.length === 0,
      stdout: logs.join("\\n"),
      stderr: errLogs.join("\\n"),
    });
  } catch (err) {
    const message =
      err && typeof err === "object" && "stack" in err
        ? String(err.stack)
        : String(err);
    self.postMessage({
      ok: false,
      stdout: logs.join("\\n"),
      stderr: message,
    });
  }
};
`;

  const blob = new Blob([workerSource], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  return new Promise<CodeRunResult>((resolve) => {
    let settled = false;
    const finish = (result: CodeRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        stdout: "",
        stderr: `Timed out after ${timeoutMs}ms (infinite loop or too slow).`,
        timedOut: true,
        durationMs: Math.round(performance.now() - started),
      });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data || {};
      finish({
        ok: !!data.ok,
        stdout: String(data.stdout || ""),
        stderr: String(data.stderr || ""),
        timedOut: false,
        durationMs: Math.round(performance.now() - started),
      });
    };

    worker.onerror = (event) => {
      finish({
        ok: false,
        stdout: "",
        stderr: event.message || "Worker failed to run the code.",
        timedOut: false,
        durationMs: Math.round(performance.now() - started),
      });
    };

    worker.postMessage({ code });
  });
}

// ── Python sandbox (Pyodide / WASM in a Web Worker) ──────────────────────────
const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyWorker: Worker | null = null;
let pyReady: Promise<void> | null = null;
let pyReqId = 0;

function createPyWorker(): { worker: Worker; ready: Promise<void> } {
  const src = `
    importScripts('${PYODIDE_BASE}pyodide.js');
    self.__pyodide = null;
    loadPyodide({ indexURL: '${PYODIDE_BASE}' })
      .then((py) => { self.__pyodide = py; self.postMessage({ type: 'ready' }); })
      .catch((e) => self.postMessage({ type: 'error', error: String(e && e.message || e) }));
    self.onmessage = async (e) => {
      const { id, code } = e.data || {};
      const py = self.__pyodide;
      if (!py) { self.postMessage({ id, ok: false, stdout: '', stderr: 'Python is not ready yet.' }); return; }
      let out = '', err = '';
      py.setStdout({ batched: (s) => { out += s + '\\n'; } });
      py.setStderr({ batched: (s) => { err += s + '\\n'; } });
      try {
        await py.runPythonAsync(code);
        self.postMessage({ id, ok: true, stdout: out, stderr: err });
      } catch (ex) {
        const msg = (ex && ex.message) ? ex.message : String(ex);
        self.postMessage({ id, ok: false, stdout: out, stderr: (err ? err : '') + msg });
      }
    };
  `;
  const worker = new Worker(
    URL.createObjectURL(new Blob([src], { type: "application/javascript" }))
  );
  const ready = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "ready") {
        worker.removeEventListener("message", onMsg);
        resolve();
      } else if (e.data?.type === "error") {
        worker.removeEventListener("message", onMsg);
        reject(new Error(e.data.error || "Failed to load Python"));
      }
    };
    worker.addEventListener("message", onMsg);
    // Loading Pyodide (~10MB) can take a while on first use.
    setTimeout(() => reject(new Error("Timed out loading Python runtime")), 90000);
  });
  return { worker, ready };
}

/** Warm up the Python runtime (downloads Pyodide once) — call when Python is selected. */
export function preloadPython(): void {
  if (pyWorker) return;
  const { worker, ready } = createPyWorker();
  pyWorker = worker;
  pyReady = ready.catch(() => {
    // Reset so a later run can retry the download.
    if (pyWorker === worker) {
      try { worker.terminate(); } catch {}
      pyWorker = null;
      pyReady = null;
    }
  });
}

/** Run candidate Python in the Pyodide sandbox. Terminates the worker on timeout. */
export async function runPython(
  code: string,
  timeoutMs = 10000
): Promise<CodeRunResult> {
  const started = performance.now();
  if (!pyWorker || !pyReady) preloadPython();
  const worker = pyWorker!;
  try {
    await pyReady;
  } catch {
    return {
      ok: false,
      stdout: "",
      stderr: "Could not load the Python runtime. Check your connection and try again.",
      timedOut: false,
      durationMs: Math.round(performance.now() - started),
    };
  }
  if (!pyWorker) {
    return {
      ok: false, stdout: "", stderr: "Python runtime unavailable.", timedOut: false,
      durationMs: Math.round(performance.now() - started),
    };
  }
  const id = ++pyReqId;
  return await new Promise<CodeRunResult>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMsg);
    };
    const timer = setTimeout(() => {
      cleanup();
      // Hard-stop a runaway program: kill the worker so the next run reloads.
      try { worker.terminate(); } catch {}
      if (pyWorker === worker) { pyWorker = null; pyReady = null; }
      resolve({
        ok: false, stdout: "", stderr: "Execution timed out (possible infinite loop).",
        timedOut: true, durationMs: Math.round(performance.now() - started),
      });
    }, timeoutMs);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      cleanup();
      resolve({
        ok: !!e.data.ok,
        stdout: String(e.data.stdout || ""),
        stderr: String(e.data.stderr || ""),
        timedOut: false,
        durationMs: Math.round(performance.now() - started),
      });
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({ id, code });
  });
}

// ── SQL sandbox (SQLite compiled to WASM — sql.js in a Web Worker) ───────────
// Loaded from the CDN exactly like Pyodide above, so a real database costs us
// nothing in `package.json`.
const SQLJS_VERSION = "1.14.2";
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;
/** Rows printed in the console before the output is truncated. */
const SQL_MAX_ROWS = 50;

let sqlWorker: Worker | null = null;
let sqlReady: Promise<void> | null = null;
let sqlReqId = 0;

function createSqlWorker(): { worker: Worker; ready: Promise<void> } {
  const src = `
    importScripts('${SQLJS_BASE}sql-wasm.js');
    const FIXTURES = ${JSON.stringify(SQL_FIXTURE_SQL)};
    const MAX_ROWS = ${SQL_MAX_ROWS};
    self.__SQL = null;
    initSqlJs({ locateFile: (f) => '${SQLJS_BASE}' + f })
      .then((SQL) => { self.__SQL = SQL; self.postMessage({ type: 'ready' }); })
      .catch((e) => self.postMessage({ type: 'error', error: String(e && e.message || e) }));

    // sqlite3_changes() still holds the count from loading the fixtures, so
    // count what the candidate's own script changed with the monotonic counter.
    function totalChanges(db) {
      const r = db.exec('SELECT total_changes()');
      return r.length ? Number(r[0].values[0][0]) : 0;
    }
    function cell(v) {
      if (v === null || v === undefined) return 'NULL';
      if (v instanceof Uint8Array) return '<blob ' + v.length + 'B>';
      const s = String(v);
      return s.length > 40 ? s.slice(0, 39) + '…' : s;
    }
    // Print result sets as an aligned text grid — closest thing to a psql/DBeaver
    // result pane inside a <pre>.
    function grid(columns, values) {
      const head = columns.map(String);
      const body = values.slice(0, MAX_ROWS).map((row) => row.map(cell));
      const width = head.map((h, i) =>
        body.reduce((w, r) => Math.max(w, (r[i] || '').length), h.length)
      );
      const line = (cells) => cells.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
      const out = [line(head), width.map((w) => '-'.repeat(w)).join('  ')];
      for (const r of body) out.push(line(r));
      out.push(
        '(' + values.length + (values.length === 1 ? ' row' : ' rows') +
        (values.length > MAX_ROWS ? ', showing the first ' + MAX_ROWS : '') + ')'
      );
      return out.join('\\n');
    }

    self.onmessage = (e) => {
      const { id, code } = e.data || {};
      const SQL = self.__SQL;
      if (!SQL) {
        self.postMessage({ id, ok: false, stdout: '', stderr: 'The SQL engine is not ready yet.' });
        return;
      }
      let db = null;
      try {
        // Fresh database every run: the sample rows are identical each time and
        // nothing the candidate wrote last run leaks into this one.
        db = new SQL.Database();
        db.run(FIXTURES);
      } catch (ex) {
        if (db) { try { db.close(); } catch (_e) {} }
        self.postMessage({
          id, ok: false, stdout: '',
          stderr: 'Could not load the sample data: ' + String(ex && ex.message || ex),
        });
        return;
      }
      try {
        // Step the statements ourselves rather than db.exec(), which drops a
        // SELECT that matched nothing — and "0 rows" is an answer the candidate
        // needs to see.
        const blocks = [];
        const changesBefore = totalChanges(db);
        for (const stmt of db.iterateStatements(String(code))) {
          const columns = stmt.getColumnNames();
          if (columns.length) {
            const values = [];
            while (stmt.step()) values.push(stmt.get());
            blocks.push(grid(columns, values));
          } else {
            stmt.step();
          }
          stmt.free();
        }
        const changed = totalChanges(db) - changesBefore;
        let out;
        if (blocks.length) {
          out = blocks
            .map((b, i) => (blocks.length > 1 ? '-- result ' + (i + 1) + '\\n' : '') + b)
            .join('\\n\\n');
        } else {
          out = changed > 0
            ? changed + ' row(s) changed, no result set. Add a SELECT to see rows.'
            : 'Statement ran, no result set. Add a SELECT to see rows.';
        }
        self.postMessage({ id, ok: true, stdout: out, stderr: '' });
      } catch (ex) {
        self.postMessage({
          id, ok: false, stdout: '',
          stderr: String(ex && ex.message || ex),
        });
      } finally {
        try { db.close(); } catch (_e) {}
      }
    };
  `;
  const worker = new Worker(
    URL.createObjectURL(new Blob([src], { type: "application/javascript" }))
  );
  const ready = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "ready") {
        worker.removeEventListener("message", onMsg);
        resolve();
      } else if (e.data?.type === "error") {
        worker.removeEventListener("message", onMsg);
        reject(new Error(e.data.error || "Failed to load SQLite"));
      }
    };
    worker.addEventListener("message", onMsg);
    // sql-wasm is ~1.5MB; give a slow connection room but don't hang forever.
    setTimeout(() => reject(new Error("Timed out loading the SQL engine")), 60000);
  });
  return { worker, ready };
}

/** Warm up SQLite (downloads sql.js once) — call when SQL is selected. */
export function preloadSql(): void {
  if (sqlWorker) return;
  const { worker, ready } = createSqlWorker();
  sqlWorker = worker;
  sqlReady = ready.catch(() => {
    // Reset so a later run can retry the download.
    if (sqlWorker === worker) {
      try { worker.terminate(); } catch {}
      sqlWorker = null;
      sqlReady = null;
    }
  });
}

/**
 * Run candidate SQL against the sample database in `sql-fixtures.ts`.
 * Terminates the worker on timeout, so a runaway cross join can't wedge the app.
 */
export async function runSql(
  code: string,
  timeoutMs = 8000
): Promise<CodeRunResult> {
  const started = performance.now();
  if (!sqlWorker || !sqlReady) preloadSql();
  const worker = sqlWorker!;
  try {
    await sqlReady;
  } catch {
    return {
      ok: false,
      stdout: "",
      stderr: "Could not load the SQL engine. Check your connection and try again.",
      timedOut: false,
      durationMs: Math.round(performance.now() - started),
    };
  }
  if (!sqlWorker) {
    return {
      ok: false, stdout: "", stderr: "SQL engine unavailable.", timedOut: false,
      durationMs: Math.round(performance.now() - started),
    };
  }
  const id = ++sqlReqId;
  return await new Promise<CodeRunResult>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMsg);
    };
    const timer = setTimeout(() => {
      cleanup();
      try { worker.terminate(); } catch {}
      if (sqlWorker === worker) { sqlWorker = null; sqlReady = null; }
      resolve({
        ok: false,
        stdout: "",
        stderr:
          "Query timed out. It's probably scanning far more rows than it needs to.",
        timedOut: true,
        durationMs: Math.round(performance.now() - started),
      });
    }, timeoutMs);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      cleanup();
      resolve({
        ok: !!e.data.ok,
        stdout: String(e.data.stdout || ""),
        stderr: String(e.data.stderr || ""),
        timedOut: false,
        durationMs: Math.round(performance.now() - started),
      });
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({ id, code });
  });
}

/** Dispatch a run to the sandbox for `language`. */
export function runCode(
  language: CodingLanguage,
  code: string
): Promise<CodeRunResult> {
  if (language === "python") return runPython(code);
  if (language === "sql") return runSql(code);
  return runJavaScript(code);
}

/**
 * Which sandbox a question wants to be answered in. SQL rounds hand the
 * candidate a query task, and opening a JavaScript file for it would be wrong,
 * so look for the tells: the word SQL, an explicit "write a query", or SQL
 * clauses/table names from the sample schema.
 */
export function defaultCodingLanguage(question: string): CodingLanguage {
  const q = question.toLowerCase();
  if (/\bsql\b/.test(q)) return "sql";
  // "write a query", "write the fixed query", "produce the query and the chart…".
  // Verb-led on purpose: "answer range-sum queries" is an array problem, not SQL.
  if (/\b(write|produce|draft|give me|show me)\b[^.!?]{0,40}\bquer(?:y|ies)\b/.test(q)) {
    return "sql";
  }
  // "a dashboard query takes 90 seconds" — a query plus a database word.
  if (
    /\bquer(?:y|ies)\b/.test(q) &&
    /\b(dashboard|tables?|columns?|indexe?s?|warehouse|database|schema|joins?|rows?|group by|dbt|snowflake|postgres|bigquery|redshift)\b/.test(q)
  ) {
    return "sql";
  }
  if (/\b(group by|window function|left join|inner join|cte|row_number|rank\(\))\b/.test(q)) {
    return "sql";
  }
  // "Given `orders(id, user_id, …)`" — a schema in the prompt means a query.
  if (/\b(orders|events|sessions|subscriptions|users)\s*\(/.test(q)) return "sql";
  // "the analysis … from an orders table" — a fixture table named as a table.
  if (/\b(orders|events|sessions|subscriptions|users)\s+table\b/.test(q)) return "sql";
  // Analysis work — a dataset, a notebook, a model, a cleaning pass. Python is
  // the tool people actually reach for, and the fallback below would hand a data
  // take-home a JavaScript file. Deliberately narrow vocabulary: "parse a CSV"
  // is still a fine algorithm question in a JavaScript round.
  if (
    /\b(dataset|data ?frames?|pandas|numpy|notebook|jupyter|scikit-?learn|sklearn|cleaning steps|data cleaning)\b/.test(q)
  ) {
    return "python";
  }
  return "javascript";
}

export function defaultCodingStarter(
  question: string,
  language: CodingLanguage = "javascript"
): string {
  const hint = question.trim().slice(0, 220).replace(/\s+/g, " ");
  const ellipsis = question.trim().length > 220 ? "…" : "";
  if (language === "sql") {
    const schema = SQL_SCHEMA_SUMMARY.split("\n")
      .map((line) => `--   ${line}`)
      .join("\n");
    return `-- SQL interview practice
-- ${hint}${ellipsis}
--
-- These tables are already loaded in an in-memory SQLite database:
${schema}
--
-- Run (⌘/Ctrl+Enter) executes against sample rows, so you can check your own
-- work. State the grain you're aiming for before you write the SELECT.

SELECT *
FROM orders
LIMIT 10;
`;
  }
  if (language === "python") {
    return `# Coding interview practice
# ${hint}${ellipsis}
#
# Write your solution below. Use print(...) to show results.
# Runs in a local Python (Pyodide) sandbox — the first run downloads Python once.


def solve():
    # TODO: implement
    return None


# Quick self-checks — edit these for the problem
print("result:", solve())
`;
  }
  return `/**
 * Coding interview practice
 * ${hint}${ellipsis}
 *
 * Write your solution below. Use console.log(...) to show results.
 * Tip: assert(condition, "message") throws if the check fails.
 */

function solve(/* args */) {
  // TODO: implement
  return null;
}

// Quick self-checks — edit these for the problem
console.log("result:", solve());
`;
}

export function formatCodingAnswer(params: {
  language: CodingLanguage;
  code: string;
  run: CodeRunResult | null;
}): string {
  const lang = params.language === "javascript" ? "javascript" : params.language;
  const parts = [
    "```" + lang,
    params.code.trimEnd(),
    "```",
  ];
  if (params.run) {
    parts.push("");
    parts.push("### Run output");
    if (params.run.stdout.trim()) {
      parts.push("```text");
      parts.push(params.run.stdout.trimEnd());
      parts.push("```");
    } else {
      parts.push("_(no stdout)_");
    }
    if (params.run.stderr.trim()) {
      parts.push("");
      parts.push("### Errors");
      parts.push("```text");
      parts.push(params.run.stderr.trimEnd());
      parts.push("```");
    }
    if (params.run.timedOut) {
      parts.push("");
      parts.push("_Run timed out._");
    }
  } else {
    parts.push("");
    parts.push("_(Candidate submitted without running the code.)_");
  }
  return parts.join("\n");
}
