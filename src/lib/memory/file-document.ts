import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { setSyncedItem } from "@/lib/sync/kv";
import { structureDocumentText } from "./document-text";

/**
 * Full markdown bodies for Files entries (uploads + research). Chunks in SQLite
 * are for retrieval; this map is what Quill view/edit uses so formatting stays
 * intact and overlapping chunks don't corrupt the document.
 */

/**
 * Bumped whenever `structureDocumentText` learns to format something better.
 * Bodies stored under an older version are re-read from the original file on
 * next open (see `ensureFormattedDocumentBody`) — the improvement can't be
 * applied to the stored text, because the line breaks it needs are already gone.
 */
export const DOC_FORMAT_VERSION = 2;

function readMap(): Record<string, string> {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.FILE_DOCUMENT_BODIES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readVersions(): Record<string, number> {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.FILE_DOCUMENT_FORMAT);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVersions(map: Record<string, number>): void {
  // Synced across devices alongside the bodies (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.FILE_DOCUMENT_FORMAT, JSON.stringify(map));
}

/** 0 for anything stored before versioning existed. */
export function getFileDocumentFormat(source: string): number {
  const v = readVersions()[source];
  return typeof v === "number" ? v : 0;
}

function writeMap(map: Record<string, string>): void {
  // Synced across devices (see src/lib/sync/kv.ts).
  setSyncedItem(STORAGE_KEYS.FILE_DOCUMENT_BODIES, JSON.stringify(map));
}

export function getFileDocumentBody(source: string): string | null {
  const v = readMap()[source];
  return typeof v === "string" && v.trim() ? v : null;
}

export function setFileDocumentBody(source: string, markdown: string): void {
  const map = readMap();
  const md = (markdown || "").trim();
  const versions = readVersions();
  if (!md) {
    delete map[source];
    delete versions[source];
  } else {
    map[source] = md;
    // Anything written here came through `toQuillMarkdown`, so it's current.
    versions[source] = DOC_FORMAT_VERSION;
  }
  writeMap(map);
  writeVersions(versions);
}

export function clearFileDocumentBody(source: string): void {
  const map = readMap();
  const versions = readVersions();
  if (source in versions) {
    delete versions[source];
    writeVersions(versions);
  }
  if (!(source in map)) return;
  delete map[source];
  writeMap(map);
}

/**
 * Normalize plain/crawled text into readable markdown: headings, nested lists,
 * clean paragraphs.
 *
 * The real work lives in `structureDocumentText` (see `document-text.ts`). This
 * used to join every line of a block with a space, which flattened uploaded
 * resumes — all headings, entries and bullets — into a single unreadable
 * paragraph. Kept as a name because it's the ingest entry point everywhere.
 */
export function toQuillMarkdown(text: string): string {
  return structureDocumentText(text);
}
