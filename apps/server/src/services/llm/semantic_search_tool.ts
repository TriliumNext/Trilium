/**
 * Semantic (embedding-based) note search tool for LLM chat.
 *
 * Unlike the tools in tools/, this tool has an async execute function
 * (network calls to the Ollama embeddings API), so it is registered directly
 * in the provider's tool set rather than through defineTools()/MCP, the same
 * way as the web search tools.
 */

import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import { becca, type BNote, getLog } from "@triliumnext/core";
import { cosineSimilarity, embedQuery, getNoteEmbeddings, getOllamaBaseUrl } from "./embeddings.js";
import { getContentPreview } from "./tools/helpers.js";

const DEFAULT_LIMIT = 8;
/** Maximum number of candidate notes embedded per search. */
const MAX_CANDIDATES = 300;

/** Note types with embeddable textual content. */
const EMBEDDABLE_TYPES = new Set(["text", "code", "mermaid", "canvas", "mindMap", "relationMap"]);

function isCandidate(note: BNote): boolean {
    return !note.isDeleted
        && EMBEDDABLE_TYPES.has(note.type)
        && !note.isProtected
        && !note.noteId.startsWith("_")
        && !note.isInHiddenSubtree();
}

/**
 * Collect candidate notes: the subtree of ancestorNoteId when given,
 * otherwise the whole (non-hidden) tree. Capped at MAX_CANDIDATES,
 * preferring the most recently modified notes.
 */
function getCandidateNotes(ancestorNoteId?: string): BNote[] | { error: string } {
    let candidates: BNote[];

    if (ancestorNoteId) {
        const ancestor = becca.getNote(ancestorNoteId);
        if (!ancestor) {
            return { error: `Note '${ancestorNoteId}' not found` };
        }
        candidates = ancestor.getSubtree({ includeArchived: false, includeHidden: false }).notes;
    } else {
        candidates = Object.values(becca.notes);
    }

    candidates = candidates.filter(isCandidate);

    if (candidates.length > MAX_CANDIDATES) {
        candidates = candidates
            .sort((a, b) => (b.utcDateModified ?? "").localeCompare(a.utcDateModified ?? ""))
            .slice(0, MAX_CANDIDATES);
    }

    return candidates;
}

/**
 * Add the semantic search tool when an Ollama provider is configured.
 * Semantic search complements the keyword-based search_notes tool for
 * "notes about X" style queries where exact terms are unknown.
 */
interface SemanticSearchArgs {
    query: string;
    ancestorNoteId?: string;
    limit?: number;
}

// Typed via the broad z.ZodType (like the tool registry does) so the schema is
// accepted regardless of which zod copy the ai package's typings resolve to.
const semanticSearchSchema = z.object({
    query: z.string().describe("Natural-language description of what to find"),
    ancestorNoteId: z.string().optional().describe("Restrict the search to the subtree of this note"),
    limit: z.number().int().min(1).max(20).optional().describe(`Maximum number of results (default ${DEFAULT_LIMIT})`)
}) as unknown as z.ZodType<SemanticSearchArgs>;

export function addSemanticSearchTool(tools: ToolSet): void {
    if (!getOllamaBaseUrl()) {
        return;
    }

    tools.semantic_search_notes = tool({
        description:
            "Find notes by meaning rather than exact keywords, using local embeddings. " +
            "Use this when the user asks about a topic and keyword search (search_notes) is unlikely to " +
            "match the exact wording, e.g. conceptual or paraphrased queries. " +
            "Returns the most semantically similar notes with content previews.",
        inputSchema: semanticSearchSchema,
        execute: async ({ query, ancestorNoteId, limit }: SemanticSearchArgs) => {
            try {
                const candidates = getCandidateNotes(ancestorNoteId);
                if (!Array.isArray(candidates)) {
                    return candidates;
                }
                if (candidates.length === 0) {
                    return { results: [] };
                }

                const [queryVector, noteVectors] = await Promise.all([
                    embedQuery(query),
                    getNoteEmbeddings(candidates)
                ]);

                const scored = candidates
                    .filter(note => noteVectors.has(note.noteId))
                    .map(note => ({
                        note,
                        similarity: cosineSimilarity(queryVector, noteVectors.get(note.noteId)!)
                    }))
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, limit ?? DEFAULT_LIMIT);

                return {
                    results: scored.map(({ note, similarity }) => ({
                        noteId: note.noteId,
                        title: note.title,
                        similarity: Math.round(similarity * 1000) / 1000,
                        contentPreview: getContentPreview(note)
                    }))
                };
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                getLog().error(`Semantic search failed: ${message}`);
                return { error: message };
            }
        }
    });
}
