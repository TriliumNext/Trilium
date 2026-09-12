import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The option as the store holds it, every value written to it, and who is watching it. */
const state = vi.hoisted(() => ({
    stored: "[]",
    writes: [] as string[],
    watchers: new Set<(newValue: string) => void>()
}));

// Only `useTriliumOption` is replaced — the rest of the module stays real, so the segments and boxes
// this renders keep the hooks they use.
//
// The stand-in holds the value in state and re-reads it when the store changes, as the real hook does
// through `entitiesReloaded`: the cases below turn on the option moving underneath a mounted page,
// which a stand-in only returning the current value could not reproduce.
vi.mock("../../react/hooks", async (importOriginal) => {
    const { useEffect: onMount, useState: useLocal } = await import("preact/hooks");
    return {
        ...(await importOriginal<typeof import("../../react/hooks")>()),
        useTriliumOption: () => {
            const [ value, setValue ] = useLocal(state.stored);
            onMount(() => {
                state.watchers.add(setValue);
                return () => void state.watchers.delete(setValue);
            }, []);
            return [
                value,
                (newValue: string) => {
                    state.writes.push(newValue);
                    writeStore(newValue);
                    return Promise.resolve();
                }
            ];
        }
    };
});

/** Puts a value in the store and tells everyone reading it, the way an entity reload would. */
function writeStore(newValue: string) {
    state.stored = newValue;
    for (const watcher of state.watchers) watcher(newValue);
}

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

import { parseCustomReplacements } from "../text/replacements";
import { CustomReplacements } from "./text_notes";

function renderEditor() {
    const container = document.createElement("div");
    document.body.append(container);
    act(() => render(<CustomReplacements />, container));
    return container;
}

/** The replacements as the segments show them, each read as the `from → to` it stands for. */
const pairs = (container: HTMLElement) =>
    [ ...container.querySelectorAll(".custom-replacement-pair") ].map((pair) => pair.textContent);

/** The two boxes the next pair is typed into. */
const draftBoxes = (container: HTMLElement) => [ ...container.querySelectorAll("input") ];

/** Types into a box, as a keystroke rather than an assignment. */
function type(input: HTMLInputElement, value: string) {
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Enter, which is what takes the pair. */
function pressEnter(input: HTMLInputElement) {
    act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
}

/** Types a whole pair and takes it. */
function addPair(container: HTMLElement, from: string, to: string) {
    const [ fromBox, toBox ] = draftBoxes(container);
    type(fromBox, from);
    type(toBox, to);
    pressEnter(toBox);
}

const stored = () => parseCustomReplacements(state.writes.at(-1));

afterEach(() => {
    state.stored = "[]";
    state.writes = [];
    state.watchers.clear();
    document.body.innerHTML = "";
});

describe("CustomReplacements", () => {
    it("shows what is held as segments, and offers empty boxes for the next", () => {
        state.stored = `[{"from":"TN","to":"Trilium Notes"},{"from":"teh","to":"the"}]`;
        const container = renderEditor();

        expect(pairs(container)).toEqual([ "TN → Trilium Notes", "teh → the" ]);
        expect(draftBoxes(container).map((box) => box.value)).toEqual([ "", "" ]);
    });

    it("takes a pair on Enter and clears the boxes for the next one", () => {
        const container = renderEditor();

        addPair(container, "TN", "Trilium Notes");

        expect(stored()).toEqual([ { from: "TN", to: "Trilium Notes" } ]);
        expect(pairs(container)).toEqual([ "TN → Trilium Notes" ]);
        expect(draftBoxes(container).map((box) => box.value)).toEqual([ "", "" ]);
    });

    it("will not take half a pair", () => {
        const container = renderEditor();
        const [ fromBox ] = draftBoxes(container);

        type(fromBox, "TN");
        pressEnter(fromBox);

        // Storing it would put an entry in the set that could never fire.
        expect(state.writes).toEqual([]);
        expect(pairs(container)).toEqual([]);
    });

    it("replaces an entry typed a second time rather than holding both", () => {
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();

        addPair(container, "TN", "Trilium");

        expect(stored()).toEqual([ { from: "TN", to: "Trilium" } ]);
    });

    it("counts a shortcut as the same one whatever case it is typed in", () => {
        // Matching ignores case, so two entries differing only by it would leave the second unable
        // ever to fire.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();

        addPair(container, "tn", "Trilium");

        expect(stored()).toEqual([ { from: "tn", to: "Trilium" } ]);
    });

    it("removes the pair that was pressed, keeping its neighbours", () => {
        state.stored = `[{"from":"TN","to":"Trilium Notes"},{"from":"teh","to":"the"}]`;
        const container = renderEditor();

        const [ , removeSecond ] = [ ...container.querySelectorAll<HTMLButtonElement>(".custom-replacement-remove") ];
        act(() => removeSecond.click());

        expect(stored()).toEqual([ { from: "TN", to: "Trilium Notes" } ]);
        expect(pairs(container)).toEqual([ "TN → Trilium Notes" ]);
    });

    it("shows a list that arrived from elsewhere without being asked twice", () => {
        // What is held is read back from the option on every render rather than copied into state at
        // mount, so there is no second list to fall behind — nor to be written back over this one.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();

        act(() => writeStore(`[{"from":"CT","to":"CherryTree"}]`));

        expect(pairs(container)).toEqual([ "CT → CherryTree" ]);
    });

    it("leaves a pair being typed alone when a list arrives", () => {
        // Only the pair being typed is held locally, and an arriving list is not written into it.
        const container = renderEditor();
        const [ fromBox, toBox ] = draftBoxes(container);
        type(fromBox, "TN");
        type(toBox, "Trilium No");

        act(() => writeStore(`[{"from":"CT","to":"CherryTree"}]`));

        expect(pairs(container)).toEqual([ "CT → CherryTree" ]);
        expect(draftBoxes(container).map((box) => box.value)).toEqual([ "TN", "Trilium No" ]);

        // ...and taking it keeps what arrived rather than replacing it.
        pressEnter(toBox);
        expect(stored()).toEqual([
            { from: "CT", to: "CherryTree" },
            { from: "TN", to: "Trilium No" }
        ]);
    });
});
