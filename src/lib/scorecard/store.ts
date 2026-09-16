import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { removeSyncedItem, setSyncedItem } from "@/lib/sync/kv";
import type { Scorecard, ScorecardRecord } from "./types";

/**
 * Caches generated scorecards so re-opening a conversation is instant and
 * doesn't re-spend a grading call. Same shape of storage as
 * lib/interview/results.ts — localStorage for reads, best-effort, no migration.
 *
 * Writes go through setSyncedItem, so grades follow the account: the
 * conversations themselves already sync, and a scorecard that stayed on the
 * machine that produced it meant the phone showed a graded meeting as ungraded
 * and paid to grade it again. Merge is last-writer-wins on the whole map, same
 * as INTERVIEW_RESULTS — grading the same conversation on two devices at once
 * can drop one of the two records, which costs a regenerate and nothing else.
 *
 * Each record carries the fingerprint of the conversation it was graded from
 * (see fingerprintConversation), so a conversation that has since grown is
 * reported as stale rather than shown as current.
 */

/** Keep the newest N; a scorecard is a few KB and this is localStorage. */
const MAX_RECORDS = 50;

type ScorecardMap = Record<string, ScorecardRecord>;

function readAll(): ScorecardMap {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.CONVERSATION_SCORECARDS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ScorecardMap;
  } catch {
    return {};
  }
}

function writeAll(map: ScorecardMap): void {
  try {
    const entries = Object.entries(map)
      .sort((a, b) => b[1].generatedAt - a[1].generatedAt)
      .slice(0, MAX_RECORDS);
    if (entries.length === 0) {
      // Tombstone rather than store "{}", so an emptied map propagates instead
      // of losing to whatever the other device still has.
      removeSyncedItem(STORAGE_KEYS.CONVERSATION_SCORECARDS);
      return;
    }
    setSyncedItem(
      STORAGE_KEYS.CONVERSATION_SCORECARDS,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // best-effort
  }
}

export function readScorecard(conversationId: string): ScorecardRecord | null {
  const record = readAll()[conversationId];
  return record?.scorecard ? record : null;
}

/** Every cached scorecard, for badging the conversation list. */
export function readAllScorecards(): ScorecardMap {
  return readAll();
}

export function writeScorecard(input: {
  conversationId: string;
  scorecard: Scorecard;
  fingerprint: string;
}): ScorecardRecord {
  const record: ScorecardRecord = {
    conversationId: input.conversationId,
    scorecard: input.scorecard,
    generatedAt: Date.now(),
    fingerprint: input.fingerprint,
  };
  const map = readAll();
  map[input.conversationId] = record;
  writeAll(map);
  return record;
}

export function clearScorecard(conversationId: string): void {
  const map = readAll();
  if (!(conversationId in map)) return;
  delete map[conversationId];
  writeAll(map);
}
