/**
 * Where you're up to in each group of questions.
 *
 * The whole rule, and there is only one: a group's questions are a ring, and we
 * remember the last one you were asked. The next round carries on from there and
 * comes back round to the top when it runs off the end. So you get every
 * question in a group before you get any of them twice, every question comes up
 * equally often, and "have I done this round?" has an actual answer.
 *
 * That's all the state there is: one question per group. No shuffling, no
 * per-question bookkeeping to fall out of sync, and nothing to reset when a lap
 * finishes — running off the end IS the reset.
 *
 * A "group" is one section for one kind of candidate — the round, its
 * difficulty, the role level, and the target company when there is one. The SQL
 * round of a mid-level data analyst loop is a different group from the SQL round
 * of a senior data engineer loop, because those are different questions at
 * different difficulty. Retaking a round, or starting a second loop for the same
 * role, carries on down the ring instead of rolling dice again.
 *
 * The cursor lives in localStorage (same best-effort posture as `loop-runs.ts`):
 * a storage failure must never break an interview in flight, it just means the
 * round starts from the top of the ring.
 */

import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem, removeSyncedItem } from "@/lib/sync/kv";
import { normalizeQuestion } from "./loop-runs";

/** groupKey -> normalized key of the last question asked in that group. */
type CycleStore = Record<string, string>;

/** Cap on remembered groups, far above the number of role/round combinations. */
const MAX_GROUPS = 300;

// ── The group key ────────────────────────────────────────────────────────────

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The identity of one ring of questions. Everything that changes *which*
 * questions are in the ring belongs in here, and nothing else does — put the
 * blueprint id in and every new loop would restart the same round from the top,
 * which is the opposite of the point.
 */
export function questionGroupKey(parts: {
  /** The round, e.g. "sql_data" — `LoopStage.kind`. */
  kind: string;
  /** The round's difficulty: the same round is a different ring at "hard". */
  difficulty: string;
  /** The role and level being interviewed for. */
  roleLevel: string;
  /** Set only when the run targets a company — that ring is its own track. */
  companyId?: string;
}): string {
  const base = [slug(parts.roleLevel), slug(parts.kind), slug(parts.difficulty)];
  if (parts.companyId) base.push(`co-${slug(parts.companyId)}`);
  return base.join("/");
}

// ── Picking (pure — this is the part worth testing) ───────────────────────────

export interface PickResult {
  /** The questions to ask, in ring order from where the last round stopped. */
  questions: string[];
  /**
   * Normalized key of the last question handed out, i.e. where the next round
   * starts. Unchanged from `after` when nothing could be picked.
   */
  cursor?: string;
  /** True when this round came back round to the top of the ring. */
  wrapped: boolean;
}

/** Drop blanks and duplicates, so ring positions mean one question each. */
function uniquePool(pool: string[]): { text: string; key: string }[] {
  const seen = new Set<string>();
  const out: { text: string; key: string }[] = [];
  for (const text of pool) {
    const key = normalizeQuestion(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, key });
  }
  return out;
}

/**
 * Take the next `count` questions from `pool`, starting after `after`.
 *
 * Deterministic on purpose: the same ring in the same position gives the same
 * questions, which is what makes "I've worked through this round" a fact rather
 * than a guess.
 *
 * `blocked` is for questions that are off-limits right now but shouldn't be
 * skipped over for good — in practice, the ones already asked earlier in the same
 * loop, so two rounds with overlapping pools can't ask the same thing twice in
 * one sitting. A blocked question doesn't move the cursor past itself, so it's
 * first in line next time.
 */
export function pickFromPool(params: {
  pool: string[];
  /** Normalized key of the last question asked in this group, if any. */
  after?: string;
  count: number;
  /** Normalized keys to step over without consuming them. */
  blocked?: string[];
}): PickResult {
  const { count } = params;
  const pool = uniquePool(params.pool);
  if (!pool.length || count <= 0) {
    return { questions: [], cursor: params.after, wrapped: false };
  }

  const blocked = new Set(params.blocked ?? []);
  const at = params.after ? pool.findIndex((p) => p.key === params.after) : -1;
  // Off the end of the ring, or a cursor whose question has since left the pool
  // — either way, start at the top.
  const start = at >= 0 ? (at + 1) % pool.length : 0;
  // Rolling to the top of a ring we've been round before IS the wrap.
  let wrapped = at >= 0 && start === 0;

  const questions: string[] = [];
  let cursor = params.after;
  for (let n = 0; n < pool.length && questions.length < count; n++) {
    const i = (start + n) % pool.length;
    const entry = pool[i];
    if (blocked.has(entry.key)) continue;
    if (i < start) wrapped = true;
    questions.push(entry.text);
    cursor = entry.key;
  }

  return { questions, cursor, wrapped: wrapped && questions.length > 0 };
}

// ── Storage ──────────────────────────────────────────────────────────────────

function readStore(): CycleStore {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.INTERVIEW_QUESTION_CYCLE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CycleStore;
  } catch {
    return {};
  }
}

function writeStore(store: CycleStore): void {
  try {
    // Insertion order is oldest first, so trimming drops the stalest groups.
    const entries = Object.entries(store).slice(-MAX_GROUPS);
    // Synced across devices + the web app (see src/lib/sync/kv.ts).
    setSyncedItem(
      STORAGE_KEYS.INTERVIEW_QUESTION_CYCLE,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // best-effort
  }
}

/**
 * Pick the next questions for a group AND move its cursor past them.
 *
 * Moving the cursor here rather than when the round starts is deliberate: a round
 * that gets drawn and then abandoned has still shown you its questions, and it
 * costs nothing — they come back on the next lap.
 */
export function drawFromGroup(params: {
  group: string;
  pool: string[];
  count: number;
  blocked?: string[];
}): PickResult {
  const store = readStore();
  const result = pickFromPool({
    pool: params.pool,
    after: store[params.group],
    count: params.count,
    blocked: params.blocked,
  });
  if (result.questions.length && result.cursor) {
    writeStore({ ...store, [params.group]: result.cursor });
  }
  return result;
}

/** How far round the ring you are — for "4 of 11" in the UI. */
export function groupProgress(
  group: string,
  pool: string[]
): { position: number; total: number } {
  const entries = uniquePool(pool);
  const cursor = readStore()[group];
  const at = cursor ? entries.findIndex((p) => p.key === cursor) : -1;
  return { position: at + 1, total: entries.length };
}

/** Send a group back to the top of the ring by hand. */
export function resetGroup(group: string): void {
  const store = readStore();
  if (!(group in store)) return;
  delete store[group];
  writeStore(store);
}

/** Forget every group. */
export function resetAllGroups(): void {
  // Synced across devices + the web app (see src/lib/sync/kv.ts).
  removeSyncedItem(STORAGE_KEYS.INTERVIEW_QUESTION_CYCLE);
}
