import { describe, expect, it, vi } from "vitest";

const { getRenderedContent } = vi.hoisted(() => ({
    getRenderedContent: vi.fn(async () => ({ $renderedContent: $("<div>preview</div>"), type: "file" }))
}));

vi.mock("../../../services/content_renderer", () => ({
    default: {
        getRenderedContent,
        disposeInteractiveContent: () => {}
    }
}));
vi.mock("../../note_bars/CollectionProperties", () => ({ default: () => null }));
vi.mock("./ListExpandControls", () => ({ default: () => null }));

import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import type { ViewModeProps } from "../interface";
import { GridView, ListView, NoteAttributes } from "./ListOrGridView";

describe("ListOrGridView", () => {
    it("previews only the corner of a workbook, in the list as in the grid", async () => {
        for (const View of [ ListView, GridView ]) {
            getRenderedContent.mockClear();
            const { collection, workbook } = buildCollection();
            renderInto(<View {...viewProps(collection)} />);

            await vi.waitFor(() => expect(getRenderedContent).toHaveBeenCalledOnce());
            expect(getRenderedContent).toHaveBeenCalledWith(workbook, expect.objectContaining({ trim: true }));
        }
    });
});

describe("NoteAttributes", () => {
    it("shows each attribute as a badge, a relation by its target's title", async () => {
        buildNote({ id: "attrTarget", title: "Target note" });
        const note = buildNote({
            title: "Clipping",
            "#pageUrl": "https://example.com",
            "#todo": "",
            "~author": "attrTarget",
            "#clipType": "page"
        });
        const container = renderInto(<NoteAttributes note={note} />);

        await vi.waitFor(() => expect(container.querySelectorAll(".attribute-badge")).toHaveLength(3));
        const badges = [ ...container.querySelectorAll(".attribute-badge") ].map((badge) => ({
            name: badge.querySelector(".attribute-badge-name")?.textContent,
            value: badge.querySelector(".attribute-badge-value")?.textContent
        }));
        expect(badges).toEqual([
            { name: "pageUrl", value: "https://example.com" },
            { name: "todo", value: undefined },
            { name: "author", value: "Target note" }
        ]);
    });
});

function buildCollection() {
    const collection = buildNote({
        title: "Collection",
        type: "book",
        "#expanded": "1",
        children: [
            { id: "workbook", title: "Workbook.xlsx", type: "file", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        ]
    });
    const workbook = froca.getNoteFromCache("workbook");
    if (!workbook) throw new Error("workbook fixture missing");
    return { collection, workbook };
}

function viewProps(note: FNote) {
    return {
        note,
        notePath: note.noteId,
        noteIds: note.getChildNoteIds(),
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: () => {},
        media: "screen",
        onReady: () => {}
    } as ViewModeProps<{}>;
}
