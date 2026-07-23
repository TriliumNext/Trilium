/**
 * Note embeddings via the Ollama embeddings API, used for semantic search
 * over the user's notes with local models.
 *
 * Embeddings are computed lazily and cached in memory keyed by noteId + blobId,
 * so a note is only re-embedded when its content changes. No embeddings are
 * persisted to the database.
 */

import { type BNote, getLog, options as optionService } from "@triliumnext/core";

const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const EMBED_TIMEOUT_MS = 60_000;
/** Maximum characters of note text sent to the embedding model. */
const EMBED_TEXT_MAX_LENGTH = 2000;
/** Maximum number of texts per embeddings request. */
const EMBED_BATCH_SIZE = 32;

interface CachedEmbedding {
    /** blobId at the time of embedding — invalidates the cache on content change. */
    blobId: string | null;
    /** Embedding model used — switching models invalidates the entry. */
    model: string;
    vector: number[];
}

/**
 * Safety cap for the in-memory cache: entries of deleted notes are never
 * pruned individually (they simply stop being requested), so the whole cache
 * is dropped when it grows past this bound and rebuilt lazily.
 */
const EMBEDDING_CACHE_MAX_ENTRIES = 5000;

const embeddingCache = new Map<string, CachedEmbedding>();

export function getEmbeddingModel(): string {
    return optionService.getOptionOrNull("llmEmbeddingModel") || DEFAULT_EMBEDDING_MODEL;
}

/** Find the base URL of the first configured Ollama provider, if any. */
export function getOllamaBaseUrl(): string | null {
    try {
        const providersJson = optionService.getOptionOrNull("llmProviders");
        if (!providersJson) return null;
        const providers = JSON.parse(providersJson) as Array<{ provider: string; baseURL?: string }>;
        const ollama = providers.find(p => p.provider === "ollama");
        if (!ollama) return null;
        return (ollama.baseURL || "http://localhost:11434").replace(/\/+$/, "");
    } catch (e) {
        getLog().error(`Failed to parse llmProviders option: ${e}`);
        return null;
    }
}

/**
 * Embed a batch of texts with the configured Ollama embedding model.
 * Throws with a descriptive message when the instance or model is unavailable.
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
    const baseUrl = getOllamaBaseUrl();
    if (!baseUrl) {
        throw new Error("Semantic search requires a configured Ollama provider (Options → AI / LLM).");
    }

    const model = getEmbeddingModel();
    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const response = await fetch(`${baseUrl}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: batch }),
            signal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Embedding request failed (${response.status}): ${errorText}. ` +
                `Make sure the embedding model "${model}" is available in Ollama (ollama pull ${model}).`
            );
        }

        const data = await response.json() as { embeddings?: number[][] };
        if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) {
            throw new Error(
                `Embedding response shape mismatch: expected ${batch.length} vectors, `
                + `got ${Array.isArray(data.embeddings) ? data.embeddings.length : "none"}.`
            );
        }
        vectors.push(...data.embeddings);
    }

    return vectors;
}

/** The nomic-embed-text models expect task prefixes for best quality. */
function isNomicModel(): boolean {
    return getEmbeddingModel().includes("nomic");
}

/** Embed a search query. */
export async function embedQuery(query: string): Promise<number[]> {
    const text = isNomicModel() ? `search_query: ${query}` : query;
    const [vector] = await embedTexts([text]);
    if (!vector) {
        throw new Error("Embedding the query produced no vector.");
    }
    return vector;
}

/** Build the text that represents a note for embedding purposes. */
function getEmbeddableText(note: BNote): string | null {
    if (!note.isContentAvailable()) {
        return null;
    }
    const content = note.getContent();
    if (typeof content !== "string") {
        return null;
    }
    // Cheap HTML strip for text notes; full markdown conversion is too
    // expensive when embedding many candidate notes.
    const plain = note.type === "text"
        ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : content;

    const text = `${note.title}\n${plain}`.slice(0, EMBED_TEXT_MAX_LENGTH);
    return isNomicModel() ? `search_document: ${text}` : text;
}

/**
 * Get embeddings for the given notes, computing and caching missing ones.
 * Returns a map of noteId → vector; notes without embeddable content are skipped.
 */
export async function getNoteEmbeddings(notes: BNote[]): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    const toEmbed: { note: BNote; text: string }[] = [];
    const model = getEmbeddingModel();

    for (const note of notes) {
        const cached = embeddingCache.get(note.noteId);
        if (cached && cached.blobId === note.blobId && cached.model === model) {
            result.set(note.noteId, cached.vector);
            continue;
        }
        const text = getEmbeddableText(note);
        if (text) {
            toEmbed.push({ note, text });
        }
    }

    if (toEmbed.length > 0) {
        // embedTexts guarantees one vector per input or throws.
        const vectors = await embedTexts(toEmbed.map(e => e.text));
        if (embeddingCache.size + toEmbed.length > EMBEDDING_CACHE_MAX_ENTRIES) {
            embeddingCache.clear();
        }
        for (let i = 0; i < toEmbed.length; i++) {
            const { note } = toEmbed[i];
            embeddingCache.set(note.noteId, { blobId: note.blobId ?? null, model, vector: vectors[i] });
            result.set(note.noteId, vectors[i]);
        }
    }

    return result;
}

export function cosineSimilarity(a: number[], b: number[]): number {
    // Different dimensionalities mean the vectors come from different models —
    // comparing them would produce a plausible-looking but meaningless score.
    if (a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
