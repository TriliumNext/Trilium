import { describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { getContext } from "../context.js";
import type { ReadOnlyDatabase } from "../sql/types.js";
import TaskContext from "../task_context.js";
import { decodeBase64, encodeUtf8 } from "../utils/binary.js";
import type { ZipProvider } from "../zip_provider.js";
import ankiImporter, {
    type AnkiCardRow,
    type AnkiCollectionRow,
    type AnkiImportNote,
    applyAnkiMedia,
    buildAnkiImportPlan,
    collectReferencedMedia,
    decodeCurrentMediaEntries,
    extractAnkiMedia,
    extractCollectionDatabase,
    readAnkiCollectionMetadata
} from "./anki.js";
import { buildAttachmentIndex } from "./obsidian/attachments.js";

const APKG_MEDIA_FIXTURE_BASE64 =
    "UEsDBBQAAAAIAPF1HF1qofHHlgEAAABAAAAQAAAAY29sbGVjdGlvbi5hbmtpMu3YTU/CMBgH8FZARKOYcNjRZieM" +
    "C4F404uoeNIY306EQ6WFLG6r2QpqyA58CL+LH8KTX8Z4s9sQwYsXY6L5/9K1T/v07dpdnB27WrKeCn2u2TZZJ5SS" +
    "PcYIIfnJ9yH3pU/J9/Kk9vi8mixeeyPlpzI3DQAAAAAAAMDv6eWKlmXR8Zbm157s8lBEaZU/OG81L1vssrl/3GLp" +
    "UNUVzA207MvQCWZiMROruU44jTevFrJzSuk5gdIySqvc3Dnp0Ow5/kzc80TEtLzXjub9LNo8ootWpUIH2e2VZ8rC" +
    "/M2VVx3K8POysnsz2cVXQnqTfZK3OS3fE1MAAAAAAAAA4IeNC7RAO+PdlZHdqNs7bGS7wjSNusPsgPvSxPaJFC5n" +
    "h+bhbsdxMi+bqB9uk3QyM/kzYML2aLrmKFSBtk1Khcl+9dhhn8l9braa5hpxJ46z9/8LMQUAAAAAAAAA/gyHFkr0" +
    "1BJnAxlpVwUbzSC6kyFrR2oQiJ2hcruy5t9ud/hAuCp7/78SUwAAAAAAAADgfynSxVKJLi0tvwNQSwMEFAAAAAgA" +
    "8XUcXeb1jngTAAAAEQAAAAUAAABtZWRpYatWMlCyUirLz0xO1cstMFaqBQBQSwMEFAAAAAgA8XUcXRndkJEMAAAA" +
    "CgAAAAEAAAAw83QxTsusKCktSgUAUEsBAhQDFAAAAAgA8XUcXWqh8ceWAQAAAEAAABAAAAAAAAAAAAAAAKSBAAAA" +
    "AGNvbGxlY3Rpb24uYW5raTJQSwECFAMUAAAACADxdRxd5vWOeBMAAAARAAAABQAAAAAAAAAAAAAAgAHEAQAAbWVk" +
    "aWFQSwECFAMUAAAACADxdRxdGd2QkQwAAAAKAAAAAQAAAAAAAAAAAAAAgAH6AQAAMFBLBQYAAAAAAwADAKAAAAAl" +
    "AgAAAAA=";

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

describe("Anki package media", () => {
    it("imports a referenced resource as an owned attachment", async () => {
        const taskContext = TaskContext.getInstance("anki-media-integration", "importNotes", {
            shrinkImages: false
        });
        const importRoot = await getContext().init(() => ankiImporter.importAnkiPackage(
            taskContext,
            decodeBase64(APKG_MEDIA_FIXTURE_BASE64),
            becca.getNoteOrThrow("root"),
            "media.apkg"
        ));

        try {
            const deck = importRoot.getChildNotes().find((note) => note.title === "Media Deck");
            const imported = deck?.getChildNotes().find((note) => note.title === "Question");
            if (!imported) {
                throw new Error("Anki media fixture card was not imported.");
            }
            expect(imported.getAttachmentsByRole("file").map((attachment) => attachment.title))
                .toEqual(["voice.mp3"]);
            expect(imported.getContent().toString()).toContain("attachmentId=");
            expect(imported.getContent().toString()).not.toContain("[sound:");
        } finally {
            getContext().init(() => importRoot.deleteNote());
        }
    });

    it("extracts only referenced legacy media entries", async () => {
        const photo = new Uint8Array([1, 2, 3]);
        const media = await extractAnkiMedia(
            new Uint8Array(),
            new Set(["photo.png"]),
            archiveProvider({
                media: encodeUtf8(JSON.stringify({ "0": "photo.png", "1": "unused.bin" })),
                "0": photo,
                "1": new Uint8Array([9])
            })
        );

        expect(media).toEqual(new Map([["photo.png", photo]]));

        await expect(extractAnkiMedia(
            new Uint8Array(),
            new Set(["photo.png"]),
            archiveProvider({
                media: encodeUtf8(JSON.stringify({ "0": "photo.png" }))
            })
        )).rejects.toThrow("media file 'photo.png' is missing");
    });

    it("decompresses current media maps and files", async () => {
        const compressedMap = new Uint8Array([
            0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x25, 0x29, 0x01, 0x00, 0x0a,
            0x23, 0x0a, 0x09, 0x70, 0x68, 0x6f, 0x74, 0x6f, 0x2e, 0x70,
            0x6e, 0x67, 0x10, 0x03, 0x1a, 0x14, 0x70, 0x37, 0x80, 0x71,
            0x98, 0xc2, 0x2a, 0x7d, 0x2b, 0x08, 0x07, 0x37, 0x1d, 0x76,
            0x37, 0x79, 0xa8, 0x4f, 0xdf, 0xcf, 0xac, 0x36, 0xa6, 0xda
        ]);
        const compressedPhoto = new Uint8Array([
            0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x03, 0x19, 0x00,
            0x00, 0x01, 0x02, 0x03, 0xa5, 0xe5, 0x4e, 0x0c
        ]);

        const media = await extractAnkiMedia(
            new Uint8Array(),
            new Set(["photo.png"]),
            archiveProvider({
                "collection.anki21b": new Uint8Array(),
                media: compressedMap,
                "0": compressedPhoto
            })
        );

        expect(media).toEqual(new Map([["photo.png", new Uint8Array([1, 2, 3])]]));

        const corruptPhoto = new Uint8Array([
            0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x03, 0x19, 0x00,
            0x00, 0x01, 0x02, 0x04, 0x88, 0x03, 0xb8, 0xc7
        ]);
        await expect(extractAnkiMedia(
            new Uint8Array(),
            new Set(["photo.png"]),
            archiveProvider({
                "collection.anki21b": new Uint8Array(),
                media: compressedMap,
                "0": corruptPhoto
            })
        )).rejects.toThrow("media file 'photo.png' is corrupt");
    });

    it("decodes current protobuf media entries and ignores internal legacy indices", () => {
        const first = protobufMediaEntry("photo.png", 3);
        const second = protobufMediaEntry("voice.mp3", 5, 7);
        const data = new Uint8Array([
            0x0a, first.byteLength, ...first,
            0x0a, second.byteLength, ...second
        ]);

        expect(decodeCurrentMediaEntries(data)).toEqual([
            { index: 0, name: "photo.png", size: 3 },
            { index: 1, name: "voice.mp3", size: 5 }
        ]);
        expect(() => decodeCurrentMediaEntries(new Uint8Array([0x0a, 0x05, 0x01])))
            .toThrow("truncated protobuf field");
    });

    it("materializes sound references as Trilium file attachments", () => {
        const saveAttachment = vi.fn(() => ({ attachmentId: "attachment1" }));
        const note = { noteId: "note1", saveAttachment } as unknown as BNote;
        const mediaIndex = buildAttachmentIndex(new Map([
            ["voice#one.mp3", new Uint8Array([1, 2, 3])]
        ]));

        const content = applyAnkiMedia(
            note,
            "Listen [sound:voice#one.mp3]",
            mediaIndex,
            false
        );

        expect(saveAttachment).toHaveBeenCalledWith(expect.objectContaining({
            role: "file",
            mime: "audio/mpeg",
            title: "voice#one.mp3"
        }));
        expect(content).not.toContain("[sound:");
        expect(content).toContain("attachmentId=attachment1");
        expect(content).not.toContain("voice%23one.mp3");
    });

    it("finds local image, link, and sound references only", () => {
        const notes = [{
            content: [
                '<img src="photo%20one.png">',
                '<a href="document.pdf">doc</a>',
                '<img src="https://example.com/external.png">',
                "[sound:voice.mp3]"
            ].join(""),
            sourceNoteId: "1",
            deckName: "Deck",
            title: "Card",
            tags: [],
            sourceCardCount: 1
        }] satisfies AnkiImportNote[];

        expect(collectReferencedMedia(notes)).toEqual(new Set([
            "photo one.png",
            "document.pdf",
            "voice.mp3"
        ]));
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

function protobufMediaEntry(name: string, size: number, legacyIndex?: number): Uint8Array {
    const nameBytes = encodeUtf8(name);
    return new Uint8Array([
        0x0a, nameBytes.byteLength, ...nameBytes,
        0x10, size,
        ...(legacyIndex === undefined ? [] : [0xf8, 0x0f, legacyIndex])
    ]);
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
