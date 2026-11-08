/**
 * A board loads its editing code apart from itself, so a read-only one, such as a shared board,
 * never fetches it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { loadBoardEditing } from ".";

const imports = vi.hoisted(() => ({ editing: 0 }));
vi.mock("./editing", async (importOriginal) => {
    imports.editing++;
    return await importOriginal();
});

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve(),
    getCurrentLanguage: () => "en"
}));

describe("a board's editing code", () => {
    const mounted: HTMLElement[] = [];

    afterEach(() => {
        for (const mountPoint of mounted.splice(0)) {
            act(() => render(null, mountPoint));
            mountPoint.remove();
        }
    });

    it("loads only once a board that can be edited is drawn", async () => {
        const readOnly = await renderBoard({ "#readOnly": "" });
        expect(readOnly.querySelector(".board-note")).not.toBeNull();
        expect(readOnly.querySelector(".board-add-column")).toBeNull();
        expect(imports.editing).toBe(0);

        const editable = await renderBoard();
        expect(imports.editing).toBe(1);
        // The import the board started, which the first time can take longer than any fixed wait.
        await act(async () => { await loadBoardEditing(); });
        await settle();
        expect(editable.querySelector(".board-note")).not.toBeNull();
        expect(editable.querySelector(".board-add-column")).not.toBeNull();
    });

    async function renderBoard(labels: Record<string, string> = {}) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            ...labels,
            children: [ { title: "First", "#status": "To Do" } ]
        });
        const mountPoint = document.createElement("div");
        mounted.push(mountPoint);
        document.body.appendChild(mountPoint);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={note.getChildNoteIds()}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: "To Do" } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();
        return mountPoint;
    }
});

async function settle() {
    for (let pass = 0; pass < 5; pass++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}
