/**
 * The question cycle makes one promise: you get every question in a group before
 * you get any of them twice, and then it starts over. These tests are that
 * promise written down — including the awkward cases (a pool that grows or
 * shrinks between rounds, a pool smaller than the round, questions blocked by the
 * rest of the loop) where an off-by-one quietly hands someone a repeat, and the
 * fairness check that catches a ring which favours the top of the pool.
 *
 * `pickFromPool` is the pure core on purpose: `safeLocalStorage` no-ops outside a
 * browser, so the storage wrapper can't be exercised here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickFromPool, questionGroupKey } from "./question-cycle";
import { normalizeQuestion } from "./loop-runs";

const POOL = ["Q one", "Q two", "Q three", "Q four", "Q five"];

/** Run `rounds` rounds of `count` questions, threading the cursor through. */
function runCycle(
  pool: string[],
  count: number,
  rounds: number,
  blocked: string[] = []
): { rounds: string[][]; wraps: number } {
  let after: string | undefined;
  const out: string[][] = [];
  let wraps = 0;
  for (let i = 0; i < rounds; i++) {
    const r = pickFromPool({ pool, after, count, blocked });
    out.push(r.questions);
    after = r.cursor;
    if (r.wrapped) wraps++;
  }
  return { rounds: out, wraps };
}

describe("pickFromPool", () => {
  it("starts at the top of the pool and takes it in order", () => {
    const r = pickFromPool({ pool: POOL, count: 2 });
    assert.deepEqual(r.questions, ["Q one", "Q two"]);
    assert.equal(r.cursor, "q two");
    assert.equal(r.wrapped, false);
  });

  it("carries on from the last question you were asked", () => {
    const first = pickFromPool({ pool: POOL, count: 2 });
    const second = pickFromPool({ pool: POOL, after: first.cursor, count: 2 });
    assert.deepEqual(second.questions, ["Q three", "Q four"]);
    assert.equal(
      first.questions.filter((q) => second.questions.includes(q)).length,
      0,
      "consecutive rounds must not overlap"
    );
  });

  it("asks every question in the group before repeating any", () => {
    // 5 questions, 2 per round: the first five asked should be the whole pool.
    const { rounds } = runCycle(POOL, 2, 3);
    const firstFive = rounds.flat().slice(0, 5);
    assert.deepEqual([...firstFive].sort(), [...POOL].sort());
  });

  it("comes back round to the top once the pool is used up", () => {
    const { rounds, wraps } = runCycle(POOL, 2, 4);
    assert.deepEqual(rounds[2], ["Q five", "Q one"], "rolls over mid-round");
    assert.deepEqual(rounds[3], ["Q two", "Q three"]);
    assert.equal(wraps, 1, "one lap completed in the first eight questions");
  });

  it("never repeats inside a single round, even across a wrap", () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const { rounds } = runCycle(POOL, count, 6);
      for (const round of rounds) {
        assert.equal(
          new Set(round).size,
          round.length,
          `count=${count}: a round asked the same question twice`
        );
      }
    }
  });

  it("asks every question equally often, however the round divides the pool", () => {
    // A ring that restarted at the top on every lap would ask question 1 twice
    // as often as the rest. Sizes chosen so the round divides the pool evenly,
    // and so it doesn't.
    for (const size of [4, 5, 6, 7, 9]) {
      const pool = Array.from({ length: size }, (_, i) => `Q${i + 1}`);
      for (const count of [1, 2, 3, 4]) {
        const { rounds } = runCycle(pool, count, 60);
        for (const r of rounds) {
          assert.equal(r.length, count, `pool=${size} count=${count}: short round`);
        }
        const counts = new Map<string, number>();
        for (const q of rounds.flat()) counts.set(q, (counts.get(q) ?? 0) + 1);
        assert.equal(
          counts.size,
          size,
          `pool=${size} count=${count}: some question was never asked`
        );
        const times = [...counts.values()];
        assert.ok(
          Math.max(...times) - Math.min(...times) <= 1,
          `pool=${size} count=${count}: uneven ${JSON.stringify([...counts])}`
        );
      }
    }
  });

  it("reports the wrap when a round lands exactly on the end of the pool", () => {
    // Two rounds of 2 from a pool of 4 finish a lap without rolling over
    // mid-round; the round after that is the new lap and should say so.
    const first = pickFromPool({ pool: POOL.slice(0, 4), count: 2 });
    const second = pickFromPool({
      pool: POOL.slice(0, 4),
      after: first.cursor,
      count: 2,
    });
    assert.equal(second.wrapped, false);
    const third = pickFromPool({
      pool: POOL.slice(0, 4),
      after: second.cursor,
      count: 2,
    });
    assert.deepEqual(third.questions, ["Q one", "Q two"]);
    assert.equal(third.wrapped, true);
  });

  it("treats a pool smaller than the round as short, not finished", () => {
    const r = pickFromPool({ pool: ["only one"], count: 4 });
    assert.deepEqual(r.questions, ["only one"]);
    assert.equal(r.wrapped, false, "one question is not a completed lap");
  });

  it("returns nothing for an empty pool instead of claiming a wrap", () => {
    // An empty pool is what sends the round to the AI to generate; saying
    // "you've seen everything" there would be a lie.
    const r = pickFromPool({ pool: [], count: 3 });
    assert.deepEqual(r.questions, []);
    assert.equal(r.wrapped, false);
  });

  it("steps over questions already asked elsewhere in the loop", () => {
    const r = pickFromPool({
      pool: POOL,
      count: 2,
      blocked: [normalizeQuestion("Q two")],
    });
    assert.deepEqual(r.questions, ["Q one", "Q three"]);
  });

  it("leaves a blocked question next in line rather than burning it", () => {
    // Q three was unavailable last round because another round had just asked
    // it; it should still be waiting, not skipped for the whole lap.
    const blockedRound = pickFromPool({
      pool: POOL,
      count: 2,
      blocked: [normalizeQuestion("Q two")],
    });
    const next = pickFromPool({ pool: POOL, after: blockedRound.cursor, count: 2 });
    assert.deepEqual(next.questions, ["Q four", "Q five"]);
    assert.equal(
      blockedRound.cursor,
      "q three",
      "the cursor sits on the last question actually handed out"
    );
  });

  it("does not stall or move when the whole pool is blocked", () => {
    const r = pickFromPool({
      pool: POOL,
      after: "q two",
      count: 2,
      blocked: POOL.map(normalizeQuestion),
    });
    assert.deepEqual(r.questions, [], "blocked means blocked");
    assert.equal(r.cursor, "q two", "the cursor must not drift");
    assert.equal(r.wrapped, false);
  });

  it("matches questions loosely, so punctuation can't sneak a repeat past it", () => {
    const r = pickFromPool({
      pool: ["Design a URL shortener.", "Q two"],
      after: normalizeQuestion("design a url shortener"),
      count: 1,
    });
    assert.deepEqual(r.questions, ["Q two"], "same question, different casing");
  });

  it("collapses duplicates in the pool", () => {
    const r = pickFromPool({ pool: ["Q one", "Q one.", "Q two"], count: 2 });
    assert.deepEqual(r.questions, ["Q one", "Q two"]);
  });

  it("picks up new questions that appeared since last round", () => {
    // The bank grows between rounds; a question added at the end is simply next.
    const r = pickFromPool({
      pool: [...POOL, "Q six"],
      after: normalizeQuestion("Q five"),
      count: 1,
    });
    assert.deepEqual(r.questions, ["Q six"]);
  });

  it("starts from the top when the last question has left the pool", () => {
    const r = pickFromPool({ pool: POOL, after: "q gone", count: 2 });
    assert.deepEqual(r.questions, ["Q one", "Q two"]);
    assert.equal(r.wrapped, false, "a vanished cursor is not a completed lap");
  });
});

describe("questionGroupKey", () => {
  it("separates the same round at different levels and difficulties", () => {
    const analyst = questionGroupKey({
      kind: "sql_data",
      difficulty: "easy",
      roleLevel: "Data Analyst (Mid)",
    });
    const engineer = questionGroupKey({
      kind: "sql_data",
      difficulty: "hard",
      roleLevel: "Senior Data Engineer",
    });
    assert.notEqual(analyst, engineer);
    assert.equal(analyst, "data-analyst-mid/sql-data/easy");
  });

  it("gives a company-targeted run its own track", () => {
    const parts = { kind: "coding", difficulty: "medium", roleLevel: "Senior SWE" };
    assert.notEqual(
      questionGroupKey(parts),
      questionGroupKey({ ...parts, companyId: "abc-123" })
    );
  });

  it("is stable across two loops of the same role, so progress carries", () => {
    const parts = {
      kind: "behavioral",
      difficulty: "medium",
      roleLevel: "Product Manager",
    };
    assert.equal(questionGroupKey(parts), questionGroupKey({ ...parts }));
  });
});
