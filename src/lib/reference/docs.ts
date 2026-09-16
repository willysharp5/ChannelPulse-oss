import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { ensureFormattedDocumentBody } from "@/lib/memory";
import {
  getMemoriesBySource,
  listMemorySources,
} from "@/lib/database/memory.action";

/**
 * Reference docs are just the user's Files (uploads + research) seen from the
 * overlay: the same sources Settings → Files manages, read-only, so a resume or
 * a set of notes can be kept on screen while a conversation is being recorded.
 * Nothing new is stored — this reads the exact two places Files writes to.
 */
export type ReferenceDoc = {
  /** Stable id of the memory source (also the localStorage body key). */
  source: string;
  /** Human label — the original filename or research query. */
  label: string;
  /** Uploaded file vs. a Firecrawl research doc. */
  origin: "upload" | "research";
  /** Retrieval chunks, used only as a rough "size" hint. */
  chunks: number;
  createdAt: number;
};

export function getReferenceDocOrigin(source: string): "upload" | "research" {
  return source.startsWith("research:") ? "research" : "upload";
}

/** Every file the user has added, newest first. */
export async function listReferenceDocs(): Promise<ReferenceDoc[]> {
  const sources = await listMemorySources(null, true);
  return sources
    .filter((s) => s.kind === "file")
    .map((s) => ({
      source: s.source,
      label: s.source_label || s.source,
      origin: getReferenceDocOrigin(s.source),
      chunks: s.chunks,
      createdAt: s.created_at,
    }));
}

/**
 * Full text of a doc. Prefers the saved markdown body (what Files view/edit
 * shows), re-reading the original file first if it was formatted by an older
 * version of the formatter; falls back to stitching the retrieval chunks for
 * older entries that were ingested before bodies were kept.
 */
export async function loadReferenceDoc(source: string): Promise<string> {
  const body = await ensureFormattedDocumentBody(source);
  if (body) return body;
  const rows = await getMemoriesBySource(source);
  return rows
    .map((r) => r.content)
    .filter(Boolean)
    .join("\n\n");
}

/** The doc the overlay had open last, so reopening lands where you left off. */
export function readLastReferenceDoc(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEYS.REFERENCE_LAST_DOC) || null;
}

export function writeLastReferenceDoc(source: string | null): void {
  if (!source) {
    safeLocalStorage.removeItem(STORAGE_KEYS.REFERENCE_LAST_DOC);
    return;
  }
  safeLocalStorage.setItem(STORAGE_KEYS.REFERENCE_LAST_DOC, source);
}
