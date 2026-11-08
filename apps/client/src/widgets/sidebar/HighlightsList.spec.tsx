import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import HighlightsList from "./HighlightsList";

describe("HighlightsList in an editable text note", () => {
    it("updates the items in place when the highlights are extracted again", async () => {
        const list = await setup([ "alpha", "beta", "gamma" ]);
        const before = list.items();
        expect(before.map((item) => item.textContent)).toEqual([ "alpha", "beta", "gamma" ]);

        await list.editor.change([ "alpha", "beta", "gamma", "delta" ]);

        const after = list.items();
        expect(after.map((item) => item.textContent))
            .toEqual([ "alpha", "beta", "gamma", "delta" ]);
        for (const [ index, item ] of before.entries()) {
            expect(after[index]).toBe(item);
        }
    });
});

async function setup(boldRuns: string[]) {
    options.load({
        rightPaneCollapsedItems: "[]",
        highlightsList: "[\"bold\"]"
    } as Parameters<typeof options.load>[0]);

    const note = buildNote({ title: "Highlights", type: "text" });
    const noteContext = new NoteContext("highlights-ntx");
    noteContext.noteId = note.noteId;
    noteContext.notePath = note.noteId;
    noteContext.viewScope = { viewMode: "default", isReadOnly: false };
    Object.defineProperty(noteContext, "note", { get: () => note });
    appContext.tabManager = { getActiveContext: () => noteContext } as typeof appContext.tabManager;

    const editor = fakeTextEditor(boldRuns);
    vi.spyOn(noteContext, "getTextEditor").mockImplementation(async (callback) => {
        callback?.(editor.editor);
        return editor.editor;
    });

    const parent = new Component();
    appContext.child(parent);
    let container!: HTMLElement;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <HighlightsList />
            </ParentComponent.Provider>
        );
    });
    await settle();

    return {
        editor,
        items: () => [ ...container.querySelectorAll<HTMLElement>(".highlights-list li") ]
    };
}

async function settle() {
    for (let i = 0; i < 5; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

/** A CKEditor instance whose model holds one bold text run per entry of `boldRuns`. */
function fakeTextEditor(boldRuns: string[]) {
    const listeners = new Set<() => void>();
    let runs = boldRuns;

    const editor = {
        model: {
            document: {
                getRoot: () => ({}),
                differ: { getChanges: () => [ { type: "insert" } ] },
                on: (_event: string, callback: () => void) => listeners.add(callback),
                off: (_event: string, callback: () => void) => listeners.delete(callback)
            },
            createRangeIn: () => ({
                getWalker: () => runs.map((text) => ({ item: boldTextProxy(text) }))
            })
        }
    } as unknown as CKTextEditor;

    return {
        editor,
        /** Replaces the runs and reports the change to the listeners. */
        async change(newRuns: string[]) {
            runs = newRuns;
            await act(async () => {
                for (const listener of [ ...listeners ]) listener();
            });
            await settle();
        }
    };
}

function boldTextProxy(text: string) {
    return {
        data: text,
        textNode: {},
        startOffset: 0,
        is: (type: string) => type === "$textProxy",
        hasAttribute: (key: string) => key === "bold",
        getAttribute: () => undefined
    };
}
