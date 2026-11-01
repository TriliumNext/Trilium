import { describe, expect, it, vi } from "vitest";

vi.mock("./server.js", () => ({
    default: {
        // Resolves to an array: onenote_import's module graph eagerly loads services (e.g.
        // keyboard_actions) that fetch on load and iterate the response.
        get: vi.fn(async () => []),
        getWithSilentUnauthorized: vi.fn(async () => ({ notebooks: [] })),
        post: vi.fn(async () => ({}))
    }
}));

import onenoteImport, { buildSectionSelections, collectSectionIds, extractServerMessage, type OneNoteNotebook, orderedChildren } from "./onenote_import.js";
import server from "./server.js";

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

    it("sorts a child with no creation date first (empty key), keeping the rest ordered", () => {
        const undated: OneNoteNotebook[] = [{
            id: "nb",
            title: "NB",
            sections: [
                { id: "dated", title: "Dated", createdDateTime: "2020-01-01T00:00:00Z" },
                { id: "undated", title: "Undated" }
            ],
            sectionGroups: []
        }];
        expect(describeChild(undated)).toEqual(["section:undated", "section:dated"]);
    });
});

describe("service endpoints", () => {
    it("routes each operation to its endpoint, listing notebooks without the generic 401 toast", async () => {
        await onenoteImport.deviceLogin();
        expect(server.post).toHaveBeenCalledWith("onenote-import/device-login");

        await onenoteImport.devicePoll();
        expect(server.post).toHaveBeenCalledWith("onenote-import/device-poll");

        await onenoteImport.getStatus();
        expect(server.get).toHaveBeenCalledWith("onenote-import/status");

        await onenoteImport.disconnect();
        expect(server.post).toHaveBeenCalledWith("onenote-import/disconnect");

        // A 401 (expired connection) is shown inline by the dialog, so the silent variant is used —
        // the plain get() would double-report through the generic error toast.
        await onenoteImport.getNotebooks();
        expect(server.getWithSilentUnauthorized).toHaveBeenCalledWith("onenote-import/notebooks");

        const payload = { parentNoteId: "p1", sections: [], taskId: "t1" };
        await onenoteImport.runImport(payload);
        expect(server.post).toHaveBeenCalledWith("onenote-import/import", payload);
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

describe("extractServerMessage", () => {
    it("unwraps both response shapes the API rejects with, and reports nothing usable as null", () => {
        // A thrown server error arrives as the JSON envelope; a [status, message] route result as text.
        expect(extractServerMessage('{"message":"The OneNote connection was lost."}')).toBe("The OneNote connection was lost.");
        expect(extractServerMessage("Not connected to OneNote.")).toBe("Not connected to OneNote.");
        expect(extractServerMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");

        // Nothing worth showing: the caller falls back to its own wording rather than printing "{}" or "".
        expect(extractServerMessage('{"message":"  "}')).toBeNull();
        expect(extractServerMessage('{"status":500}')).toBeNull();
        expect(extractServerMessage("   ")).toBeNull();
        expect(extractServerMessage(undefined)).toBeNull();
    });
});

describe("collectSectionIds", () => {
    it("collects every section id across all notebooks, including those nested in section groups", () => {
        // s1 is a direct section, s2 lives in a group, s3 in a nested subgroup — all must be found;
        // group ids themselves must not be (groups are structure, never selectable).
        expect(collectSectionIds(NOTEBOOKS)).toEqual(new Set(["s1", "s2", "s3"]));
        expect(collectSectionIds([])).toEqual(new Set());
    });
});
