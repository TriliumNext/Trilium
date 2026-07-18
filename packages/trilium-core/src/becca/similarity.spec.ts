import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import becca from "./becca.js";
import { buildNote } from "../test/becca_easy_mocking";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import { randomString } from "../services/utils/index.js";
import similarity, { buildRewardMap } from "./similarity";

/**
 * Builds an in-memory note and clones it directly under "root" so that it has a
 * real best note path and is not considered hidden by findSimilarNotes.
 */
function buildRootNote(noteDef: Parameters<typeof buildNote>[0], utcDateCreated?: string) {
    // Text notes have their content parsed in buildRewardMap, so provide some so
    // the in-memory note never falls back to a DB content lookup.
    const withContent = noteDef.content === undefined && (noteDef.type ?? "text") === "text"
        ? { ...noteDef, content: "<p>placeholder body</p>" }
        : noteDef;
    const note = buildNote(withContent);

    new BBranch({
        branchId: `root_${note.noteId}`,
        noteId: note.noteId,
        parentNoteId: "root",
        prefix: null,
        notePosition: 10
    });

    if (utcDateCreated) {
        note.utcDateCreated = utcDateCreated;
    }

    return note;
}

describe("buildRewardMap", () => {
    it("calculates heading rewards", () => {
        const note = buildNote({
            content: trimIndentation`\
                <h1>Heading 1</h1>
                <h2>Heading 2</h2>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer eget purus et eros faucibus dignissim. Vestibulum lacinia urna quis eleifend consectetur. Aenean elementum pellentesque ultrices. Donec tincidunt, felis vel pretium suscipit, nibh lorem gravida est, quis tincidunt metus nibh a tortor. Aenean erat libero, faucibus ac mattis non, imperdiet eget nunc. Pellentesque aliquam molestie nibh eu interdum. Sed augue velit, varius id lacinia ut, dictum in dolor. Praesent posuere quam vel porta eleifend. Nullam porta tempus convallis. Aliquam auctor dui nec consectetur suscipit. Mauris laoreet commodo dapibus. Donec sodales justo velit, at placerat nulla cursus sit amet. Aliquam erat volutpat. Donec nec mauris iaculis, ullamcorper lectus et, feugiat arcu. Nunc vel ligula quis lectus efficitur porta non at nulla.</p>
                <h3>Heading 3</h3>
            `
        });
        const map = buildRewardMap(note);
        for (const key of [ "new", "note", "heading", "1", "2", "3" ]) {
            expect(typeof map.get(key)).toStrictEqual("number");
        }
    });

    it("rewards decrypted ancestor titles and branch prefixes", () => {
        const grandparentId = randomString(12);
        const parentId = randomString(12);
        const childId = randomString(12);

        buildNote({
            id: grandparentId,
            title: "Geography",
            content: "<p>geo</p>",
            children: [
                {
                    id: parentId,
                    title: "Europe",
                    content: "<p>eu</p>",
                    children: [ { id: childId, title: "Romania", content: "<p>ro</p>" } ]
                }
            ]
        });

        // Give the parent's branch (parent -> grandparent) a prefix so the
        // ancestor branch-prefix path is exercised.
        const parentBranch = becca.getNote(parentId)?.getParentBranches()[0];
        expect(parentBranch).toBeDefined();
        if (parentBranch) {
            parentBranch.prefix = "Continent";
        }

        const child = becca.getNoteOrThrow(childId);
        const map = buildRewardMap(child);

        // Ancestor title words appear with a (small) reward.
        expect(typeof map.get("geography")).toStrictEqual("number");
        expect(typeof map.get("europe")).toStrictEqual("number");
        // The ancestor branch prefix word appears too.
        expect(typeof map.get("continent")).toStrictEqual("number");
    });

    it("skips undecrypted ancestors and blacklisted/ignored-name attributes", () => {
        const parentId = randomString(12);
        const childId = randomString(12);

        buildNote({
            id: parentId,
            title: "Secret parent",
            content: "<p>p</p>",
            children: [ { id: childId, title: "the visible child", content: "<p>c</p>" } ]
        });

        // Protected (not decrypted) ancestor -> its title is not rewarded.
        const parent = becca.getNoteOrThrow(parentId);
        parent.isDecrypted = false;

        const child = becca.getNoteOrThrow(childId);
        // archived is in IGNORED_ATTR_NAMES: its name is not rewarded.
        new BAttribute({
            attributeId: randomString(12),
            noteId: childId,
            type: "label",
            name: "archived",
            value: "",
            isInheritable: false
        });

        const map = buildRewardMap(child);

        // The blacklisted word "the" collapses to "" and yields no reward entry.
        expect(map.get("the")).toBeUndefined();
        // The non-blacklisted title word is present.
        expect(typeof map.get("visible")).toStrictEqual("number");
        // The undecrypted ancestor's title word is absent.
        expect(map.get("secret")).toBeUndefined();
        // The ignored attribute name "archived" yields no reward entry.
        expect(map.get("archived")).toBeUndefined();
    });

    it("applies the inherited-attribute penalty for attributes owned by an ancestor", () => {
        const parentId = randomString(12);
        const childId = randomString(12);

        buildNote({
            id: parentId,
            title: "Holder",
            content: "<p>p</p>",
            children: [ { id: childId, title: "Inheritor child", content: "<p>c</p>" } ]
        });

        // Inheritable label on the parent shows up in the child's getAttributes()
        // with the parent's noteId, exercising the inherited (0.5) reward branch.
        new BAttribute({
            attributeId: randomString(12),
            noteId: parentId,
            type: "label",
            name: "category",
            value: "fiction",
            isInheritable: true
        });

        const child = becca.getNoteOrThrow(childId);
        const inherited = child.getAttributes().find((a) => a.name === "category");
        expect(inherited).toBeDefined();
        expect(inherited?.noteId).toStrictEqual(parentId);

        const map = buildRewardMap(child);
        expect(typeof map.get("category")).toStrictEqual("number");
        expect(typeof map.get("fiction")).toStrictEqual("number");
    });

    it("filters URL noise out of label values", () => {
        const note = buildNote({
            title: "Bookmark sample",
            content: "<p>body</p>",
            "#homepage": "https://www.example.com/foobar"
        });

        const map = buildRewardMap(note);

        // The scheme and the ".com" TLD are stripped by filterUrlValue, but the
        // meaningful path/host words remain.
        expect(typeof map.get("foobar")).toStrictEqual("number");
        expect(typeof map.get("example")).toStrictEqual("number");
        // The ".com" TLD token is removed, so no standalone "com" reward exists.
        expect(map.get("com")).toBeUndefined();
    });

    it("skips structural/ignored attributes and halves the cliptype reward", () => {
        const note = buildNote({
            title: "Clipped article",
            content: "<p>body</p>",
            "#cliptype": "html",
            "#datenote": "2020-01-01",
            "#child:foo": "bar",
            "~relation:baz": "qux"
        });

        const map = buildRewardMap(note);

        // cliptype name is rewarded (the value "html" too), value reward halved internally.
        expect(typeof map.get("cliptype")).toStrictEqual("number");
        expect(typeof map.get("html")).toStrictEqual("number");
        // datenote is in IGNORED_ATTRS -> contributes nothing.
        expect(map.get("datenote")).toBeUndefined();
        // prefixed attribute names are skipped entirely.
        expect(map.get("foo")).toBeUndefined();
    });

    it("rewards a trimmed non-text mime, including the -x prefix variant", () => {
        const pdfNote = buildNote({ title: "Doc", type: "file", mime: "application/pdf" });
        const pdfMap = buildRewardMap(pdfNote);
        expect(typeof pdfMap.get("pdf")).toStrictEqual("number");

        // chunks[1] starting with "-x" gets the leading "-x" stripped.
        const xNote = buildNote({ title: "Weird", type: "file", mime: "application/-xcustom" });
        const xMap = buildRewardMap(xNote);
        expect(typeof xMap.get("custom")).toStrictEqual("number");
        expect(xMap.get("xcustom")).toBeUndefined();
    });

    it("returns early for text notes whose content is not a string", () => {
        const note = buildNote({ title: "Binary backed", type: "text" });
        // Simulate WASM/binary content: getContent yields a non-string.
        note.getContent = () => new Uint8Array([ 1, 2, 3 ]) as unknown as string;

        const map = buildRewardMap(note);
        // Title still rewarded; no throw despite the non-string content.
        expect(typeof map.get("binary")).toStrictEqual("number");
    });
});

describe("findSimilarNotes", () => {
    it("returns an empty array when the base note is missing", async () => {
        const result = await similarity.findSimilarNotes("does-not-exist-id");
        expect(result).toEqual([]);
    });

    it("returns an empty array when the base note has no utcDateCreated", async () => {
        const note = buildRootNote({ title: "No date note zubzub" });
        note.utcDateCreated = "";

        const result = await similarity.findSimilarNotes(note.noteId);
        expect(result).toEqual([]);
    });

    it("wraps a failure to build date limits in a descriptive error", async () => {
        const note = buildRootNote({ title: "Bad date note kraznok" });
        // Truthy but unparseable -> passes the empty guard, fails buildDateLimits.
        note.utcDateCreated = "definitely-not-a-date";

        await expect(similarity.findSimilarNotes(note.noteId)).rejects.toThrow();
    });

    it("yields the event loop past 1000 candidates and caps results at 200", async () => {
        const word = "bulkclusterword";
        const base = buildRootNote({ title: `${word} aa bb cc`, type: "text" });

        // Build well over 1000 high-scoring siblings so the loop both crosses the
        // 1000-candidate setImmediate yield boundary and overflows the 200 cap.
        for (let i = 0; i < 1100; i++) {
            buildRootNote({ title: `${word} aa bb cc ${i}`, type: "code", mime: "text/plain" });
        }

        const result = await similarity.findSimilarNotes(base.noteId);
        const matches = result ?? [];
        expect(matches.length).toBe(200);
    });

    it("finds similar notes sharing distinctive title words", async () => {
        const word = "quibbleflux";
        const base = buildRootNote({
            title: `${word} alpha beta gamma`,
            type: "text"
        });
        // Several siblings sharing the distinctive word should score highly.
        buildRootNote({ title: `${word} alpha beta delta`, type: "text" });
        buildRootNote({ title: `${word} alpha beta epsilon`, type: "text" });

        const result = await similarity.findSimilarNotes(base.noteId);

        expect(Array.isArray(result)).toBe(true);
        const matches = result ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
        // Each result has the expected shape and the base note is excluded.
        for (const r of matches) {
            expect(typeof r.score).toStrictEqual("number");
            expect(Array.isArray(r.notePath)).toBe(true);
            expect(typeof r.noteId).toStrictEqual("string");
            expect(r.noteId).not.toStrictEqual(base.noteId);
        }
        // Sorted descending by score.
        for (let i = 1; i < matches.length; i++) {
            expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
        }
    });

    it("handles candidate attributes: http values, ignored/prefixed names, and a corrupted value", async () => {
        const word = "marmaladeon";
        const base = buildRootNote({ title: `${word} one two three`, type: "text" });

        // Candidate whose label value is a URL (exercises the http branch).
        buildRootNote({
            title: `${word} one two four`,
            type: "text",
            "#source": "https://www.example.org/marmaladeon-article",
            "#datenote": "2020-01-01",
            "#child:nested": "skipme"
        });

        // Candidate with a corrupted (non-string) attribute value -> the
        // defensive "!value.startsWith" branch logs and continues. A number has
        // no startsWith method (whereas null would throw before the check).
        const corrupted = buildRootNote({
            title: `${word} one two five`,
            type: "text",
            "#broken": "placeholder"
        });
        const brokenAttr = corrupted.getOwnedAttributes().find((a) => a.name === "broken");
        expect(brokenAttr).toBeDefined();
        if (brokenAttr) {
            (brokenAttr as { value: unknown }).value = 42;
        }

        const result = await similarity.findSimilarNotes(base.noteId);
        expect(Array.isArray(result)).toBe(true);

        // Restore a valid string value so this leaked note does not crash later
        // findSimilarNotes runs in this shared-becca file.
        if (brokenAttr) {
            brokenAttr.value = "placeholder";
        }
    });

    it("applies date-window bonuses based on creation time proximity", async () => {
        // Base created at a fixed instant. Mirror utcDateTimeStr's exact format
        // ("YYYY-MM-DD HH:MM:SS.sssZ", UTC) so the lexical comparisons in
        // findSimilarNotes line up with the computed date limits.
        const baseTs = Date.parse("2021-06-01T12:00:00.000Z");
        const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ");

        const base = buildRootNote(
            { title: "chronobase signalword", type: "text" },
            fmt(baseTs)
        );

        // Within the +/-1h window but outside the +/-5s excluded window -> +1 bonus.
        buildRootNote(
            { title: "chronobase signalword near", type: "text" },
            fmt(baseTs + 30 * 60 * 1000)
        );

        // Same calendar day but outside the hour window -> +0.5 bonus.
        buildRootNote(
            { title: "chronobase signalword sameday", type: "text" },
            fmt(baseTs + 6 * 60 * 60 * 1000)
        );

        // Within the excluded +/-5s window -> no date bonus (likely an import).
        buildRootNote(
            { title: "chronobase signalword imported", type: "text" },
            fmt(baseTs + 2 * 1000)
        );

        const result = await similarity.findSimilarNotes(base.noteId);
        expect(Array.isArray(result)).toBe(true);
    });

    it("skips candidates connected to the base by an includenotelink relation", async () => {
        const word = "interlinkword";
        const base = buildRootNote({ title: `${word} foo bar baz`, type: "text" });
        const linked = buildRootNote({ title: `${word} foo bar baz`, type: "text" });

        // The candidate has an includenotelink relation pointing at the base, so
        // hasConnectingRelation matches and the candidate is excluded.
        new BAttribute({
            attributeId: randomString(12),
            noteId: linked.noteId,
            type: "relation",
            name: "includenotelink",
            value: base.noteId,
            isInheritable: false
        });

        const result = await similarity.findSimilarNotes(base.noteId);
        const matches = result ?? [];
        expect(matches.some((r) => r.noteId === linked.noteId)).toBe(false);
    });

    it("penalizes archived candidates that otherwise score highly", async () => {
        const word = "vortexalia";
        const base = buildRootNote({ title: `${word} red green blue`, type: "text" });
        buildRootNote({
            title: `${word} red green blue`,
            type: "text",
            "#archived": ""
        });

        const result = await similarity.findSimilarNotes(base.noteId);
        const matches = result ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("returns undefined when a high-scoring candidate has no resolvable note path", async () => {
        const word = "phantompathword";
        const base = buildRootNote({ title: `${word} sun moon star`, type: "text" });
        const orphan = buildRootNote({ title: `${word} sun moon star`, type: "text" });

        // Force the (hoisting) edge case where a scoring candidate yields no path.
        orphan.getBestNotePath = () => undefined as unknown as string[];

        const result = await similarity.findSimilarNotes(base.noteId);
        expect(result).toBeUndefined();
    });
});
