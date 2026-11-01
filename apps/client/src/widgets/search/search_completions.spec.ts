import { beforeEach, describe, expect, it, vi } from "vitest";

import server from "../../services/server";
import { type SearchCompletion, searchCompletionAt, type SearchEntry } from "./search_completions";

// The descriptions are catalogue lookups, which specs don't initialize; the keys identify them.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
// Modules loaded behind this one request through the server as they load, so the stub answers from
// the start rather than from the first `beforeEach`.
vi.mock("../../services/server", () => ({ default: { get: vi.fn(async () => []) } }));

beforeEach(() => {
    vi.mocked(server.get).mockReset().mockResolvedValue([ "fiction", "science fiction" ]);
});

const KEYWORDS = [ "#", "#!", "~", "~!", "note", "and", "or", "not", "orderBy", "limit" ];

describe("searchCompletionAt", () => {
    it("offers the note object and the keywords for a word only when asked, anchored at its start", async () => {
        // A plain word is most often a search term, so typing one opens nothing.
        expect(complete("#book AND no")).toBeNull();

        const result = complete("#book AND no", { explicit: true });

        expect(result).toMatchObject({ kind: "entries", from: 10, query: "no", preselect: true });
        expect(await titlesOf(result)).toEqual(KEYWORDS);
        // Both complete with what has to follow them, which the list then opens on.
        expect((await entryFor(result, "note"))?.insert).toBe("note.");
        expect((await entryFor(result, "not"))?.insert).toBe("not(");
        expect((await entryFor(result, "note"))?.description).toBe("search_completion.note");
    });

    it("offers the sort directions only once an orderBy is open", async () => {
        expect(await titlesOf(complete("#book de", { explicit: true }))).not.toContain("desc");

        const ordering = complete("#book orderBy #year de", { explicit: true });

        expect(await titlesOf(ordering)).toContain("desc");
        expect((await entryFor(ordering, "asc"))?.description).toBe("order_by.asc");
    });

    it("narrows an orderBy to what can follow the key being written", async () => {
        // A key is a property path or an attribute name, which the branches above answer for.
        expect(await titlesOf(complete("#book orderBy n", { explicit: true }))).toEqual([ "#", "~", "note" ]);
        expect(await titlesOf(complete("#book orderBy ", { explicit: true }))).toEqual([ "#", "~", "note" ]);

        // Once a key stands there it can be sorted, followed by another, or cut short.
        expect(await titlesOf(complete("#book orderBy note.title d", { explicit: true })))
            .toEqual([ "asc", "desc", "limit" ]);
        expect(await titlesOf(complete("#book orderBy note.title desc, note.dateCreated a", { explicit: true })))
            .toEqual([ "asc", "desc", "limit" ]);

        // A comma opens the next key, which has no direction of its own yet.
        expect(await titlesOf(complete("#book orderBy note.title, n", { explicit: true }))).toEqual([ "#", "~", "note" ]);

        // An ordering names a key and sorts on it; nothing in it is compared.
        expect(complete("#book orderBy note.title =")).toBeNull();

        // Outside an ordering the keywords are untouched.
        expect(await titlesOf(complete("#book n", { explicit: true }))).toEqual(KEYWORDS);
    });

    it("offers every operator once one of their characters is typed, with nothing highlighted", async () => {
        const result = complete("#year >");

        expect(result).toMatchObject({ kind: "entries", from: 6, query: ">", preselect: false });
        expect(await titlesOf(result)).toEqual([
            "=", "!=", "*=*", "=*", "*=", ">", ">=", "<", "<=", "%=", "~=", "~*"
        ]);
        expect((await entriesOf(result)).every((entry) => entry.description)).toBe(true);
    });

    it("offers only the operators the operand accepts", async () => {
        // `note.text` is matched, never ordered or compared exactly.
        expect(await titlesOf(complete("note.text >"))).toEqual([ "*=*" ]);
        expect(await titlesOf(complete("~author.text ="))).toEqual([ "*=*" ]);

        // Content is matched too, but with every matching operator.
        const content = await titlesOf(complete("note.content ="));
        expect(content).toContain("%=");
        expect(content).not.toContain(">=");
        expect(await titlesOf(complete("note.rawContent ="))).toEqual(content);

        // A relation is compared only through a property of the note it names.
        expect(complete("~author =")).toBeNull();
        expect(complete("note.relations.author >")).toBeNull();
        // An explicit request past one is left with the keywords alone.
        expect(await titlesOf(complete("~author ", { explicit: true }))).toEqual(KEYWORDS);

        // The last segment decides, and a name the user chose after `labels.` restricts nothing.
        expect(await titlesOf(complete("note.parents.title >"))).toContain(">");
        expect(await titlesOf(complete("note.labels.text ="))).toContain("=");
    });

    it("offers path segments after a dot, anchored at the segment being typed", async () => {
        const root = complete("note.");

        expect(root).toMatchObject({ kind: "entries", from: 5, query: "" });
        expect(await titlesOf(root)).toContain("title");
        expect(await titlesOf(root)).toContain("parents");
        expect(await titlesOf(root)).toContain("content");
        // Each with the icon of what it holds, the attribute ones with their marker's.
        expect((await entryFor(root, "title"))?.icon).toBe("bx bx-heading");
        expect((await entryFor(root, "utcDateModified"))?.icon).toBe("bx bx-calendar");
        expect((await entryFor(root, "labelCount"))?.icon).toBe("bx bx-hash");
        expect((await entryFor(root, "relations"))?.icon).toBe("bx bx-transfer");

        const partial = complete("#book AND note.date");

        expect(partial).toMatchObject({ from: 15, query: "date" });
        expect(await titlesOf(partial)).toEqual(await titlesOf(root));
    });

    it("walks a path through a relation and through a traversal", async () => {
        expect(await titlesOf(complete("~author."))).toContain("title");
        expect(await titlesOf(complete("note.parents."))).toContain("title");
        expect(await titlesOf(complete("~author.relations.son."))).toContain("title");
    });

    it("offers a sort key only the segments ValueExtractor can sort on", async () => {
        const everywhere = await titlesOf(complete("#book AND note."));
        expect(everywhere).toEqual(expect.arrayContaining([ "ancestors", "links", "backlinks", "content", "text" ]));

        const sortKey = await titlesOf(complete("#book orderBy note."));
        expect(sortKey).toEqual(expect.arrayContaining([ "title", "parents", "children", "labels", "relations" ]));
        for (const unsortable of [ "ancestors", "links", "backlinks", "content", "rawContent", "text" ]) {
            expect(sortKey).not.toContain(unsortable);
        }

        expect(await titlesOf(complete("#book orderBy note.title, note.parents."))).not.toContain("links");
        expect(await titlesOf(complete("#book orderBy note.title limit 10 AND note."))).toContain("links");
    });

    it("stops where a terminal property ends the path", () => {
        expect(complete("note.title.")).toBeNull();
        expect(complete("note.labels.publicationYear.")).toBeNull();
    });

    it("stays quiet on empty space, and offers everything when asked explicitly, the markers first", async () => {
        expect(complete("#book ")).toBeNull();

        const explicit = complete("#book ", { explicit: true });

        expect(explicit).toMatchObject({ from: 6, query: "" });
        // The words and the four attribute markers, then every operator.
        const titles = await titlesOf(explicit);
        expect(titles).toHaveLength(22);
        expect(titles.slice(0, 4)).toEqual([ "#", "#!", "~", "~!" ]);
    });

    describe("attribute names", () => {
        it("offers labels for #, anchored past the prefix and past a negation", () => {
            expect(complete("towers #bo")).toMatchObject({ kind: "attributes", type: "label", from: 8, query: "bo" });
            expect(complete("#!bo")).toMatchObject({ kind: "attributes", type: "label", from: 2, query: "bo" });
            // What the markers insert on their own, which opens the list on the name.
            expect(complete("#!")).toMatchObject({ kind: "attributes", type: "label", query: "" });
            expect(complete("~!")).toMatchObject({ kind: "attributes", type: "relation", query: "" });
        });

        it("offers relations for ~, and the names after note.labels. and note.relations.", () => {
            expect(complete("~aut")).toMatchObject({ kind: "attributes", type: "relation", query: "aut" });
            expect(complete("note.relations.aut")).toMatchObject({ kind: "attributes", type: "relation", from: 15, query: "aut" });
            expect(complete("note.labels.")).toMatchObject({ kind: "attributes", type: "label", from: 12, query: "" });
        });

        it("leaves the fuzzy operators to the operator branch", async () => {
            const result = complete("note.title ~=");

            expect(result?.kind).toBe("entries");
            expect(await titlesOf(result)).toContain("~=");
        });
    });

    describe("attribute values", () => {
        it("offers the values a label holds, anchored at the value and quoted where the lexer would split it", async () => {
            const result = complete("#genre = fic");

            expect(result).toMatchObject({ kind: "entries", key: "values:genre", from: 9, query: "fic", preselect: false });
            expect(await titlesOf(result)).toEqual([ "fiction", "science fiction" ]);
            expect(server.get).toHaveBeenCalledWith("attribute-values/genre");
            expect((await entryFor(result, "fiction"))?.insert).toBe("fiction");
            expect((await entryFor(result, "science fiction"))?.insert).toBe("\"science fiction\"");
        });

        it("offers no values where looking them up fails, rather than failing the list", async () => {
            vi.mocked(server.get).mockRejectedValue(new Error("offline"));

            expect(await entriesOf(complete("#genre = fic"))).toEqual([]);
        });

        it("quotes a value spelled like a reserved operand, whatever its case", async () => {
            vi.mocked(server.get).mockResolvedValue([ "note", "Today", "monthly" ]);

            const result = complete("#genre = t");

            // Bare, `note` is rejected as a keyword and `today` resolves to a date.
            expect((await entryFor(result, "note"))?.insert).toBe("\"note\"");
            expect((await entryFor(result, "Today"))?.insert).toBe("\"Today\"");
            expect((await entryFor(result, "monthly"))?.insert).toBe("monthly");
        });

        it("closes a quote the user opened rather than adding another", async () => {
            const result = complete("#genre = \"science f");

            expect(result).toMatchObject({ from: 10, query: "science f" });
            expect((await entryFor(result, "science fiction"))?.insert).toBe("science fiction\"");
        });

        it("leaves the operator being typed to the operator branch", () => {
            expect(complete("#genre =")).toMatchObject({ kind: "entries", key: "operators" });
        });

        it("stops once the value is finished, so the keywords follow it", async () => {
            expect(await titlesOf(complete("#genre = fiction an", { explicit: true }))).toContain("and");
            expect(await titlesOf(complete("#genre = \"science fiction\" an", { explicit: true }))).toContain("and");
        });

        it("follows a value through note.labels., and leaves relations alone", () => {
            expect(complete("note.labels.genre *=* fic")).toMatchObject({ key: "values:genre" });

            // The endpoint collects label values only; a relation's value is a note ID.
            expect(complete("~author = jo")).toBeNull();
        });
    });

    describe("property values", () => {
        it("offers the values an enumerable property holds, and asks the server for none of them", async () => {
            const types = complete("note.type = co");

            expect(types).toMatchObject({ from: 12, query: "co" });
            expect(await titlesOf(types)).toContain("code");
            expect(await titlesOf(types)).toContain("contentWidget");
            expect((await entryFor(types, "code"))?.icon).toBe("bx bx-code");

            expect(await titlesOf(complete("note.isProtected = t"))).toEqual([ "true", "false" ]);
            // A space settles the operator, so the values come without typing one; directly after it
            // the operator can still be growing into `!=` or `=*`.
            expect(await titlesOf(complete("note.isProtected = "))).toEqual([ "true", "false" ]);
            expect(await titlesOf(complete("note.isProtected ="))).toContain("=*");
            expect(await titlesOf(complete("note.isArchived = t"))).toEqual([ "true", "false" ]);

            expect(server.get).not.toHaveBeenCalled();
        });

        it("offers the MIME types the notes carry, in the order the server counts them", async () => {
            vi.mocked(server.get).mockResolvedValue([
                { mime: "application/pdf", count: 12 },
                { mime: "text/x-python", count: 3 },
                { mime: "text/mermaid", count: 2 },
                { mime: "image/png", count: 1 }
            ]);

            const mimes = complete("note.mime = ");

            expect(await titlesOf(mimes)).toEqual([ "application/pdf", "text/x-python", "text/mermaid", "image/png" ]);
            expect(server.get).toHaveBeenCalledWith("search/note-mimes");
            // A code language is named and drawn as the language dropdown draws it, the rest as the
            // note tree draws a note of that type.
            expect(await entryFor(mimes, "text/x-python")).toMatchObject({ description: "Python", icon: "bx bxl-python" });
            expect((await entryFor(mimes, "application/pdf"))?.icon).toBe("bx bxs-file-pdf");
            expect((await entryFor(mimes, "image/png"))?.icon).toBe("bx bx-image");
            expect((await entryFor(mimes, "text/mermaid"))?.icon).toBe("bx bx-selection");
            // The lexer splits a bare `text/x-python` at the dash, so the value is inserted quoted.
            expect((await entryFor(mimes, "text/x-python"))?.insert).toBe("\"text/x-python\"");
            expect((await entryFor(complete("note.mime = 'app"), "application/pdf"))?.insert).toBe("application/pdf'");

            vi.mocked(server.get).mockRejectedValue(new Error("offline"));
            expect(await entriesOf(complete("note.mime = "))).toEqual([]);
        });

        it("follows the property through a traversal and a relation, and leaves the rest alone", async () => {
            expect(await titlesOf(complete("note.parents.type = co"))).toContain("code");
            expect(complete("note.type = code and note.mime = pyt")).toMatchObject({ key: "property:mime" });
            expect(await titlesOf(complete("~author.type = co"))).toContain("code");

            // A property whose values nothing can enumerate falls through to the keywords, which
            // wait to be asked for, and a label that happens to share a property's name is still a
            // label.
            expect(complete("note.title = so")).toBeNull();
            expect(await titlesOf(complete("note.title = so", { explicit: true }))).toEqual(KEYWORDS);
            expect(complete("note.labels.type = fic")).toMatchObject({ key: "values:type" });
        });

        it("offers the smart dates after a date property, unquoted so the parser resolves them", async () => {
            const dates = await entriesOf(complete("note.dateCreated >= t"));

            expect(dates.map((date) => date.title)).toEqual([
                "now", "now-60", "today", "today-30", "month", "month-1", "year", "year-1"
            ]);
            // Quoting one would make it the text it spells instead of a date.
            expect(dates.every((date) => date.insert === date.title && date.description)).toBe(true);

            for (const property of [ "dateModified", "utcDateCreated", "utcDateModified" ]) {
                expect(await titlesOf(complete(`note.${property} < `))).toContain("today");
            }

            // A quote the user opened is a date they are spelling out themselves.
            expect(complete("note.dateCreated >= \"2")).toBeNull();
        });
    });

    describe("note mentions", () => {
        it("offers the notes for a standalone @, from the marker, and leaves one inside an attribute name to the names", () => {
            expect(complete("@Al")).toEqual({ kind: "notes", from: 0, query: "Al" });
            // Neither the values of the label it is compared with nor, when asked, the keywords.
            expect(complete("#author = @Al")).toEqual({ kind: "notes", from: 10, query: "Al" });
            expect(complete("#book AND @", { explicit: true })).toEqual({ kind: "notes", from: 10, query: "" });

            // `@` is a name character to the lexer, so the names go on being offered.
            expect(complete("#foo@")).toMatchObject({ kind: "attributes", query: "foo@" });
        });

        it("keeps a title with spaces in the query, up to the next attribute or bracket", () => {
            expect(complete("@Lord of the ")).toEqual({ kind: "notes", from: 0, query: "Lord of the " });
            expect(complete("#author = @J. R. R")).toEqual({ kind: "notes", from: 10, query: "J. R. R" });

            expect(complete("@Lord of #bo")).toMatchObject({ kind: "attributes", query: "bo" });
        });
    });
});

function complete(text: string, { explicit = false } = {}) {
    return searchCompletionAt(text, explicit);
}

async function entriesOf(result: SearchCompletion | null): Promise<SearchEntry[]> {
    return result?.kind === "entries" ? await result.entries() : [];
}

async function titlesOf(result: SearchCompletion | null) {
    return (await entriesOf(result)).map((entry) => entry.title);
}

async function entryFor(result: SearchCompletion | null, title: string) {
    return (await entriesOf(result)).find((entry) => entry.title === title);
}
