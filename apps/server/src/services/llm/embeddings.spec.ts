import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionOrNullMock } = vi.hoisted(() => ({
    getOptionOrNullMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        options: { ...actual.options, getOptionOrNull: getOptionOrNullMock },
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

import { cosineSimilarity, embedQuery, getEmbeddingModel, getNoteEmbeddings, getOllamaBaseUrl } from "./embeddings.js";

function setOptions(values: Record<string, string | null>) {
    getOptionOrNullMock.mockImplementation((name: string) => values[name] ?? null);
}

/** A note stub exposing what the embedding cache reads. */
function noteStub(noteId: string, blobId: string, content: string, type = "text") {
    return {
        noteId,
        blobId,
        type,
        title: `Title ${noteId}`,
        isContentAvailable: () => true,
        getContent: () => content
    } as never;
}

describe("embeddings", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        setOptions({});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("getOllamaBaseUrl", () => {
        it("returns the configured Ollama base URL without a trailing slash", () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama", baseURL: "http://ollama.lan:11434/" }]) });
            expect(getOllamaBaseUrl()).toBe("http://ollama.lan:11434");
        });

        it("defaults to localhost when the Ollama entry has no base URL", () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
        });

        it("returns null without an Ollama provider or with invalid config", () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "openai" }]) });
            expect(getOllamaBaseUrl()).toBeNull();

            setOptions({ llmProviders: "{broken" });
            expect(getOllamaBaseUrl()).toBeNull();
        });
    });

    describe("getEmbeddingModel", () => {
        it("falls back to nomic-embed-text when unset", () => {
            setOptions({});
            expect(getEmbeddingModel()).toBe("nomic-embed-text");
        });

        it("uses the configured model", () => {
            setOptions({ llmEmbeddingModel: "mxbai-embed-large" });
            expect(getEmbeddingModel()).toBe("mxbai-embed-large");
        });
    });

    describe("embedQuery", () => {
        it("prefixes queries for nomic models and posts to /api/embed", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[1, 2, 3]] }) } as Response);

            await expect(embedQuery("find me")).resolves.toEqual([1, 2, 3]);

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toBe("http://localhost:11434/api/embed");
            expect(JSON.parse(init.body as string).input).toEqual(["search_query: find me"]);
        });

        it("throws a descriptive error without a configured Ollama provider", async () => {
            setOptions({});
            await expect(embedQuery("x")).rejects.toThrow(/requires a configured Ollama provider/);
        });

        it("throws on a malformed embeddings response", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: "boom" }) } as Response);
            await expect(embedQuery("x")).rejects.toThrow(/shape mismatch/);
        });

        it("surfaces a pull hint when the embedding model is missing", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "model not found" } as Response);

            await expect(embedQuery("x")).rejects.toThrow(/ollama pull nomic-embed-text/);
        });
    });

    describe("getNoteEmbeddings", () => {
        it("embeds notes once and reuses the cache until the blob changes", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[0.5]] }) } as Response);

            const note = noteStub("n1", "blob-a", "<p>hello</p>");
            const first = await getNoteEmbeddings([note]);
            expect(first.get("n1")).toEqual([0.5]);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // Same blob → served from the cache without a request.
            await getNoteEmbeddings([note]);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // Content change (new blobId) → re-embedded.
            await getNoteEmbeddings([noteStub("n1", "blob-b", "<p>changed</p>")]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("re-embeds cached notes after the embedding model changes", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[0.5]] }) } as Response);

            const note = noteStub("model-switch", "blob-a", "<p>hello</p>");
            await getNoteEmbeddings([note]);
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // Switching the model must not reuse vectors from the old model.
            setOptions({
                llmProviders: JSON.stringify([{ provider: "ollama" }]),
                llmEmbeddingModel: "mxbai-embed-large"
            });
            await getNoteEmbeddings([note]);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("throws when the response vector count does not match the request", async () => {
            setOptions({ llmProviders: JSON.stringify([{ provider: "ollama" }]) });
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embeddings: [] }) } as Response);

            await expect(getNoteEmbeddings([noteStub("mismatch", "blob-a", "<p>x</p>")]))
                .rejects.toThrow(/shape mismatch/);
        });
    });

    describe("cosineSimilarity", () => {
        it("ranks identical direction above orthogonal vectors", () => {
            expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
            expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
        });

        it("returns 0 for zero vectors", () => {
            expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
        });

        it("returns 0 for vectors of different dimensionality (different models)", () => {
            expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
        });
    });
});
