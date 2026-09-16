/**
 * Every SQL question in `loops.ts` has to have data behind it. A question whose
 * answer is an empty result set, a 100% funnel or a mean that equals the median
 * teaches nothing, and the candidate can't tell whether their query is wrong or
 * the database is empty.
 *
 * So: one test per SQL question, asserting the *shape* the question needs. Add a
 * SQL question that needs a new shape → add the rows → add the assertion here.
 *
 *   npm run test:sql-fixtures
 *
 * Runs on `node:sqlite` rather than the app's sql.js, because this is about the
 * data, not the sandbox. (The sandbox itself is exercised against real sql.js.)
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { before, describe, it } from "node:test";
import { SQL_FIXTURE_SQL } from "./sql-fixtures";

let db: DatabaseSync;

/** First column of the first row, as a number. */
function num(sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  return Number(Object.values(row ?? {})[0]);
}

function rows(sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

before(() => {
  db = new DatabaseSync(":memory:");
  db.exec(SQL_FIXTURE_SQL);
});

describe("sql fixtures: the data behind every SQL question", () => {
  it("loads, and nothing is dated in the future", () => {
    assert.ok(num("SELECT COUNT(*) FROM users") > 100, "too few users to cohort");
    assert.equal(num("SELECT COUNT(*) FROM orders WHERE created_at > datetime('now')"), 0);
    assert.equal(num("SELECT COUNT(*) FROM events WHERE ts > datetime('now')"), 0);
    assert.equal(
      num("SELECT COUNT(*) FROM events WHERE ingested_at > datetime('now')"),
      0,
      "an event can't be ingested in the future"
    );
    assert.equal(num("SELECT COUNT(*) FROM sessions WHERE started_at > datetime('now')"), 0);
    assert.equal(
      num("SELECT COUNT(*) FROM sessions WHERE ended_at > datetime('now')"),
      0,
      "a session that ends in the future hasn't ended; ended_at should be NULL"
    );
    assert.equal(
      num("SELECT COUNT(*) FROM subscriptions WHERE started_at > date('now') OR ended_at > date('now')"),
      0,
      "a future-dated subscription breaks month-over-month retention"
    );
  });

  it("daily revenue with gaps: most days have orders, a few have none", () => {
    const populated = num(
      "SELECT COUNT(DISTINCT date(created_at)) FROM orders WHERE created_at >= datetime('now','-29 days')"
    );
    assert.ok(populated >= 24, `only ${populated} of the last 30 days have orders`);
    assert.ok(
      populated <= 28,
      "no empty days left, so gap-filling has nothing to catch"
    );
  });

  it("daily revenue: statuses to exclude and NULL amounts to trip over", () => {
    assert.ok(num("SELECT COUNT(*) FROM orders WHERE status = 'cancelled'") > 10);
    assert.ok(num("SELECT COUNT(*) FROM orders WHERE status = 'refunded'") > 10);
    assert.ok(
      num("SELECT COUNT(*) FROM orders WHERE amount IS NULL") > 5,
      "no NULL amounts, so SUM/AVG/COUNT(col) all agree and the trap is gone"
    );
  });

  it("7-day retention by cohort: cohorts big enough to average, and a rate that isn't 0% or 100%", () => {
    const smallest = num(
      "SELECT MIN(n) FROM (SELECT COUNT(*) n FROM users GROUP BY strftime('%Y-%m', signup_date))"
    );
    assert.ok(smallest >= 5, `smallest monthly cohort is ${smallest} users`);
    const retained = num(`
      SELECT COUNT(*) FROM users u WHERE EXISTS (
        SELECT 1 FROM events e WHERE e.user_id = u.id
          AND e.ts >= datetime(u.signup_date, '+7 days')
          AND e.ts <  datetime(u.signup_date, '+8 days'))`);
    const total = num("SELECT COUNT(*) FROM users");
    assert.ok(retained > 10 && retained < total, `d7 retained ${retained}/${total}`);
  });

  it("top N per country: a real tie inside the top 3, so RANK vs ROW_NUMBER matters", () => {
    const tied = rows(`
      WITH rev AS (
        SELECT u.country, u.id, SUM(o.amount) r,
               RANK() OVER (PARTITION BY u.country ORDER BY SUM(o.amount) DESC) rk
        FROM users u JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
        GROUP BY u.country, u.id)
      SELECT country, rk, COUNT(*) n FROM rev WHERE rk <= 3 GROUP BY country, rk HAVING COUNT(*) > 1`);
    assert.ok(tied.length >= 1, "no tie in any country's top 3");
  });

  it("overlapping sessions: pairs to find, and open sessions to decide about", () => {
    const pairs = num(`
      SELECT COUNT(*) FROM sessions a JOIN sessions b
        ON a.user_id = b.user_id AND a.rowid < b.rowid
       AND a.started_at < COALESCE(b.ended_at, datetime('now'))
       AND b.started_at < COALESCE(a.ended_at, datetime('now'))`);
    assert.ok(pairs > 20, `only ${pairs} overlapping pairs`);
    assert.ok(num("SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL") > 3);
  });

  it("join fan-out: joining a one-to-many table visibly inflates revenue", () => {
    const truth = num("SELECT SUM(amount) FROM orders WHERE status = 'paid'");
    const inflated = num(`
      SELECT SUM(o.amount) FROM orders o
      JOIN subscriptions s ON s.user_id = o.user_id WHERE o.status = 'paid'`);
    assert.ok(
      inflated > truth * 1.1,
      `fan-out only inflates revenue by ${Math.round((inflated / truth - 1) * 100)}%`
    );
  });

  it("28-day active users: not everyone is active, and DAU is well below MAU", () => {
    const mau = num("SELECT COUNT(DISTINCT user_id) FROM events WHERE ts >= datetime('now','-28 days')");
    const total = num("SELECT COUNT(*) FROM users");
    const dau = num("SELECT COUNT(DISTINCT user_id) FROM events WHERE date(ts) = date('now','-1 day')");
    assert.ok(mau < total, "every user is active, so churn queries have no signal");
    assert.ok(dau > 0 && dau < mau / 2, `dau=${dau} mau=${mau}`);
  });

  it("net revenue retention: several months, upgrades AND downgrades, and churn with no return", () => {
    assert.ok(
      num("SELECT COUNT(DISTINCT strftime('%Y-%m', started_at)) FROM subscriptions") >= 5,
      "not enough months for a month-over-month query"
    );
    const move = (cmp: string) => num(`
      SELECT COUNT(*) FROM subscriptions s
      JOIN subscriptions t ON t.user_id = s.user_id AND t.started_at > s.started_at
      JOIN plans p1 ON p1.name = s.plan JOIN plans p2 ON p2.name = t.plan
      WHERE p2.monthly_price ${cmp} p1.monthly_price`);
    assert.ok(move(">") > 0, "no expansion: NRR can never exceed 100%");
    assert.ok(move("<") > 0, "no contraction: NRR is just growth");
    assert.ok(
      num(`SELECT COUNT(*) FROM (SELECT user_id FROM subscriptions GROUP BY user_id
             HAVING SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) = 0)`) > 0,
      "nobody churned for good"
    );
  });

  it("median vs mean: users.segment exists, and one segment's mean is far above its median", () => {
    assert.equal(
      num("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'segment'"),
      1,
      "no users.segment, so 'median order value per segment' cannot be answered"
    );
    const skew = num(`
      WITH o AS (
        SELECT u.segment seg, o.amount amt FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.amount IS NOT NULL AND o.status = 'paid'),
      r AS (SELECT seg, amt, ROW_NUMBER() OVER (PARTITION BY seg ORDER BY amt) rn,
                   COUNT(*) OVER (PARTITION BY seg) c FROM o)
      SELECT MAX(mean / median) FROM (
        SELECT o.seg, AVG(o.amt) mean,
               (SELECT AVG(amt) FROM r WHERE r.seg = o.seg AND rn IN ((c+1)/2, (c+2)/2)) median
        FROM o GROUP BY o.seg)`);
    assert.ok(skew > 3, `mean is only ${skew.toFixed(2)}x the median; the average isn't misleading anyone`);
  });

  it("dedup: redelivered rows share an event_id and differ on ingested_at", () => {
    const total = num("SELECT COUNT(*) FROM events");
    const distinct = num("SELECT COUNT(DISTINCT event_id) FROM events");
    assert.ok(total > distinct, "no duplicates to deduplicate");
    assert.ok(
      num("SELECT COUNT(*) FROM (SELECT event_id FROM events GROUP BY event_id HAVING COUNT(DISTINCT ingested_at) > 1)") > 20,
      "duplicates are indistinguishable, so there's no key to choose"
    );
  });

  it("funnel: signup → activated → first purchase in 7 days drops off at every step", () => {
    const signed = num("SELECT COUNT(*) FROM users");
    const activated = num("SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'activated'");
    const purchased7d = num(`
      SELECT COUNT(DISTINCT u.id) FROM users u
      JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
       AND o.created_at >= u.signup_date
       AND o.created_at <  datetime(u.signup_date, '+7 days')`);
    const purchasedEver = num(`
      SELECT COUNT(DISTINCT u.id) FROM users u
      JOIN orders o ON o.user_id = u.id AND o.created_at >= u.signup_date`);
    assert.ok(activated < signed, "everyone activates, so step 2 of the funnel is flat");
    assert.ok(purchased7d < activated, "everyone who activated bought, so step 3 is flat");
    assert.ok(purchased7d > 20, `only ${purchased7d} users bought within 7 days`);
    assert.ok(
      purchasedEver > purchased7d + 20,
      "the 7-day attribution window makes no difference to the answer"
    );
  });

  it("slow-query diagnosis: indexes exist, so EXPLAIN QUERY PLAN says something", () => {
    const idx = rows("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
    assert.ok(idx.length >= 3, `only ${idx.length} indexes`);
  });

  it("weekly active users: at least four weeks of activity to chart", () => {
    assert.ok(
      num("SELECT COUNT(DISTINCT strftime('%Y-%W', ts)) FROM events WHERE ts >= datetime('now','-28 days')") >= 4
    );
  });
});
