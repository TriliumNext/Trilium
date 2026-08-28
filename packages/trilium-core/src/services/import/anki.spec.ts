import { describe, expect, it } from "vitest";

import type { ReadOnlyDatabase } from "../sql/types.js";
import { encodeUtf8 } from "../utils/binary.js";
import type { ZipProvider } from "../zip_provider.js";
import {
    type AnkiCardRow,
    type AnkiCollectionRow,
    buildAnkiImportPlan,
    extractCollectionDatabase,
    readAnkiCollectionMetadata
} from "./anki.js";

const collection: AnkiCollectionRow = {
    decks: JSON.stringify({
        "10": { id: 10, name: "Languages::French" },
        "20": { id: 20, name: "Science" }
    }),
    models: JSON.stringify({
        "100": {
            type: 0,
            flds: [
                { name: "Front", ord: 0 },
                { name: "Back", ord: 1 },
                { name: "Extra", ord: 2 }
            ]
        },
        "200": {
            flds: [
                { name: "Text", ord: 0 },
                { name: "Extra", ord: 1 }
            ]
        }
    })
};

function card(overrides: Partial<AnkiCardRow>): AnkiCardRow {
    return {
        noteId: 1,
        modelId: 100,
        fields: "Front\u001fBack",
        tags: "",
        deckId: 10,
        originalDeckId: 0,
        ordinal: 0,
        ...overrides
    };
}

describe("Anki package extraction", () => {
    it("prefers a modern readable collection over the compatibility database", async () => {
        const legacy = sqliteBytes("legacy");
        const modern = sqliteBytes("modern");
        const provider = archiveProvider({
            "collection.anki2": legacy,
            "collection.anki21": modern
        });

        await expect(extractCollectionDatabase(
            new Uint8Array(),
            provider
        )).resolves.toEqual(modern);
    });

    it("decompresses current collection.anki21b packages", async () => {
        const compressed = new Uint8Array([
            0x28, 0xb5, 0x2f, 0xfd, 0x04, 0x58, 0xd9, 0x00, 0x00, 0x53,
            0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d,
            0x61, 0x74, 0x20, 0x33, 0x00, 0x6d, 0x6f, 0x64, 0x65, 0x72,
            0x6e, 0x2d, 0x7a, 0x73, 0x74, 0x64, 0xd9, 0x6c, 0x42, 0x55
        ]);

        await expect(extractCollectionDatabase(
            new Uint8Array(),
            archiveProvider({ "collection.anki21b": compressed })
        )).resolves.toEqual(sqliteBytes("modern-zstd"));
    });

    it("rejects missing, invalid, and corrupt compressed collections", async () => {
        await expect(extractCollectionDatabase(
            new Uint8Array(),
            archiveProvider({ "media": new Uint8Array() })
        )).rejects.toThrow("does not contain an Anki collection database");

        await expect(extractCollectionDatabase(
            new Uint8Array(),
            archiveProvider({ "collection.anki2": new Uint8Array([1, 2, 3]) })
        )).rejects.toThrow("collection database is invalid");

        await expect(extractCollectionDatabase(
            new Uint8Array(),
            archiveProvider({ "collection.anki21b": new Uint8Array([1, 2, 3]) })
        )).rejects.toThrow("Unable to decompress Anki collection");
    });
});

describe("Anki collection metadata", () => {
    it("reads normalized schema 15+ decks and fields", () => {
        const database: ReadOnlyDatabase = {
            getRows<T>(query: string): T[] {
                if (query.includes("FROM col")) {
                    return [{ ver: 18, decks: "", models: "" }] as T[];
                }
                if (query.includes("FROM decks")) {
                    return [{ id: 10, name: "Languages::French" }] as T[];
                }
                return [
                    { modelId: 200, ordinal: 0, name: "Text" },
                    { modelId: 200, ordinal: 1, name: "Extra" }
                ] as T[];
            },
            close() {}
        };

        const metadata = readAnkiCollectionMetadata(database);
        expect(JSON.parse(metadata.decks)).toEqual({
            "10": { id: 10, name: "Languages::French" }
        });
        expect(JSON.parse(metadata.models)).toEqual({
            "200": {
                flds: [
                    { name: "Text", ord: 0 },
                    { name: "Extra", ord: 1 }
                ]
            }
        });
    });
});

describe("Anki import planning", () => {
    it("groups templates and preserves decks, fields, tags, and cloze markup", () => {
        const plan = buildAnkiImportPlan(collection, [
            card({
                fields: [
                    "<b>Bonjour &amp; salut</b>",
                    "<p>Hello</p>",
                    "<script>bad()</script>Usage"
                ].join("\u001f"),
                tags: " language beginner language ",
                ordinal: 0
            }),
            card({ ordinal: 1 }),
            card({
                noteId: 2,
                modelId: 200,
                fields: "The capital is {{c1::<b>Paris</b>::city}}.\u001f<p>France</p>",
                deckId: 999,
                originalDeckId: 20
            })
        ]);

        expect(plan.deckNames).toEqual(["Languages::French", "Science"]);
        expect(plan.notes).toHaveLength(2);
        expect(plan.notes[0]).toEqual({
            sourceNoteId: "1",
            deckName: "Languages::French",
            title: "Bonjour & salut",
            content: "<p>Hello</p><hr />bad()Usage",
            tags: ["language", "beginner"],
            sourceCardCount: 2
        });
        expect(plan.notes[1]).toEqual({
            sourceNoteId: "2",
            deckName: "Science",
            title: "The capital is Paris.",
            content: "The capital is {{c1::<b>Paris</b>::city}}.<hr /><p>France</p>",
            tags: [],
            sourceCardCount: 1
        });
    });

    it("uses safe fallbacks for missing metadata and empty fronts", () => {
        const plan = buildAnkiImportPlan({ decks: "{}", models: "{}" }, [
            card({ noteId: 42, modelId: 404, fields: "\u001fOnly answer", deckId: 404 })
        ]);

        expect(plan.deckNames).toEqual(["Default"]);
        expect(plan.notes[0]).toMatchObject({
            title: "Anki card 42",
            content: "Only answer",
            deckName: "Default"
        });
    });

    it("rejects malformed collection metadata", () => {
        expect(() => buildAnkiImportPlan({ decks: "[]", models: "{}" }, [])).toThrow(
            "Invalid Anki deck metadata"
        );
        expect(() => buildAnkiImportPlan({ decks: "{}", models: "{" }, [])).toThrow(
            "Invalid Anki note-type metadata"
        );
    });
});

function sqliteBytes(suffix: string): Uint8Array {
    return encodeUtf8(`SQLite format 3\u0000${suffix}`);
}

function archiveProvider(files: Record<string, Uint8Array>): ZipProvider {
    return {
        async detectFilenameEncoding() {
            return "utf-8";
        },
        async readZipFile(_source, processEntry, _filenameEncoding, entryFilter) {
            for (const [fileName, content] of Object.entries(files)) {
                const entry = { fileName, uncompressedSize: content.byteLength };
                if (!entryFilter || entryFilter(entry)) {
                    await processEntry(entry, async () => content);
                }
            }
        },
        createZipArchive() {
            throw new Error("not used");
        },
        createFileStream() {
            throw new Error("not used");
        }
    };
}
