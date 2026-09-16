import { invoke } from "@tauri-apps/api/core";
import { embedTexts } from "./embeddings";
import { insertMemories, deleteMemoriesBySource } from "@/lib/database/memory.action";
import {
  clearFileDocumentBody,
  getFileDocumentBody,
  getFileDocumentFormat,
  setFileDocumentBody,
  toQuillMarkdown,
  DOC_FORMAT_VERSION,
} from "./file-document";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_FILE = 200;

/** Split text into overlapping chunks suitable for embedding. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export interface IngestResult {
  path: string;
  label: string;
  chunks: number;
  error?: string;
}

/**
 * Return a doc's body, re-reading it from the original file first if it was
 * formatted by an older version of `structureDocumentText`.
 *
 * Formatting improvements can't be applied retroactively to a stored body: it's
 * already been collapsed, and the line breaks the formatter reasons about are
 * gone. The only real fix is to read the file again — which is cheap, local, and
 * needs no network, so callers that display a doc just do it on open.
 *
 * Only the display body is refreshed. Retrieval chunks keep their old text,
 * because whitespace barely moves an embedding and re-embedding would cost an
 * API round trip per file. A full re-chunk is what the Re-import button is for.
 */
export async function ensureFormattedDocumentBody(
  source: string
): Promise<string | null> {
  const existing = getFileDocumentBody(source);
  if (getFileDocumentFormat(source) >= DOC_FORMAT_VERSION) return existing;
  // Research briefings have no file on disk; their markdown passes through the
  // formatter untouched anyway.
  if (source.startsWith("research:")) return existing;

  try {
    const raw = await invoke<string>("read_file_text", { path: source });
    const text = toQuillMarkdown(raw);
    if (!text.trim()) return existing;
    setFileDocumentBody(source, text);
    return text;
  } catch (err) {
    // Moved, renamed, or on an unplugged drive. Show what we have and leave the
    // version unstamped so a later open tries again.
    console.warn("Couldn't re-read file for formatting:", source, err);
    return existing;
  }
}

/**
 * Read a local file's text, chunk + embed it, and store the chunks as
 * "file" memories scoped to `sessionId` (null = global). Re-ingesting the same
 * path replaces its prior chunks.
 */
export async function ingestFile(
  path: string,
  sessionId: string | null = null
): Promise<IngestResult> {
  const label = baseName(path);
  try {
    const raw = await invoke<string>("read_file_text", { path });
    const text = toQuillMarkdown(raw);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return { path, label, chunks: 0, error: "File is empty or unreadable" };
    }

    const embeddings = await embedTexts(chunks);

    await deleteMemoriesBySource(path);
    await insertMemories(
      chunks.map((content, i) => ({
        kind: "file" as const,
        content,
        embedding: embeddings[i],
        source: path,
        sourceLabel: label,
        sessionId,
      }))
    );
    setFileDocumentBody(path, text);

    return { path, label, chunks: chunks.length };
  } catch (err) {
    return {
      path,
      label,
      chunks: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ingestFiles(
  paths: string[],
  sessionId: string | null = null
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const path of paths) {
    results.push(await ingestFile(path, sessionId));
  }
  return results;
}

/**
 * Index free-form text (pasted notes, crawled pages, research briefs) as a
 * "file" source the assistant can use — same retrieval path as uploads.
 * `text` should be Quill-friendly markdown when possible.
 */
export async function ingestTextDocument(params: {
  /** Stable id used as the memory source key (e.g. research:abc). */
  source: string;
  label: string;
  text: string;
  sessionId?: string | null;
}): Promise<IngestResult> {
  const { source, label, sessionId = null } = params;
  const path = source;
  const text = toQuillMarkdown(params.text);
  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return { path, label, chunks: 0, error: "Nothing to add: text was empty." };
    }
    const embeddings = await embedTexts(chunks);
    await deleteMemoriesBySource(path);
    await insertMemories(
      chunks.map((content, i) => ({
        kind: "file" as const,
        content,
        embedding: embeddings[i],
        source: path,
        sourceLabel: label,
        sessionId,
      }))
    );
    setFileDocumentBody(path, text);
    return { path, label, chunks: chunks.length };
  } catch (err) {
    return {
      path,
      label,
      chunks: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Remove indexed chunks and the Quill document body for a source. */
export async function removeFileDocument(source: string): Promise<void> {
  await deleteMemoriesBySource(source);
  clearFileDocumentBody(source);
}
