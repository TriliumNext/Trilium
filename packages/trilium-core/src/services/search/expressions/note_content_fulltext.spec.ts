import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import { getLog } from "../../log.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { getSql } from "../../sql/index.js";
import { decodeBase64, encodeBase64, encodeUtf8 } from "../../utils/binary.js";
import NoteSet from "../note_set.js";
import SearchContext from "../search_context.js";
import { NoteBuilder } from "../../../test/becca_mocking.js";
import NoteContentFulltextExp from "./note_content_fulltext.js";

describe("Fuzzy Search Operators", () => {
    it("~= operator works with typos", () => {
        // Test that the ~= operator can handle common typos
        const expression = new NoteContentFulltextExp("~=", { tokens: ["hello"] });
        expect(expression.tokens).toEqual(["hello"]);
        expect(() => new NoteContentFulltextExp("~=", { tokens: ["he"] })).toThrow(); // Too short
    });

    it("~* operator works with fuzzy contains", () => {
        // Test that the ~* operator handles fuzzy substring matching
        const expression = new NoteContentFulltextExp("~*", { tokens: ["world"] });
        expect(expression.tokens).toEqual(["world"]);
        expect(() => new NoteContentFulltextExp("~*", { tokens: ["wo"] })).toThrow(); // Too short
    });
});

describe("~* fuzzy-contains against note content", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    function matches(operator: string, token: string, content: string): boolean {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content,
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp(operator, { tokens: [token] });
        const result = exp.execute(new NoteSet([note]), {}, new SearchContext());
        return result.notes.some(n => n.noteId === note.noteId);
    }

    it("matches a fragment that is a proper substring of a longer word (#10616)", () => {
        // "progr" is a proper substring of "programming"; fuzzy contains must match.
        expect(matches("~*", "progr", "learn programming today")).toBe(true);
        expect(matches("~*", "progr", "nothing relevant here")).toBe(false);
    });

    it("still matches a fuzzy typo that is not a substring", () => {
        // "programing" is one edit from "programming" but not a substring of it.
        expect(matches("~*", "programing", "learn programming today")).toBe(true);
    });
});

describe("fuzzy fallback for note body content (A4)", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    function matchesWithFallback(tokens: string[], content: string, enableFuzzyMatching: boolean): boolean {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content,
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp("*=*", { tokens, flatText: true, fuzzyFallback: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = enableFuzzyMatching;
        const result = exp.execute(new NoteSet([note]), {}, searchContext);
        return result.notes.some(n => n.noteId === note.noteId);
    }

    it("finds a body typo only when fuzzy matching is enabled (phase 2)", () => {
        // "combinef" is one edit from the body word "combined" and not a substring.
        expect(matchesWithFallback(["combinef"], "the values were combined here", false)).toBe(false);
        expect(matchesWithFallback(["combinef"], "the values were combined here", true)).toBe(true);
    });

    it("does not trigger the fallback without the fuzzyFallback opt", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content: "the values were combined here",
            type: "text"
        }).note);

        // Explicit *=* (no fuzzyFallback) stays substring-only even with fuzzy enabled.
        const exp = new NoteContentFulltextExp("*=*", { tokens: ["combinef"], flatText: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = true;
        const result = exp.execute(new NoteSet([note]), {}, searchContext);

        expect(result.notes.some(n => n.noteId === note.noteId)).toBe(false);
    });

    it("records a fuzzy content-match tier for a fallback hit", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content: "the values were combined here",
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp("*=*", { tokens: ["combinef"], flatText: true, fuzzyFallback: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = true;
        exp.execute(new NoteSet([note]), {}, searchContext);

        expect(searchContext.contentMatches.get(note.noteId)?.tier).toBe("fuzzy");
    });
});

describe("content read from the database", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    afterEach(() => vi.restoreAllMocks());

    it("reads only the notes of the input set", () => {
        const [ inSet, outOfSet ] = [ "inside", "outside" ].map((title) => getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title,
                content: `<p>scoped marker ${title}</p>`,
                type: "text"
            }).note));

        const sql = getSql();
        const iterateRows = sql.iterateRows.bind(sql);
        const readNoteIds = new Set<string>();
        vi.spyOn(sql, "iterateRows").mockImplementation(function* (query, params) {
            for (const row of iterateRows<{ noteId: string }>(query, params)) {
                readNoteIds.add(row.noteId);
                yield row as never;
            }
        });

        const exp = new NoteContentFulltextExp("*=*", { tokens: [ "scoped marker" ] });
        const result = exp.execute(new NoteSet([ inSet ]), {}, new SearchContext());

        expect(result.notes.map((note) => note.noteId)).toEqual([ inSet.noteId ]);
        expect([ ...readNoteIds ]).toEqual([ inSet.noteId ]);
        expect(readNoteIds.has(outOfSet.noteId)).toBe(false);
    });
});

describe("protected note content", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
        protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
    });

    afterEach(() => protectedSessionService.resetDataKey());

    function findsNote(note: BNote, token: string) {
        const exp = new NoteContentFulltextExp("*=*", { tokens: [token] });
        return exp.execute(new NoteSet([note]), {}, new SearchContext()).hasNote(note);
    }

    it("matches a protected note whose content arrived by sync (#8491)", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Protected",
            content: "<p>an artist under constant critique</p>",
            type: "text",
            isProtected: true
        }).note);
        expect(findsNote(note, "critique")).toBe(true);

        // Sync sends a blob's stored content as base64 and `sync_update` writes it back as bytes,
        // so the ciphertext a local save stores as text lands in the database as a BLOB.
        const { blobId } = note;
        const ciphertext = getSql().getValue<string>("SELECT content FROM blobs WHERE blobId = ?", [blobId]);
        expect(typeof ciphertext).toBe("string");
        getSql().execute("UPDATE blobs SET content = ? WHERE blobId = ?", [
            decodeBase64(encodeBase64(encodeUtf8(ciphertext))),
            blobId
        ]);
        expect(getSql().getValue("SELECT typeof(content) FROM blobs WHERE blobId = ?", [blobId])).toBe("blob");
        expect(getContext().init(() => note.getContent())).toBe("<p>an artist under constant critique</p>");

        expect(findsNote(note, "critique")).toBe(true);
    });
});

describe("operator semantics", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        protectedSessionService.resetDataKey();
    });

    interface NoteOpts {
        title?: string;
        type?: "text" | "code";
        labels?: [string, string][];
    }

    function createNote(content: string, { title = "Untitled", type = "text", labels = [] }: NoteOpts = {}) {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title,
            content,
            type,
            mime: type === "code" ? "text/plain" : "text/html"
        }).note);

        for (const [ name, value ] of labels) {
            new NoteBuilder(note).label(name, value);
        }

        return note;
    }

    function run(note: BNote, operator: string, tokens: string[], flatText = false, searchContext = new SearchContext()) {
        return new NoteContentFulltextExp(operator, { tokens, flatText })
            .execute(new NoteSet([ note ]), {}, searchContext)
            .hasNote(note);
    }

    it("rejects missing parameters and invalid tokens", () => {
        expect(() => new NoteContentFulltextExp("", { tokens: [ "a" ] })).toThrow("Invalid parameters");
        expect(() => new NoteContentFulltextExp("=", { tokens: undefined as unknown as string[] })).toThrow("Invalid parameters");
        expect(() => new NoteContentFulltextExp("=", { tokens: "a" as unknown as string[] })).toThrow("Invalid parameters");
        expect(() => new NoteContentFulltextExp("=", { tokens: [ " " ] })).toThrow("whitespace-only");
    });

    it("reports an unsupported operator and returns the input set unchanged", () => {
        const note = createNote("<p>anything</p>");
        const inputNoteSet = new NoteSet([ note ]);
        const searchContext = new SearchContext();

        const result = new NoteContentFulltextExp(">", { tokens: [ "a" ] }).execute(inputNoteSet, {}, searchContext);

        expect(result).toBe(inputNoteSet);
        expect(searchContext.getError()).toContain("operator > given");
    });

    it("matches the start and the end of the content", () => {
        const note = createNote("alpha beta gamma", { type: "code" });

        expect(run(note, "*=", [ "gamma" ])).toBe(true);
        expect(run(note, "*=", [ "alpha" ])).toBe(false);
        expect(run(note, "=*", [ "alpha" ])).toBe(true);
        expect(run(note, "=*", [ "gamma" ])).toBe(false);
    });

    it("matches a single exact word in the title or attribute values of flat text", () => {
        const content = "<p>plain body</p>";
        const note = createNote(content, { title: "Ocean", labels: [ [ "color", "blue" ] ] });

        const searchContext = new SearchContext();
        expect(run(note, "=", [ "ocean" ], true, searchContext)).toBe(true);
        expect(searchContext.contentMatches.get(note.noteId)?.tier).toBe("exact_word");
        expect(run(note, "=", [ "blue" ], true)).toBe(true);
        expect(run(note, "=", [ "blue" ])).toBe(false);

        // The content pass alone, before the flat-text pass in execute() re-checks attributes.
        const matchesContent = (token: string) => {
            const resultNoteSet = new NoteSet();
            new NoteContentFulltextExp("!=", { tokens: [ token ], flatText: true })
                .findInText({ noteId: note.noteId, type: "text", mime: "text/html", content, isProtected: false },
                    new NoteSet([ note ]), resultNoteSet, new SearchContext());
            return resultNoteSet.hasNote(note);
        };
        expect(matchesContent("ocean")).toBe(false);
        expect(matchesContent("body")).toBe(false);
        expect(matchesContent("green")).toBe(true);

        expect(run(note, "!=", [ "body" ])).toBe(false);
        const negationContext = new SearchContext();
        expect(run(note, "!=", [ "green" ], true, negationContext)).toBe(true);
        expect(negationContext.contentMatches.has(note.noteId)).toBe(false);
    });

    it("matches an exact phrase in the body or in an attribute value", () => {
        const note = createNote("<p>hello world again</p>", { labels: [ [ "tag", "dark blue" ] ] });

        expect(run(note, "=", [ "hello", "world" ])).toBe(true);
        expect(run(note, "=", [ "world", "hello" ])).toBe(false);
        expect(run(note, "!=", [ "world", "hello" ])).toBe(true);
        expect(run(note, "!=", [ "hello", "world" ])).toBe(false);

        const searchContext = new SearchContext();
        expect(run(note, "=", [ "dark", "blue" ], true, searchContext)).toBe(true);
        expect(searchContext.contentMatches.get(note.noteId)?.tier).toBe("exact_phrase");
        expect(run(note, "=", [ "dark", "blue" ])).toBe(false);
        expect(run(note, "!=", [ "dark", "blue" ], true)).toBe(false);
    });

    it("matches attribute values of notes that have no stored content", () => {
        const note = new BNote({ noteId: "noContent", title: "Empty", type: "text", mime: "text/html" });
        new NoteBuilder(note).label("color", "blue").label("shade", "dark blue");
        const detached = new BNote({ noteId: "detached", title: "Detached", type: "text", mime: "text/html" });
        delete becca.notes[detached.noteId];

        expect(run(note, "=", [ "blue" ], true)).toBe(true);
        expect(run(note, "=", [ "green" ], true)).toBe(false);
        expect(run(note, "=", [ "dark", "blue" ], true)).toBe(true);
        expect(run(note, "!=", [ "green" ], true)).toBe(true);
        expect(run(note, "!=", [ "blue" ], true)).toBe(false);
        expect(run(detached, "!=", [ "anything" ], true)).toBe(false);
    });

    it("does not let the attribute pass of a flat-text negation take back a body match", () => {
        const note = createNote("<p>plain body under a dark night</p>", { labels: [ [ "color", "blue" ] ] });

        expect(run(note, "!=", [ "body" ], true)).toBe(false);
        expect(run(note, "!=", [ "dark", "night" ], true)).toBe(false);
        expect(run(note, "!=", [ "green" ], true)).toBe(true);
        expect(run(note, "=", [ "blue" ], true)).toBe(true);
    });

    it("records no content match for a token without any words", () => {
        const note = createNote("<p>wow!!!</p>");
        const searchContext = new SearchContext();

        expect(run(note, "*=*", [ "!!!" ], false, searchContext)).toBe(true);
        expect(searchContext.contentMatches.has(note.noteId)).toBe(false);
    });

    it("finds each of several tokens in the body or, with flat text, in the title", () => {
        const note = createNote("<p>alpha</p>", { title: "Zebra" });

        expect(run(note, "*=*", [ "alpha", "zebra" ], true)).toBe(true);
        expect(run(note, "*=*", [ "alpha", "zebra" ])).toBe(false);
        expect(run(note, "*=*", [ "alpha", "yak" ], true)).toBe(false);
    });

    it("resolves internal link targets to their titles, skipping missing ones", () => {
        const target = createNote("<p>target</p>", { title: "Lighthouse" });
        const note = createNote(`<p><a class="reference-link" href="#root/${target.noteId}"></a>`
            + ` <a href="#root/missingNote1">gone</a></p>`);

        expect(run(note, "*=*", [ "lighthouse" ])).toBe(true);
    });

    it("matches a single token fuzzily against the body and, with flat text, the title", () => {
        const note = createNote("<p>the programming language</p>", { title: "Elephant" });

        expect(run(note, "~=", [ "programing" ])).toBe(true);
        expect(run(note, "~=", [ "zzzzzz" ])).toBe(false);
        expect(run(note, "~=", [ "elefant" ], true)).toBe(true);
        expect(run(note, "~=", [ "elefant" ])).toBe(false);
    });

    it("matches a short normalized token only verbatim", () => {
        // "ae" with a combining acute accent is three code units long but normalizes to "ae".
        const shortToken = "aé";
        expect(run(createNote("<p>ae</p>"), "~=", [ shortToken ])).toBe(true);
        expect(run(createNote("<p>xyz</p>"), "~=", [ shortToken ])).toBe(false);
    });

    it("matches several fuzzy tokens only when they stand close together", () => {
        const filler = Array.from({ length: 30 }, () => "filler").join(" ");
        const near = createNote("<p>hello there world</p>", { title: "Planet" });
        const far = createNote(`<p>alpha ${filler} beta gamma</p>`);

        expect(run(near, "~=", [ "helo", "world" ])).toBe(true);
        expect(run(near, "~*", [ "hello", "world" ])).toBe(true);
        expect(run(near, "~=", [ "hello", "missing" ])).toBe(false);
        expect(run(near, "~=", [ "hello", "there", "world" ])).toBe(true);
        expect(run(near, "~=", [ "hello", "planet" ], true)).toBe(true);
        expect(run(far, "~=", [ "alpha", "beta" ])).toBe(false);
        expect(run(far, "~=", [ "alpha", "beta", "gamma" ])).toBe(false);
        expect(run(far, "~=", [ "beta", "gamma", "filler" ])).toBe(true);
    });

    it("still matches a phrase in content with a very large word count", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const note = createNote(`${"word ".repeat(100_001)}hello world`, { type: "code" });

        expect(run(note, "~=", [ "hello", "world" ])).toBe(true);
        expect(info.mock.calls.some(([ message ]) => String(message).startsWith("Large word count"))).toBe(true);
    });

    it("treats a failure during fuzzy matching as no match", () => {
        const note = createNote("<p>hello</p>");
        vi.spyOn(note, "getFlatText").mockImplementation(() => {
            throw new Error("broken");
        });
        const error = vi.spyOn(getLog(), "error").mockImplementation(() => {});

        expect(run(note, "~=", [ "hello" ], true)).toBe(false);
        expect(error).toHaveBeenCalledWith(expect.stringContaining(note.noteId));
    });

    it("searches virtual notes held in becca, skipping binary and oversized content", () => {
        const virtualNote = new BNote({ noteId: "virtualNote", title: "Virtual", type: "text", mime: "text/html" });
        virtualNote.isVirtual = true;
        const getContent = vi.spyOn(virtualNote, "getContent");

        getContent.mockReturnValue("<p>virtual marker</p>");
        expect(run(virtualNote, "*=*", [ "marker" ])).toBe(true);

        getContent.mockReturnValue(encodeUtf8("virtual marker"));
        expect(run(virtualNote, "*=*", [ "marker" ])).toBe(false);

        getContent.mockReturnValue(`marker ${"x".repeat(2 * 1024 * 1024)}`);
        expect(run(virtualNote, "*=*", [ "marker" ])).toBe(false);
    });

    it("skips rows outside the input set, missing from becca, empty or undecryptable", () => {
        const exp = new NoteContentFulltextExp("*=*", { tokens: [ "marker" ] });
        const note = createNote("<p>marker</p>");
        const detached = new BNote({ noteId: "detached", title: "Detached", type: "text", mime: "text/html" });
        delete becca.notes[detached.noteId];
        const row = { noteId: note.noteId, type: "text" as const, mime: "text/html", content: "<p>marker</p>", isProtected: false };
        const inputNoteSet = new NoteSet([ note, detached ]);
        const findInText = (overrides: Partial<typeof row>) => {
            const resultNoteSet = new NoteSet();
            const content = exp.findInText({ ...row, ...overrides }, inputNoteSet, resultNoteSet, new SearchContext());
            return { content, found: resultNoteSet.hasNote(note) };
        };

        expect(findInText({})).toEqual({ content: "marker", found: true });
        expect(exp.findInText(row, new NoteSet(), new NoteSet(), new SearchContext())).toBeUndefined();
        expect(findInText({ noteId: detached.noteId }).content).toBeUndefined();
        expect(findInText({ content: "<p></p>" })).toEqual({ content: undefined, found: false });

        // No protected session is active yet.
        expect(findInText({ isProtected: true })).toEqual({ content: undefined, found: false });

        protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
        expect(findInText({ isProtected: true, content: "" })).toEqual({ content: undefined, found: false });

        const decryptString = vi.spyOn(protectedSessionService, "decryptString").mockReturnValue(null);
        expect(findInText({ isProtected: true })).toEqual({ content: undefined, found: false });

        decryptString.mockImplementation(() => {
            throw new Error("bad ciphertext");
        });
        const info = vi.spyOn(getLog(), "info").mockImplementation(() => {});
        expect(findInText({ isProtected: true })).toEqual({ content: undefined, found: false });
        expect(info).toHaveBeenCalledWith(expect.stringContaining(note.noteId));
    });
});
