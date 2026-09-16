import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import { setSyncedItem } from "@/lib/sync/kv";

/**
 * Per-file "use globally" selection. A selected (enabled) file is used
 * everywhere — conversation recall, references, and prompt context. Files are
 * enabled by default; only explicit opt-outs are stored (source -> false).
 */
export const FILE_SELECTION_EVENT = "channelpulse-file-selection-changed";

function readMap(): Record<string, boolean> {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.FILE_SELECTION);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, boolean>): void {
  // Synced across devices (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.FILE_SELECTION, JSON.stringify(map));
  try {
    window.dispatchEvent(new CustomEvent(FILE_SELECTION_EVENT));
  } catch {
    // no-op
  }
}

/** A file is used globally unless explicitly turned off. */
export function isFileEnabled(source: string): boolean {
  return readMap()[source] !== false;
}

export function setFileEnabled(source: string, enabled: boolean): void {
  const map = readMap();
  if (enabled) delete map[source];
  else map[source] = false;
  writeMap(map);
}

/** File sources the user has turned OFF (excluded from global use). */
export function getDisabledFileSources(): string[] {
  const map = readMap();
  return Object.keys(map).filter((k) => map[k] === false);
}
