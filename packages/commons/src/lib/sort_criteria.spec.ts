import { describe, expect, it } from "vitest";

import { parseSortCriteria, serializeSortCriteria } from "./sort_criteria.js";

describe("sort criteria", () => {
    it("reads a single bare key the original way: a property by name, otherwise a label", () => {
        expect(parseSortCriteria("")).toStrictEqual([{ key: "title", isLabel: false }]);
        expect(parseSortCriteria(null)).toStrictEqual([{ key: "title", isLabel: false }]);
        expect(parseSortCriteria(" dateCreated ")).toStrictEqual([
            { key: "dateCreated", isLabel: false }
        ]);
        // Only `title`, `dateCreated` and `dateModified` are properties on their own.
        expect(parseSortCriteria("folders")).toStrictEqual([{ key: "folders", isLabel: true }]);
        expect(parseSortCriteria("folders, title")).toStrictEqual([
            { key: "folders", isLabel: false },
            { key: "title", isLabel: false }
        ]);
        expect(parseSortCriteria("myOrder")).toStrictEqual([{ key: "myOrder", isLabel: true }]);
        expect(parseSortCriteria("calendar:view")).toStrictEqual([
            { key: "calendar:view", isLabel: true }
        ]);
        // A direction or grouping word on its own is a label name.
        expect(parseSortCriteria("desc")).toStrictEqual([{ key: "desc", isLabel: true }]);
        expect(parseSortCriteria("last")).toStrictEqual([{ key: "last", isLabel: true }]);
    });

    it("parses levels, with `#` before a label and a bare property", () => {
        expect(parseSortCriteria(" #priority   DESC , , #area asc, title ")).toStrictEqual([
            { key: "priority", isLabel: true, descending: true },
            { key: "area", isLabel: true, descending: false },
            { key: "title", isLabel: false }
        ]);
        expect(parseSortCriteria("#myOrder")).toStrictEqual([{ key: "myOrder", isLabel: true }]);
        // `#` reaches a label that shares a property's name.
        expect(parseSortCriteria("#title desc,#calendar:view")).toStrictEqual([
            { key: "title", isLabel: true, descending: true },
            { key: "calendar:view", isLabel: true }
        ]);
        expect(parseSortCriteria("dateModified desc, title")).toStrictEqual([
            { key: "dateModified", isLabel: false, descending: true },
            { key: "title", isLabel: false }
        ]);
        // Outside a single bare key, a bare word is a property even when no such property exists.
        expect(parseSortCriteria("priority desc, area")).toStrictEqual([
            { key: "priority", isLabel: false, descending: true },
            { key: "area", isLabel: false }
        ]);
    });

    it("parses a grouping level written as a key followed by `first` or `last`", () => {
        expect(parseSortCriteria("#archived last, #pinned FIRST, title")).toStrictEqual([
            { key: "archived", isLabel: true, group: "last" },
            { key: "pinned", isLabel: true, group: "first" },
            { key: "title", isLabel: false }
        ]);
    });

    it("writes levels back so that they parse to the same thing", () => {
        const criteria = [
            { key: "archived", isLabel: true, group: "last" as const },
            { key: "priority", isLabel: true, descending: true },
            { key: "dateCreated", isLabel: false, descending: false },
            { key: "title", isLabel: false }
        ];
        const written = serializeSortCriteria(criteria);
        expect(written).toBe("#archived last, #priority desc, dateCreated asc, title");
        expect(parseSortCriteria(written)).toStrictEqual(criteria);

        // A lone label keeps its `#`, which reads the same as the bare key it replaces.
        const singles = [{ key: "myOrder", isLabel: true }, { key: "title", isLabel: false }];
        for (const single of singles) {
            expect(parseSortCriteria(serializeSortCriteria([single]))).toStrictEqual([single]);
        }
    });
});
