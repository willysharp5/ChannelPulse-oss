import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";

/**
 * Pinned reference lines — the 1-3 bullets someone wants on screen even with
 * the reference rail closed (a headline metric, the exact job title, a date).
 *
 * The block id alone isn't a durable key: re-ingesting a doc renumbers blocks.
 * So a pin carries its own text and is identified by `${source}::${text}`,
 * which means a pin survives edits elsewhere in the doc and de-dupes naturally.
 */
export type ReferencePin = {
  source: string;
  docLabel: string;
  text: string;
  pinnedAt: number;
};

/** Keep the strip glanceable — the oldest pin drops off past this. */
export const MAX_REFERENCE_PINS = 6;

export function pinKey(source: string, text: string): string {
  return `${source}::${text.trim()}`;
}

export function readReferencePins(): ReferencePin[] {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.REFERENCE_PINS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ReferencePin =>
        !!p &&
        typeof p.source === "string" &&
        typeof p.text === "string" &&
        !!p.text.trim()
    );
  } catch {
    return [];
  }
}

function writeReferencePins(pins: ReferencePin[]): void {
  // Synced across devices (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.REFERENCE_PINS, JSON.stringify(pins));
}

/** Add a pin (no-op when already pinned). Returns the new list. */
export function addReferencePin(
  pin: Omit<ReferencePin, "pinnedAt">
): ReferencePin[] {
  const text = pin.text.trim();
  if (!text) return readReferencePins();
  const key = pinKey(pin.source, text);
  const existing = readReferencePins();
  if (existing.some((p) => pinKey(p.source, p.text) === key)) return existing;
  const next = [...existing, { ...pin, text, pinnedAt: Date.now() }].slice(
    -MAX_REFERENCE_PINS
  );
  writeReferencePins(next);
  return next;
}

export function removeReferencePin(
  source: string,
  text: string
): ReferencePin[] {
  const key = pinKey(source, text);
  const next = readReferencePins().filter(
    (p) => pinKey(p.source, p.text) !== key
  );
  writeReferencePins(next);
  return next;
}

/** Pin if absent, unpin if present — what the per-block pin button calls. */
export function toggleReferencePin(
  pin: Omit<ReferencePin, "pinnedAt">
): ReferencePin[] {
  const key = pinKey(pin.source, pin.text);
  const existing = readReferencePins();
  return existing.some((p) => pinKey(p.source, p.text) === key)
    ? removeReferencePin(pin.source, pin.text)
    : addReferencePin(pin);
}

export function clearReferencePins(): ReferencePin[] {
  writeReferencePins([]);
  return [];
}
