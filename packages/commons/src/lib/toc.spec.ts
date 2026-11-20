import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCX_MIME, EPUB_MIME_TYPES, ODT_MIME } from "./office.js";
import {
    assignHeadingIds, findHeading, findTocFormatName, getBlobTag, getHeadingAncestors,
    getTocCacheTitle,
    hashHeadingSource, headingSource, MAX_TOC_HEADINGS, MAX_TOC_TITLE_LENGTH, normalizeTocTitle,
    type TocOutlineItem
} from "./toc.js";
import { blobIdFromDigest, fnv1aUpdate, PROTECTED_BLOB_PREFIX } from "./utils.js";

vi.mock("./utils.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./utils.js")>();
    return { ...actual, fnv1aUpdate: vi.fn(actual.fnv1aUpdate) };
});

const actualUtils = await vi.importActual<typeof import("./utils.js")>("./utils.js");

const TAG = "Kp3vXq0aB7";
const PROTECTED_TAG = "Rt5uWv7xY9";
const OTHER_TAG = "Zz9yXw8vU7";

afterEach(() => {
    vi.mocked(fnv1aUpdate).mockImplementation(actualUtils.fnv1aUpdate);
    vi.mocked(fnv1aUpdate).mockClear();
});

describe("findTocFormatName", () => {
    it("names the format of each document type of a file, and none for anything else", () => {
        expect(findTocFormatName("file", "application/pdf")).toBe("pdf");
        expect(findTocFormatName("file", DOCX_MIME)).toBe("docx");
        expect(findTocFormatName("file", ODT_MIME)).toBe("odt");
        for (const mime of EPUB_MIME_TYPES) {
            expect(findTocFormatName("file", mime)).toBe("epub");
        }
        expect(findTocFormatName("file", "application/zip")).toBeUndefined();
        expect(findTocFormatName("text", "application/pdf")).toBeUndefined();
    });
});

describe("getTocCacheTitle", () => {
    it("names the cache of a note, and the cache of an attachment after the attachment", () => {
        expect(getTocCacheTitle()).toBe("toc-cache.json");
        expect(getTocCacheTitle("abc123")).toBe("abc123.toc-cache.json");
    });
});

describe("getBlobTag", () => {
    it("takes the first ten characters of the blob id", () => {
        expect(getBlobTag("Kp3vXq0aB7dYw2ZfHc9L")).toBe("Kp3vXq0aB7");
    });

    it("gives the bytes of a protected document a tag that no ordinary blob id of them starts with", () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 the same bytes");
        const ordinary = blobIdFromDigest(new Uint8Array(createHash("sha512").update(bytes).digest()));
        const prefixed = Buffer.concat([ Buffer.from(PROTECTED_BLOB_PREFIX), bytes ]);
        const protectedBlobId = blobIdFromDigest(new Uint8Array(createHash("sha512").update(prefixed).digest()));

        expect(getBlobTag(protectedBlobId)).not.toBe(getBlobTag(ordinary));
        expect(ordinary.startsWith(getBlobTag(protectedBlobId))).toBe(false);
    });
});

describe("normalizeTocTitle", () => {
    it("removes control characters, the separator of the hash source among them", () => {
        expect(normalizeTocTitle("a\u0008b\u0000c\u001fd\u007fe\u000ef")).toBe("abcdef");
        expect(normalizeTocTitle("p\u0008q")).toBe("pq");
    });

    it("collapses white space, trims, and composes to NFC", () => {
        expect(normalizeTocTitle("  Spaced\t\n out   ")).toBe("Spaced out");
        expect(normalizeTocTitle("Résumé")).toBe("Résumé");
    });

    it("keeps markup as text", () => {
        expect(normalizeTocTitle("Section <b>1.1</b> & more")).toBe("Section <b>1.1</b> & more");
    });

    it("cuts at the limit, keeping a surrogate pair whole and trimming again", () => {
        expect(normalizeTocTitle("a".repeat(600))).toBe("a".repeat(MAX_TOC_TITLE_LENGTH));
        // The cut at 500 leaves a space at the end, which the second trim removes.
        expect(normalizeTocTitle(`${"a".repeat(499)} b`)).toBe("a".repeat(499));
        expect(normalizeTocTitle(`${"a".repeat(499)}\u{1f600}`)).toBe("a".repeat(499));
        expect(normalizeTocTitle(`${"a".repeat(499)}x́`)).toBe(`${"a".repeat(499)}x`);
        // Composed before the cut, so it fits.
        expect(normalizeTocTitle(`${"a".repeat(499)}가`)).toBe(`${"a".repeat(499)}가`);
    });

    it("changes nothing in its own result", () => {
        const titles = [
            `${"a".repeat(499)} b`, `${"a".repeat(499)}\u{1f600}`, " x ".repeat(300),
            "é".repeat(300), "가".repeat(300), `${"a".repeat(500)}́`,
            "back\u0008space", "", ...randomTitles(2_000)
        ];
        for (const title of titles) {
            const normalized = normalizeTocTitle(title);
            expect(normalizeTocTitle(normalized), JSON.stringify(title)).toBe(normalized);
            expect(normalized.length).toBeLessThanOrEqual(MAX_TOC_TITLE_LENGTH);
        }
    });
});

describe("headingSource", () => {
    it("joins the titles of the path with a backspace and ends with the index among the title's siblings", () => {
        const headings = outline("1. Parent", "  1.1 Children", "    1.1.1 Children",
            "    1.1.1 Children", "2. Parent");

        expect(headingSource(headings, 0)).toBe("1. Parent:1");
        expect(headingSource(headings, 2)).toBe("1. Parent\u00081.1 Children\u00081.1.1 Children:1");
        expect(headingSource(headings, 3)).toBe("1. Parent\u00081.1 Children\u00081.1.1 Children:2");
        expect(headingSource(headings, 4)).toBe("2. Parent:1");
    });

    it("gives the hash that the ids are computed with, without building the strings", () => {
        const headings = outline("Part", "  Intro", "    Scope", "  Methods", "Part", "  Intro",
            "Appendix", "  a/b", "    c", "  a", "    b/c", "  Ratio 1:2", "  Ratio 1", "    2");
        const ids = assignHeadingIds(headings, TAG, false);

        for (const [ index, id ] of ids.entries()) {
            expect(id.slice(0, 14), headingSource(headings, index))
                .toBe(hashHeadingSource(headingSource(headings, index)));
        }
    });
});

describe("assignHeadingIds", () => {
    it("gives a heading whose path has no title shared with a sibling the hash of its source", () => {
        const headings = outline("Chapter 1", "  Exercises", "Chapter 2", "  Exercises");
        const ids = assignHeadingIds(headings, TAG, false);

        expect(ids).toStrictEqual(headings.map((_, index) => hashHeadingSource(headingSource(headings, index))));
        expect(new Set(ids).size).toBe(4);
    });

    it("binds a heading to the blob when its title, or an ancestor's, is shared with a sibling", () => {
        const headings = outline("Summary", "  Notes", "Summary", "Part", "  Intro", "Part", "  Index");
        const ids = assignHeadingIds(headings, TAG, false);

        for (const index of [ 0, 1, 2, 3, 4, 5, 6 ]) {
            expect(ids[index]).toMatch(new RegExp(`^[0-9a-z]{14}\\.${TAG}$`));
        }
        expect(new Set(ids).size).toBe(7);
    });

    it("numbers the headings of equal sources, which only occur under a bound ancestor", () => {
        const headings = outline("Part", "  Intro", "Part", "  Intro");
        const ids = assignHeadingIds(headings, TAG, false);
        const hash = hashHeadingSource("Part\u0008Intro:1");

        expect(ids[1]).toBe(`${hash}.1.${TAG}`);
        expect(ids[3]).toBe(`${hash}.2.${TAG}`);
    });

    it("marks the ids of bound headings read from a protected blob", () => {
        const ids = assignHeadingIds(outline("Part", "  Intro", "Part", "  Intro", "Free"), PROTECTED_TAG, true);

        expect(ids[0]).toMatch(new RegExp(`^[0-9a-z]{14}\\.${PROTECTED_TAG}\\.p$`));
        expect(ids[1]).toMatch(new RegExp(`^[0-9a-z]{14}\\.1\\.${PROTECTED_TAG}\\.p$`));
        expect(ids[4]).toMatch(/^[0-9a-z]{14}$/);
    });

    it("tells titles apart whatever characters they hold", () => {
        const headings = outline("a/b", "  c", "a", "  b/c", "x:1", "  y", "x", "  1:y",
            "Ratio 1:2", "Ratio 1", "  2", normalizeTocTitle("p\u0008q"), "p", "  q");
        const ids = assignHeadingIds(headings, TAG, false);

        expect(headings[11].title).toBe("pq");
        expect(new Set(ids).size).toBe(14);
        for (const id of ids) {
            expect(id).toMatch(/^[0-9a-z]{14}$/);
        }
    });

    it("binds siblings whose titles are equal once normalized", () => {
        const long = "a".repeat(MAX_TOC_TITLE_LENGTH);
        const titles = [ "Two  spaces", "Two spaces", `${long}one`, `${long}two` ].map(normalizeTocTitle);
        const ids = assignHeadingIds(titles.map((title) => ({ title, level: 1 })), TAG, false);

        for (const id of ids) {
            expect(id.endsWith(`.${TAG}`)).toBe(true);
        }
    });

    it("names a heading by every ancestor, at any depth", () => {
        const chain = (level32: string, otherLevel32: string) => [
            ...Array.from({ length: 31 }, (_, index) => ({ title: `Level ${index + 1}`, level: index + 1 })),
            { title: level32, level: 32 },
            { title: "Summary", level: 33 },
            { title: otherLevel32, level: 32 }
        ];
        const childId = (headings: TocOutlineItem[], childIndex: number) =>
            assignHeadingIds(headings, TAG, false)[childIndex];

        const before = childId(chain("Group A", "Group B"), 32);
        expect(childId(chain("Group A renamed", "Group B"), 32)).not.toBe(before);

        // The same child under the other group of level 32.
        const moved = [ ...chain("Group A", "Group B").filter((heading) => heading.title !== "Summary"),
            { title: "Summary", level: 33 } ];
        expect(childId(moved, 33)).not.toBe(before);
    });

    it("hashes deep outlines in time linear in the length of the titles", () => {
        const headings = Array.from({ length: 20_000 }, (_, index) => ({
            title: `${index}`.padEnd(500, "x"), level: index + 1
        }));
        vi.mocked(fnv1aUpdate).mockClear();

        const ids = assignHeadingIds(headings, TAG, false);

        const hashed = vi.mocked(fnv1aUpdate).mock.calls
            .reduce((total, [ , value ]) => total + value.length, 0);
        expect(ids).toHaveLength(20_000);
        expect(hashed).toBeLessThan(2.1 * 20_000 * 500);
    });

    it("numbers headings whose hashes collide", async () => {
        vi.mocked(fnv1aUpdate).mockImplementation(() => 7);
        const headings = outline("Introduction", "Methods", "Results");

        const ids = assignHeadingIds(headings, TAG, false);

        expect(ids).toStrictEqual([ 1, 2, 3 ].map((ordinal) => `00000070000007.${ordinal}.${TAG}`));
        expect(await findHeading(ids[1], headings, ownTags(TAG))).toBe(1);
        expect(await findHeading(ids[1], headings, ownTags(OTHER_TAG))).toBe(-1);
    });
});

describe("findHeading", () => {
    /** Where a link to `before[index]`, made on the bytes of `TAG`, lands in `after`. */
    async function land(before: TocOutlineItem[], index: number, after: TocOutlineItem[], tag: string) {
        const id = assignHeadingIds(before, TAG, false)[index];
        return findHeading(id, after, ownTags(tag));
    }

    const book = outline("Preface", "Chapter 1", "  Summary", "  Notes", "  Summary", "Chapter 2",
        "  Exercises", "Chapter 3", "  Exercises");

    it("lands on the same heading in the same bytes, free or bound", async () => {
        for (const index of book.keys()) {
            expect(await land(book, index, book, TAG)).toBe(index);
        }
    });

    it("lands a free heading in other bytes, and gives a bound one the page", async () => {
        const inserted = outline("Preface", "Foreword", "Chapter 1", "  Summary", "  Notes",
            "  Summary", "Chapter 2", "  Exercises", "Chapter 3", "  Exercises");

        expect(await land(book, 3, inserted, OTHER_TAG)).toBe(4);
        expect(await land(book, 8, inserted, OTHER_TAG)).toBe(9);
        expect(await land(book, 4, inserted, OTHER_TAG)).toBe(-1);
        // The tag of the same bytes after an annotation save is another tag too.
        expect(await land(book, 2, book, OTHER_TAG)).toBe(-1);
    });

    it("gives the page after a rename of the heading or of an ancestor", async () => {
        const renamed = outline("Preface", "Chapter 1", "  Summary", "  Remarks", "  Summary",
            "Chapter Two", "  Exercises", "Chapter 3", "  Exercises");

        expect(await land(book, 3, renamed, OTHER_TAG)).toBe(-1);
        expect(await land(book, 6, renamed, OTHER_TAG)).toBe(-1);
        expect(await land(book, 8, renamed, OTHER_TAG)).toBe(8);
    });

    it("gives the page once a heading of the same title is inserted beside it, before or after", async () => {
        const headings = outline("Methods", "Summary", "Results");
        const before = outline("Methods", "Summary", "Summary", "Results");
        const after = outline("Methods", "Summary", "Results", "Summary");

        expect(await land(headings, 1, before, OTHER_TAG)).toBe(-1);
        expect(await land(headings, 1, after, OTHER_TAG)).toBe(-1);
        expect(await land(headings, 2, after, OTHER_TAG)).toBe(2);
    });

    it("gives the page after two sections of the same title swap places", async () => {
        const headings = outline("Summary", "  On cats", "Summary", "  On dogs");
        const swapped = outline("Summary", "  On dogs", "Summary", "  On cats");

        expect(await land(headings, 2, swapped, OTHER_TAG)).toBe(-1);
        expect(await land(headings, 3, swapped, OTHER_TAG)).toBe(-1);
    });

    it("gives the page after children of two parents of the same title are renamed into each other", async () => {
        const headings = outline("Part", "  Intro", "Part", "  Index");
        const renamed = outline("Part", "  Index", "Part", "  Intro");

        expect(assignHeadingIds(headings, TAG, false)[1]).toContain(`.${TAG}`);
        expect(await land(headings, 1, renamed, OTHER_TAG)).toBe(-1);
        expect(await land(headings, 1, headings, TAG)).toBe(1);
    });

    it("asks about the blob tag only for a bound id, in the form the id names", async () => {
        const headings = outline("Summary", "Summary", "Free");
        const isOwnTag = vi.fn(async () => true);

        expect(await findHeading(assignHeadingIds(headings, TAG, false)[2], headings, isOwnTag)).toBe(2);
        expect(isOwnTag).not.toHaveBeenCalled();

        expect(await findHeading(assignHeadingIds(headings, TAG, false)[1], headings, isOwnTag)).toBe(1);
        expect(isOwnTag).toHaveBeenLastCalledWith(TAG, false);

        const protectedId = assignHeadingIds(headings, PROTECTED_TAG, true)[1];
        expect(await findHeading(protectedId, headings, isOwnTag)).toBe(1);
        expect(isOwnTag).toHaveBeenLastCalledWith(PROTECTED_TAG, true);
        expect(isOwnTag).toHaveBeenCalledTimes(2);
    });

    it("gives the page when the tag is not the document's, or cannot be checked", async () => {
        const headings = outline("Summary", "Summary");
        const id = assignHeadingIds(headings, TAG, false)[1];

        expect(await findHeading(id, headings, async () => false)).toBe(-1);
        expect(await findHeading(id, headings, () => Promise.reject(new Error("No digest")))).toBe(-1);
    });

    it("finds nothing for an id of another form", async () => {
        const headings = outline("Summary", "Summary");
        const isOwnTag = vi.fn(async () => true);

        for (const id of [ "", "pdf-outline-0", "0k3x9aa1h7q2m", "0k3x9aa1h7q2mz.0.Kp3vXq0aB7",
            `0k3x9aa1h7q2mz.${TAG}.x`, "0K3X9AA1H7Q2MZ", "0k3x9aa1h7q2mz.Kp3vXq0aB" ]) {
            expect(await findHeading(id, headings, isOwnTag), id).toBe(-1);
        }
        expect(isOwnTag).not.toHaveBeenCalled();
        expect(await findHeading("0k3x9aa1h7q2mz", headings, isOwnTag)).toBe(-1);
    });
});

describe("a table of contents cut at MAX_TOC_HEADINGS", () => {
    const filler = Array.from({ length: MAX_TOC_HEADINGS - 1 },
        (_, index) => ({ title: `Section ${index}`, level: 1 }));
    // A unique "Summary" is the last heading kept, and a heading with a title follows it.
    const kept = [ ...filler, { title: "Summary", level: 1 } ];
    // A "Summary" inserted near the top pushes the first one past the cut.
    const inserted = [
        ...filler.slice(0, 100), { title: "Summary", level: 1 }, ...filler.slice(100)
    ];

    it("binds every heading it keeps", () => {
        const ids = assignHeadingIds(kept, TAG, false, { isCut: true });

        expect(ids.filter((id) => !id.endsWith(`.${TAG}`))).toStrictEqual([]);
        expect(assignHeadingIds(kept, TAG, false)[MAX_TOC_HEADINGS - 1]).toMatch(/^[0-9a-z]{14}$/);
    });

    it("never lets an inserted heading take the id of a heading past the cut", async () => {
        const id = assignHeadingIds(kept, TAG, false, { isCut: true })[MAX_TOC_HEADINGS - 1];

        expect(await findHeading(id, inserted, ownTags(OTHER_TAG), { isCut: true })).toBe(-1);
        expect(await findHeading(id, kept, ownTags(TAG), { isCut: true }))
            .toBe(MAX_TOC_HEADINGS - 1);
    });

    it("finds no heading for a free id, which a whole table of contents gave", async () => {
        const freeId = assignHeadingIds(kept, TAG, false)[MAX_TOC_HEADINGS - 1];
        const isOwnTag = vi.fn(async () => true);

        // The free id names the inserted heading once the first one is past the cut.
        expect(await findHeading(freeId, inserted, isOwnTag)).toBe(100);
        expect(await findHeading(freeId, kept, isOwnTag, { isCut: true })).toBe(-1);
        expect(isOwnTag).not.toHaveBeenCalled();
    });
});

describe("getHeadingAncestors", () => {
    interface Item { title: string; level?: number; group?: string }
    const titlesOf = (ancestors: readonly (readonly Item[])[]) =>
        ancestors.map((items) => items.map((item) => item.title).join(" > "));

    it("nests each item under the closest earlier item of a lower level", () => {
        const items = outline("Intro", "Setup", "  Linux", "    Kernel", "  Windows", "Usage");

        expect(titlesOf(getHeadingAncestors(items, (item) => item.level))).toStrictEqual([
            "", "", "Setup", "Setup > Linux", "Setup", ""
        ]);
    });

    it("nests an item without a level under nothing, and keeps the items around it nested", () => {
        const items: Item[] = [
            { title: "Setup", level: 1 },
            { title: "Anchor" },
            { title: "Linux", level: 2 }
        ];

        expect(titlesOf(getHeadingAncestors(items, (item) => item.level)))
            .toStrictEqual([ "", "", "Setup" ]);
    });

    it("keeps one stack per group", () => {
        const items: Item[] = [
            { title: "Chapter", level: 1, group: "heading" },
            { title: "Top", level: 1, group: "anchor" },
            { title: "Section", level: 2, group: "heading" },
            { title: "Inner", level: 2, group: "anchor" }
        ];

        expect(titlesOf(getHeadingAncestors(items, (item) => item.level, (item) => item.group)))
            .toStrictEqual([ "", "", "Chapter", "Top" ]);
    });

    it("skips levels and closes deeper items at a shallower one", () => {
        const items = outline("A", "    Deep", "  B", "C");

        expect(titlesOf(getHeadingAncestors(items, (item) => item.level)))
            .toStrictEqual([ "", "A", "A", "" ]);
        expect(getHeadingAncestors([], () => 1)).toStrictEqual([]);
    });
});

/** Headings from lines such as `"  Child"`, two spaces for each level below the top. */
function outline(...lines: string[]): TocOutlineItem[] {
    return lines.map((line) => {
        const title = line.trimStart();
        return { title, level: (line.length - title.length) / 2 + 1 };
    });
}

/** An `isOwnTag` for bytes whose ordinary blob tag is `tag`, and protected one `protectedTag`. */
function ownTags(tag: string, protectedTag = PROTECTED_TAG) {
    return async (blobTag: string, isProtected: boolean) =>
        blobTag === (isProtected ? protectedTag : tag);
}

/** `count` strings of 480 to 540 code units, from a seeded generator. */
function randomTitles(count: number) {
    const pieces = [ " ", "a", "Z", "́", "\u0008", "\t", "\u{1f600}", "ᄀ", "ᅡ",
        " ", " ", "e", "é" ];
    let seed = 42;
    const random = () => {
        seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
        return seed / 0x100000000;
    };

    return Array.from({ length: count }, () => {
        const length = 480 + Math.floor(random() * 60);
        let title = "";
        while (title.length < length) {
            title += pieces[Math.floor(random() * pieces.length)];
        }
        return title;
    });
}
