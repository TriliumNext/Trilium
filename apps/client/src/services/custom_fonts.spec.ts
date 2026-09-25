import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    options: {} as Record<string, string>,
    notes: {} as Record<string, { blobId: string } | null>
}));

vi.mock("./options.js", () => ({ default: { get: (name: string) => mocks.options[name] ?? "" } }));
vi.mock("./froca.js", () => ({ default: { getNote: async (noteId: string) => mocks.notes[noteId] ?? null } }));
vi.mock("./ws.js", () => ({ logError: vi.fn() }));
vi.mock("./server.js", () => ({ default: { get: vi.fn() } }));

const { applyCustomFontsFromOptions, hasCustomFontContentChanged, registerFontNote } = await import("./custom_fonts.js");
const { default: LoadResults } = await import("./load_results.js");

/** The faces `document.fonts` holds, as the stub below sees them. */
let registeredFaces: Set<FontFace>;
let fetchMock: ReturnType<typeof vi.fn>;

/** Stands in for `FontFace`, resolving unless the source bytes say the file is undecodable. */
class FontStub {
    constructor(public family: string, public source: ArrayBuffer | string) {}

    load() {
        const undecodable = typeof this.source !== "string" && new Uint8Array(this.source)[0] === 0xff;
        return undecodable ? Promise.reject(new Error("Failed to decode downloaded font.")) : Promise.resolve(this);
    }
}

beforeEach(() => {
    mocks.options = {};
    mocks.notes = {};
    registeredFaces = new Set();
    fetchMock = vi.fn(async () => new Response(new Uint8Array([ 0x00, 0x01, 0x00, 0x00 ])));

    vi.stubGlobal("FontFace", FontStub);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: {
            add: (face: FontFace) => registeredFaces.add(face),
            delete: (face: FontFace) => registeredFaces.delete(face)
        }
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

const families = () => [ ...registeredFaces ].map((face) => face.family);

describe("registerFontNote", () => {
    it("loads a note's file and registers it under the given family, versioned by blob", async () => {
        await registerFontNote("fontNoteA1", "some-family", "blobA");

        expect(String(fetchMock.mock.calls[0][0])).toContain("api/notes/fontNoteA1/open?v=blobA");
        expect(families()).toEqual([ "some-family" ]);
    });

    it("throws rather than registering anything when the file cannot be fetched", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

        await expect(registerFontNote("fontNoteA1", "some-family", "blobA")).rejects.toThrow("404");
        expect(families()).toEqual([]);
    });
});

// Each case names notes of its own: what has been registered is module state, as it is for the page
// these run in, and outlives the test that put it there.
describe("applyCustomFontsFromOptions", () => {
    it("registers the note a font option names, under the family the stylesheet declares", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteB2", treeFontFamily: "Arial" };
        mocks.notes = { fontNoteB2: { blobId: "blobB" } };

        await applyCustomFontsFromOptions();

        // "Arial" names a family the browser resolves for itself; nothing is loaded for it.
        expect(families()).toEqual([ "trilium-font-fontNoteB2" ]);
    });

    it("registers each named font once, however many options name it", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteC3", detailFontFamily: "customFont:fontNoteC3" };
        mocks.notes = { fontNoteC3: { blobId: "blobC" } };

        await applyCustomFontsFromOptions();
        // A second pass over unchanged options loads nothing again either.
        await applyCustomFontsFromOptions();

        expect(families()).toEqual([ "trilium-font-fontNoteC3" ]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("drops a font once no option names it any more", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteD4" };
        mocks.notes = { fontNoteD4: { blobId: "blobD" }, fontNoteE5: { blobId: "blobE" } };
        await applyCustomFontsFromOptions();

        mocks.options = { mainFontFamily: "customFont:fontNoteE5" };
        await applyCustomFontsFromOptions();

        expect(families()).toEqual([ "trilium-font-fontNoteE5" ]);
    });

    it("loads the file again once a new revision replaces it, dropping the face built from the old one", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteF6" };
        mocks.notes = { fontNoteF6: { blobId: "blobF" } };
        await applyCustomFontsFromOptions();
        const staleFace = [ ...registeredFaces ][0];

        mocks.notes = { fontNoteF6: { blobId: "blobF2" } };
        await applyCustomFontsFromOptions();

        expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("v=blobF2");
        // One face under the family the stylesheet names, built from the file the note holds now.
        expect(families()).toEqual([ "trilium-font-fontNoteF6" ]);
        expect(registeredFaces.has(staleFace)).toBe(false);
    });

    it("keeps the newest file when the load it overtook finishes after it", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteG7" };
        mocks.notes = { fontNoteG7: { blobId: "blobG1" } };

        // Holds the first file open, so the load for the file replacing it can overtake it.
        let releaseFirst = () => {};
        const firstHeld = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        fetchMock.mockImplementationOnce(async () => {
            await firstHeld;
            return new Response(new Uint8Array([ 0x00, 0x01, 0x00, 0x00 ]));
        });

        const overtaken = applyCustomFontsFromOptions();
        mocks.notes = { fontNoteG7: { blobId: "blobG2" } };
        await applyCustomFontsFromOptions();
        const newestFace = [ ...registeredFaces ][0];

        releaseFirst();
        await overtaken;

        // The face built from the file the note holds now, not the one it held when the slower load
        // set out to fetch it. Compared by identity: every face here carries the same family, and
        // the stub files are byte-identical, so a structural match would hold either way.
        expect([ ...registeredFaces ]).toHaveLength(1);
        expect([ ...registeredFaces ][0]).toBe(newestFace);
        expect(families()).toEqual([ "trilium-font-fontNoteG7" ]);
    });

    it("carries on where the note is gone or its file will not load", async () => {
        mocks.options = { mainFontFamily: "customFont:goneNote001" };
        await expect(applyCustomFontsFromOptions()).resolves.toBeUndefined();
        expect(families()).toEqual([]);

        mocks.notes = { goneNote001: { blobId: "blobG" } };
        fetchMock.mockResolvedValue(new Response(new Uint8Array([ 0xff, 0xff ])));
        await expect(applyCustomFontsFromOptions()).resolves.toBeUndefined();
        expect(families()).toEqual([]);
    });
});

describe("hasCustomFontContentChanged", () => {
    /** A reload carrying a content change for each of `noteIds`. */
    function reloadOf(...noteIds: string[]) {
        const loadResults = new LoadResults([]);
        for (const noteId of noteIds) {
            loadResults.addNoteContent(noteId, "someComponent");
        }

        return loadResults;
    }

    it("answers only for the notes whose fonts the app is rendering with", async () => {
        mocks.options = { mainFontFamily: "customFont:fontNoteH8" };
        mocks.notes = { fontNoteH8: { blobId: "blobH" } };
        await applyCustomFontsFromOptions();

        expect(hasCustomFontContentChanged(reloadOf("fontNoteH8"))).toBe(true);
        // A note holding no font the options name, and a reload that changed no content at all.
        expect(hasCustomFontContentChanged(reloadOf("someOtherNote"))).toBe(false);
        expect(hasCustomFontContentChanged(reloadOf())).toBe(false);
    });
});
