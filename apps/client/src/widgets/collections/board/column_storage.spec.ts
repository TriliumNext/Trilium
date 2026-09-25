import { describe, expect, it } from "vitest";

import type { BoardViewData } from ".";
import { adoptLegacyColumns, readColumns, writeColumns } from "./column_storage";

const CONFIG: BoardViewData = {
    columns: [ { value: "To Do" }, { value: "Done", icon: "bx bx-check" } ],
    priorityViewColumns: [ { value: "High", color: "#f00" } ],
    templates: [ "type:text:text/html" ]
};

describe("readColumns", () => {
    it("reads the default grouping however it is written", () => {
        for (const groupBy of [ "status", "#status", " status " ]) {
            expect(readColumns(CONFIG, groupBy), groupBy).toBe(CONFIG.columns);
        }
    });

    it("reads every other grouping from its own key", () => {
        expect(readColumns(CONFIG, "priority")).toEqual([ { value: "High", color: "#f00" } ]);
        expect(readColumns(CONFIG, "#priority")).toEqual([ { value: "High", color: "#f00" } ]);
    });

    it("has nothing for a grouping the board has not been on, and none for no config", () => {
        expect(readColumns(CONFIG, "severity")).toBeUndefined();
        expect(readColumns(CONFIG, "~assignee")).toBeUndefined();
        expect(readColumns(undefined, "status")).toBeUndefined();
    });
});

describe("writeColumns", () => {
    it("stores one grouping without touching another's columns or the rest of the config", () => {
        const written = writeColumns(CONFIG, "priority", [ { value: "Low" } ]);

        expect(written.priorityViewColumns).toEqual([ { value: "Low" } ]);
        expect(written.columns).toBe(CONFIG.columns);
        expect(written.templates).toBe(CONFIG.templates);
        // The config the board holds is replaced rather than edited, so a render can tell
        // them apart.
        expect(CONFIG.priorityViewColumns).toEqual([ { value: "High", color: "#f00" } ]);
    });

    it("stores the default grouping under the key every board already uses", () => {
        const written = writeColumns(CONFIG, "status", [ { value: "Blocked" } ]);

        expect(written.columns).toEqual([ { value: "Blocked" } ]);
        expect(written.priorityViewColumns).toBe(CONFIG.priorityViewColumns);
    });

    it("keeps a relation apart from the label of the same name", () => {
        const written = writeColumns({}, "~priority", [ { value: "someNoteId" } ]);

        expect(written["~priorityViewColumns"]).toEqual([ { value: "someNoteId" } ]);
        expect(written.priorityViewColumns).toBeUndefined();
    });
});

describe("adoptLegacyColumns", () => {
    /** What a board grouping by something other than the default stored before this key existed. */
    const legacy: BoardViewData = {
        columns: [ { value: "High", icon: "bx bx-up-arrow" } ],
        filterQuery: "#urgent"
    };

    it("moves a pre-switching list under the grouping it belongs to and clears the old key", () => {
        const adopted = adoptLegacyColumns(legacy, "priority");

        expect(adopted).toEqual({
            priorityViewColumns: [ { value: "High", icon: "bx bx-up-arrow" } ],
            filterQuery: "#urgent"
        });
        // Left in place it would be read as the default grouping's columns the moment the board is
        // switched to it.
        expect(adopted).not.toHaveProperty("columns");
    });

    it("leaves the default grouping alone, which already owns that key", () => {
        expect(adoptLegacyColumns(legacy, "status")).toBeUndefined();
        expect(adoptLegacyColumns(legacy, "#status")).toBeUndefined();
    });

    it("leaves a board that has switched before alone, whose `columns` is the default's", () => {
        expect(adoptLegacyColumns(CONFIG, "severity")).toBeUndefined();
    });

    it("has nothing to move for a board with no stored columns", () => {
        expect(adoptLegacyColumns({ columns: [] }, "priority")).toBeUndefined();
        expect(adoptLegacyColumns({}, "priority")).toBeUndefined();
        expect(adoptLegacyColumns(undefined, "priority")).toBeUndefined();
    });

    it("carries a relation's list under a key of its own", () => {
        expect(adoptLegacyColumns(legacy, "~assignee")).toMatchObject({
            "~assigneeViewColumns": [ { value: "High", icon: "bx bx-up-arrow" } ]
        });
    });
});
