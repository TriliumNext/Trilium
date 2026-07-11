import { describe, expect, it } from "vitest";

import { buildSectionSelections, type OneNoteNotebook, orderedChildren } from "./onenote_import.js";

const NOTEBOOKS: OneNoteNotebook[] = [
    {
        id: "nb1",
        title: "Notebook 1",
        createdDateTime: "2020-01-01T00:00:00Z",
        lastModifiedDateTime: "2020-02-01T00:00:00Z",
        sections: [{ id: "s1", title: "Direct section", createdDateTime: "2020-01-01T00:00:00Z" }],
        sectionGroups: [
            {
                id: "g1",
                title: "Group A",
                createdDateTime: "2020-03-01T00:00:00Z",
                lastModifiedDateTime: "2020-04-01T00:00:00Z",
                sections: [{ id: "s2", title: "In group A", createdDateTime: "2020-03-15T00:00:00Z" }],
                sectionGroups: [
                    {
                        id: "g2",
                        title: "Subgroup B",
                        createdDateTime: "2020-05-01T00:00:00Z",
                        sections: [{ id: "s3", title: "In subgroup B", createdDateTime: "2020-06-01T00:00:00Z" }],
                        sectionGroups: []
                    }
                ]
            }
        ]
    }
];

// A container whose sections and groups are deliberately out of creation order in their source arrays,
// so a correct interleave has to re-sort across both: by date the rail reads early, group, late.
const INTERLEAVE: OneNoteNotebook[] = [
    {
        id: "nb",
        title: "NB",
        sections: [
            { id: "late", title: "Late", createdDateTime: "2020-05-01T00:00:00Z" },
            { id: "early", title: "Early", createdDateTime: "2020-01-01T00:00:00Z" }
        ],
        sectionGroups: [
            {
                id: "grp",
                title: "Group",
                createdDateTime: "2020-03-01T00:00:00Z",
                sections: [{ id: "in", title: "In group", createdDateTime: "2020-02-01T00:00:00Z" }],
                sectionGroups: []
            }
        ]
    }
];

const describeChild = (notebooks: OneNoteNotebook[]) => orderedChildren(notebooks[0]).map((c) => (c.type === "section" ? `section:${c.section.id}` : `group:${c.group.id}`));

describe("orderedChildren", () => {
    it("interleaves sections and groups in creation-date order, by each item's own date", () => {
        // sections[] is [late, early] and the group is dated between them; the group's own date (not its
        // contents') decides its slot, so the rail order is early, group, late.
        expect(describeChild(INTERLEAVE)).toEqual(["section:early", "group:grp", "section:late"]);
    });
});

describe("buildSectionSelections", () => {
    it("returns a top-level section with an empty group path and its notebook metadata", () => {
        const [selection, ...rest] = buildSectionSelections(NOTEBOOKS, new Set(["s1"]));
        expect(rest).toHaveLength(0);
        expect(selection).toMatchObject({
            id: "s1",
            title: "Direct section",
            groupPath: [],
            notebookId: "nb1",
            notebookTitle: "Notebook 1",
            notebookCreatedDateTime: "2020-01-01T00:00:00Z",
            notebookLastModifiedDateTime: "2020-02-01T00:00:00Z"
        });
    });

    it("carries the section-group ancestry (outermost first) for nested sections", () => {
        const inGroup = buildSectionSelections(NOTEBOOKS, new Set(["s2"]));
        expect(inGroup[0].groupPath).toEqual([
            { id: "g1", title: "Group A", createdDateTime: "2020-03-01T00:00:00Z", lastModifiedDateTime: "2020-04-01T00:00:00Z" }
        ]);

        const inSubgroup = buildSectionSelections(NOTEBOOKS, new Set(["s3"]));
        expect(inSubgroup[0].groupPath.map((g) => g.id)).toEqual(["g1", "g2"]);
    });

    it("emits selected sections in interleaved rail order and ignores unselected ones", () => {
        // 'in' lives in a group dated between 'early' and 'late', so it must appear between them.
        const selections = buildSectionSelections(INTERLEAVE, new Set(["early", "in", "late"]));
        expect(selections.map((s) => s.id)).toEqual(["early", "in", "late"]);

        expect(buildSectionSelections(NOTEBOOKS, new Set())).toEqual([]);
        expect(buildSectionSelections(NOTEBOOKS, new Set(["does-not-exist"]))).toEqual([]);
    });
});
