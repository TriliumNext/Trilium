import type { CompletionContext, CompletionResult } from "@triliumnext/codemirror/src/field_editor";
import { beforeEach, describe, expect, it, vi } from "vitest";

import server from "../../services/server";
import { fetchAttributeNames } from "../attribute_widgets/attribute_detail";
import { searchCompletionIcon, searchCompletionReactivates, searchCompletionSource } from "./search_completions";

// The descriptions are catalogue lookups, which specs don't initialize; the keys identify them.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
// Stubbed at the same seam the sidebar's picker fetches through, so the spec needs no server and
// none of the attribute popup behind it. `isBuiltinAttribute` is left real: what it marks is the
// point of these tests.
vi.mock("../attribute_widgets/attribute_detail", () => ({ fetchAttributeNames: vi.fn() }));
// Modules loaded behind `services/attributes` request through this one as they load, so the stub
// answers from the start rather than from the first `beforeEach`.
vi.mock("../../services/server", () => ({ default: { get: vi.fn(async () => []) } }));

beforeEach(() => {
    vi.mocked(fetchAttributeNames).mockReset().mockResolvedValue([ "book", "archived" ]);
    vi.mocked(server.get).mockReset().mockResolvedValue([ "fiction", "science fiction" ]);
});

describe("searchCompletionSource", () => {
    it("offers the note object and the keywords while a word is being typed, anchored at its start", async () => {
        const result = await complete("#book AND no");

        expect(result?.from).toBe(10);
        expect(labelsOf(result)).toEqual([ "#", "#!", "~", "~!", "note", "and", "or", "not", "orderBy", "limit" ]);
        // Both complete with what has to follow them.
        expect(optionFor(result, "note")?.apply).toBe("note.");
        expect(optionFor(result, "not")?.apply).toBe("not(");
        expect(optionFor(result, "note")?.detail).toBe("search_completion.note");
    });

    it("offers the sort directions only once an orderBy is open", async () => {
        expect(labelsOf(await complete("#book de"))).not.toContain("desc");

        const ordering = await complete("#book orderBy #year de");

        expect(labelsOf(ordering)).toContain("desc");
        expect(optionFor(ordering, "asc")?.detail).toBe("order_by.asc");
    });

    it("narrows an orderBy to what can follow the key being written", async () => {
        // A key is a property path or an attribute name, which the branches above answer for.
        expect(labelsOf(await complete("#book orderBy n"))).toEqual([ "#", "~", "note" ]);
        expect(labelsOf(await complete("#book orderBy ", { explicit: true }))).toEqual([ "#", "~", "note" ]);

        // Once a key stands there it can be sorted, followed by another, or cut short.
        expect(labelsOf(await complete("#book orderBy note.title d")))
            .toEqual([ "asc", "desc", "limit" ]);
        expect(labelsOf(await complete("#book orderBy note.title desc, note.dateCreated a")))
            .toEqual([ "asc", "desc", "limit" ]);

        // A comma opens the next key, which has no direction of its own yet.
        expect(labelsOf(await complete("#book orderBy note.title, n"))).toEqual([ "#", "~", "note" ]);

        // An ordering names a key and sorts on it; nothing in it is compared.
        expect(await complete("#book orderBy note.title =")).toBeNull();

        // Outside an ordering the keywords are untouched.
        expect(labelsOf(await complete("#book n")))
            .toEqual([ "#", "#!", "~", "~!", "note", "and", "or", "not", "orderBy", "limit" ]);
    });

    it("offers every operator once one of their characters is typed", async () => {
        const result = await complete("#year >");

        expect(result?.from).toBe(6);
        expect(labelsOf(result)).toEqual([
            "=", "!=", "*=*", "=*", "*=", ">", ">=", "<", "<=", "%=", "~=", "~*"
        ]);
        expect(result?.options.every((option) => option.detail)).toBe(true);
    });

    it("offers only the operators the operand accepts", async () => {
        // `note.text` is matched, never ordered or compared exactly.
        expect(labelsOf(await complete("note.text >"))).toEqual([ "*=*" ]);
        expect(labelsOf(await complete("~author.text ="))).toEqual([ "*=*" ]);

        // Content is matched too, but with every matching operator.
        const content = labelsOf(await complete("note.content ="));
        expect(content).toContain("%=");
        expect(content).not.toContain(">=");
        expect(labelsOf(await complete("note.rawContent ="))).toEqual(content);

        // A relation is compared only through a property of the note it names.
        expect(await complete("~author =")).toBeNull();
        expect(await complete("note.relations.author >")).toBeNull();
        // An explicit request past one is left with the keywords alone.
        expect(labelsOf(await complete("~author ", { explicit: true })))
            .toEqual([ "#", "#!", "~", "~!", "note", "and", "or", "not", "orderBy", "limit" ]);

        // The last segment decides, and a name the user chose after `labels.` restricts nothing.
        expect(labelsOf(await complete("note.parents.title >"))).toContain(">");
        expect(labelsOf(await complete("note.labels.text ="))).toContain("=");
    });

    it("offers path segments after a dot, anchored at the segment being typed", async () => {
        const root = await complete("note.");

        expect(root?.from).toBe(5);
        expect(labelsOf(root)).toContain("title");
        expect(labelsOf(root)).toContain("parents");
        expect(labelsOf(root)).toContain("content");

        const partial = await complete("#book AND note.date");

        expect(partial?.from).toBe(15);
        expect(labelsOf(partial)).toEqual(labelsOf(root));
    });

    it("walks a path through a relation and through a traversal", async () => {
        expect(labelsOf(await complete("~author."))).toContain("title");
        expect(labelsOf(await complete("note.parents."))).toContain("title");
        expect(labelsOf(await complete("~author.relations.son."))).toContain("title");
    });

    it("stops where a terminal property ends the path", async () => {
        expect(await complete("note.title.")).toBeNull();
        expect(await complete("note.labels.publicationYear.")).toBeNull();
    });

    it("stays quiet on empty space, and offers everything when asked explicitly", async () => {
        expect(await complete("#book ")).toBeNull();

        const explicit = await complete("#book ", { explicit: true });

        expect(explicit?.from).toBe(6);
        // The words and the four attribute markers, then every operator.
        expect(explicit?.options).toHaveLength(22);
        // CodeMirror sorts by score and ignores the order offered, so the markers are boosted
        // to the top rather than merely listed first.
        // Each negated marker sits directly under the one it negates.
        expect(optionFor(explicit, "#")?.boost).toBe(99);
        expect(optionFor(explicit, "#!")?.boost).toBe(98);
        expect(optionFor(explicit, "~")?.boost).toBe(97);
        expect(optionFor(explicit, "~!")?.boost).toBe(96);

        // Everything that leaves a clause unfinished reopens the popup on what follows it.
        const reopening = explicit?.options.filter(searchCompletionReactivates).map((o) => o.label);
        expect(reopening).toEqual([ "#", "#!", "~", "~!", "note", "not" ]);
    });

    describe("attribute names", () => {
        it("fetches labels for #, anchored past the prefix and past a negation", async () => {
            const result = await complete("towers #bo");

            expect(fetchAttributeNames).toHaveBeenCalledWith("label", "");
            expect(result?.from).toBe(8);
            expect(labelsOf(result)).toEqual([ "book", "archived" ]);

            expect((await complete("#!bo"))?.from).toBe(2);
            // What the negated marker inserts on its own, which reopens the popup on the name.
            expect(labelsOf(await complete("#!"))).toEqual([ "book", "archived" ]);
            expect(labelsOf(await complete("~!"))).toEqual([ "book", "archived" ]);
        });

        it("ranks a built-in below a name of the user's own that matches as well", async () => {
            const result = await complete("#a");

            expect(optionFor(result, "archived")?.boost).toBe(-99);
            expect(optionFor(result, "book")?.boost).toBeUndefined();
        });

        it("fetches relations for ~, and for the segment after note.relations.", async () => {
            await complete("~aut");

            expect(fetchAttributeNames).toHaveBeenCalledWith("relation", "");

            const inPath = await complete("note.relations.aut");

            expect(fetchAttributeNames).toHaveBeenLastCalledWith("relation", "");
            expect(inPath?.from).toBe(15);
            expect(labelsOf(inPath)).toEqual([ "book", "archived" ]);
        });

        it("fetches labels for the segment after note.labels.", async () => {
            const result = await complete("note.labels.");

            expect(fetchAttributeNames).toHaveBeenCalledWith("label", "");
            expect(result?.from).toBe(12);
        });

        it("leaves the fuzzy operators to the operator branch", async () => {
            expect(labelsOf(await complete("note.title ~="))).toContain("~=");
            expect(fetchAttributeNames).not.toHaveBeenCalled();
        });

        it("offers nothing when the request fails", async () => {
            vi.mocked(fetchAttributeNames).mockRejectedValue(new Error("offline"));

            expect(await complete("#bo")).toBeNull();
        });
    });

    describe("attribute values", () => {
        it("offers the values a label holds, anchored at the value and quoted where the lexer would split it", async () => {
            const result = await complete("#genre = fic");

            expect(server.get).toHaveBeenCalledWith("attribute-values/genre");
            expect(result?.from).toBe(9);
            expect(labelsOf(result)).toEqual([ "fiction", "science fiction" ]);
            expect(optionFor(result, "fiction")?.apply).toBeUndefined();
            expect(optionFor(result, "science fiction")?.apply).toBe("\"science fiction\"");
        });

        it("quotes a value spelled like a reserved operand, whatever its case", async () => {
            vi.mocked(server.get).mockResolvedValue([ "note", "Today", "monthly" ]);

            const result = await complete("#genre = t");

            // Bare, `note` is rejected as a keyword and `today` resolves to a date.
            expect(optionFor(result, "note")?.apply).toBe("\"note\"");
            expect(optionFor(result, "Today")?.apply).toBe("\"Today\"");
            expect(optionFor(result, "monthly")?.apply).toBeUndefined();
        });

        it("closes a quote the user opened rather than adding another", async () => {
            const result = await complete("#genre = \"science f");

            expect(result?.from).toBe(10);
            expect(optionFor(result, "science fiction")?.apply).toBe("science fiction\"");
        });

        it("leaves the operator being typed to the operator branch", async () => {
            expect(labelsOf(await complete("#genre ="))).toContain("=*");
            expect(server.get).not.toHaveBeenCalled();
        });

        it("stops once the value is finished, so the keywords follow it", async () => {
            expect(labelsOf(await complete("#genre = fiction an"))).toContain("and");
            expect(labelsOf(await complete("#genre = \"science fiction\" an"))).toContain("and");
            expect(server.get).not.toHaveBeenCalled();
        });

        it("follows a value through note.labels., and leaves relations alone", async () => {
            await complete("note.labels.genre *=* fic");

            expect(server.get).toHaveBeenCalledWith("attribute-values/genre");

            // The endpoint collects label values only; a relation's value is a note ID.
            await complete("~author = jo");

            expect(server.get).toHaveBeenCalledTimes(1);
        });

        it("offers nothing when the request fails", async () => {
            vi.mocked(server.get).mockRejectedValue(new Error("offline"));

            expect(await complete("#genre = fic")).toBeNull();
        });
    });

    describe("property values", () => {
        it("offers the values an enumerable property holds, and asks the server for none of them", async () => {
            const types = await complete("note.type = co");

            expect(types?.from).toBe(12);
            expect(labelsOf(types)).toContain("code");
            expect(labelsOf(types)).toContain("contentWidget");

            expect(labelsOf(await complete("note.isProtected = t"))).toEqual([ "true", "false" ]);
            // A space settles the operator, so the values come without typing one; directly after it
            // the operator can still be growing into `!=` or `=*`.
            expect(labelsOf(await complete("note.isProtected = "))).toEqual([ "true", "false" ]);
            expect(labelsOf(await complete("note.isProtected ="))).toContain("=*");
            expect(labelsOf(await complete("note.isArchived = t"))).toEqual([ "true", "false" ]);

            const mimes = await complete("note.mime = pyt");

            expect(optionFor(mimes, "text/x-python")?.detail).toBe("Python");
            // The lexer splits a bare `text/x-python` at the dash, so the value is inserted quoted.
            expect(optionFor(mimes, "text/x-python")?.apply).toBe("\"text/x-python\"");

            expect(server.get).not.toHaveBeenCalled();
        });

        it("follows the property through a traversal and a relation, and leaves the rest alone", async () => {
            expect(labelsOf(await complete("note.parents.type = co"))).toContain("code");
            expect(labelsOf(await complete("note.type = code and note.mime = pyt"))).toContain("text/x-python");
            expect(labelsOf(await complete("~author.type = co"))).toContain("code");

            // A property whose values nothing can enumerate falls through to the keywords, and a
            // label that happens to share a property's name is still a label.
            expect(labelsOf(await complete("note.title = so")))
                .toEqual([ "#", "#!", "~", "~!", "note", "and", "or", "not", "orderBy", "limit" ]);
            expect(labelsOf(await complete("note.labels.type = fic"))).toEqual([ "fiction", "science fiction" ]);
        });

        it("offers the smart dates after a date property, unquoted so the parser resolves them", async () => {
            const dates = await complete("note.dateCreated >= t");

            expect(labelsOf(dates)).toEqual([
                "now", "now-60", "today", "today-30", "month", "month-1", "year", "year-1"
            ]);
            // Quoting one would make it the text it spells instead of a date.
            expect(dates?.options.every((option) => option.apply === undefined)).toBe(true);
            expect(dates?.options.every((option) => option.detail)).toBe(true);

            for (const property of [ "dateModified", "utcDateCreated", "utcDateModified" ]) {
                expect(labelsOf(await complete(`note.${property} < `))).toContain("today");
            }

            // A quote the user opened is a date they are spelling out themselves.
            expect(await complete("note.dateCreated >= \"2")).toBeNull();
        });
    });
});

describe("searchCompletionIcon", () => {
    it("draws attribute names, the system ones with a cog rather than their own kind", async () => {
        vi.mocked(fetchAttributeNames).mockResolvedValue([ "book", "archived" ]);
        const labels = await complete("#a");

        expect(iconFor(labels, "book")).toBe("bx bx-hash");
        expect(iconFor(labels, "archived")).toBe("bx bx-cog");

        vi.mocked(fetchAttributeNames).mockResolvedValue([ "author", "template", "archived" ]);
        const relations = await complete("~a");

        expect(iconFor(relations, "author")).toBe("bx bx-transfer");
        expect(iconFor(relations, "template")).toBe("bx bx-cog");
        // Built-in as a label, an ordinary name as a relation.
        expect(iconFor(relations, "archived")).toBe("bx bx-transfer");
    });

    it("leaves everything else undrawn", async () => {
        expect(iconFor(await complete("no"), "note")).toBeUndefined();
        expect(iconFor(await complete("or"), "orderBy")).toBeUndefined();
        expect(iconFor(await complete("note."), "title")).toBeUndefined();
        // The marker is the icon; drawing one beside it reads as noise.
        expect(iconFor(await complete("no"), "#")).toBeUndefined();
        expect(iconFor(await complete("no"), "~")).toBeUndefined();
        expect(iconFor(await complete("#year >"), ">=")).toBeUndefined();
    });
});

function iconFor(result: CompletionResult | null, label: string) {
    const option = optionFor(result, label);

    return option ? searchCompletionIcon(option) : "no such option";
}

describe("note mentions", () => {
    const NOTES = [
        { notePath: "root/abc123", noteTitle: "Foo", notePathTitle: "Root / Foo", icon: "bx bx-file" },
        { notePath: "root/proj/def456", noteTitle: "Foobar", notePathTitle: "Root / Projects / Foobar", icon: "bx bx-note" }
    ];

    beforeEach(() => vi.mocked(server.get).mockResolvedValue(NOTES));

    it("offers the notes an @ names and inserts the id, taking the marker with it", async () => {
        const result = await complete("~template.noteId = @Fo");

        expect(server.get).toHaveBeenCalledWith("autocomplete?query=Fo&activeNoteId=none&fastSearch=true");
        // Offered from past the `@`, so "Fo" is matched against the titles.
        expect(result?.from).toBe(20);
        expect(labelsOf(result)).toEqual([ "Foo", "Foobar" ]);
        expect(optionFor(result, "Foo")?.detail).toBe("Root / Foo");
        expect(optionFor(result, "Foobar")?.boost).toBeLessThan(optionFor(result, "Foo")?.boost ?? 0);

        // The `@` at 19 is rewritten along with the "Fo" after it.
        expect(dispatchOf(result, "Foo", 22)).toEqual({
            changes: { from: 19, to: 22, insert: "abc123" },
            selection: { anchor: 25 }
        });
    });

    it("draws each note with its own icon", async () => {
        const result = await complete("@Fo");

        expect(result?.from).toBe(1);
        expect(searchCompletionIcon(optionFor(result, "Foo") ?? { label: "" })).toBe("bx bx-file");
        expect(searchCompletionIcon(optionFor(result, "Foobar") ?? { label: "" })).toBe("bx bx-note");
    });

    it("answers with the recently visited notes before anything is typed", async () => {
        const result = await complete("#book AND @");

        expect(server.get).toHaveBeenCalledWith("autocomplete?query=&activeNoteId=none&fastSearch=true");
        expect(labelsOf(result)).toEqual([ "Foo", "Foobar" ]);
    });

    it("opens on a standalone @ but not on one inside an attribute name", async () => {
        const inName = await complete("#foo@");

        expect(server.get).not.toHaveBeenCalledWith(expect.stringContaining("autocomplete?"));
        expect(labelsOf(inName)).toEqual([ "book", "archived" ]);

        // The same text with the marker standing on its own does reach the notes.
        expect(labelsOf(await complete("#foo @"))).toEqual([ "Foo", "Foobar" ]);
    });

    it("skips a suggestion carrying no note", async () => {
        vi.mocked(server.get).mockResolvedValue([ { noteTitle: "External", externalLink: "https://example.com" }, ...NOTES ]);

        expect(labelsOf(await complete("@Fo"))).toEqual([ "Foo", "Foobar" ]);
    });
});

/** Runs an option's rewrite against a stand-in editor and hands back what it dispatched. */
function dispatchOf(result: CompletionResult | null, label: string, to: number) {
    const option = optionFor(result, label);
    const apply = option?.apply;

    if (typeof apply !== "function" || !option) {
        throw new Error(`The '${label}' option inserts a fixed string rather than rewriting.`);
    }

    let dispatched: unknown;
    apply({ dispatch: (spec: unknown) => { dispatched = spec; } } as never, option, 0, to);

    return dispatched;
}

async function complete(text: string, opts?: { explicit?: boolean }) {
    return await searchCompletionSource(contextAt(text, opts));
}

function labelsOf(result: CompletionResult | null): string[] {
    return (result?.options ?? []).map((option) => option.label);
}

function optionFor(result: CompletionResult | null, label: string) {
    return result?.options.find((option) => option.label === label);
}

/** Stands in for the editor's context, whose `matchBefore` anchors the pattern at the cursor. */
function contextAt(text: string, { explicit = false } = {}): CompletionContext {
    const pos = text.length;

    return {
        pos,
        explicit,
        matchBefore(expr: RegExp) {
            // Flags carry over, the way CodeMirror's own `ensureAnchor` keeps them.
            const match = new RegExp(`(?:${expr.source})$`, expr.flags).exec(text);
            return match ? { from: pos - match[0].length, to: pos, text: match[0] } : null;
        }
    } as unknown as CompletionContext;
}
