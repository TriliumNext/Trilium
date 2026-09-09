import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import server from "../../services/server";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import SortChildNotesDialog, { serializeSortLevels } from "./sort_child_notes";

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

describe("serializeSortLevels", () => {
    it("writes each level as key:direction, skipping a label level with no name", () => {
        expect(serializeSortLevels([
            { kind: "label", labelName: " priority ", descending: true },
            { kind: "label", labelName: "", descending: false },
            { kind: "dateCreated", labelName: "", descending: false },
            { kind: "title", labelName: "ignored", descending: true }
        ])).toBe("priority:desc,dateCreated:asc,title:desc");
    });
});

describe("SortChildNotesDialog", () => {
    let host: Component;
    let container: HTMLElement;
    let put: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        host = new Component();
        put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <SortChildNotesDialog />
            </ParentComponent.Provider>
        );
        await act(async () => {
            void host.handleEventInChildren("sortChildNotes", { noteId: "parent", selectedOrActiveBranchIds: [] });
        });
    });

    function levels() {
        return [ ...container.querySelectorAll(".sort-level") ];
    }

    async function click(element: Element | null | undefined) {
        if (!element) throw new Error("Nothing to click.");
        await act(async () => {
            element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    async function choose(select: HTMLSelectElement | null, value: string) {
        if (!select) throw new Error("No select to change.");
        await act(async () => {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    async function type(input: HTMLInputElement | null, value: string) {
        if (!input) throw new Error("No input to type into.");
        await act(async () => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function buttonTitled(scope: Element, title: string) {
        return [ ...scope.querySelectorAll("button") ].find((button) => button.textContent?.trim() === title);
    }

    async function submit() {
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("starts with one level and sends the classic single-criterion sort", async () => {
        expect(levels()).toHaveLength(1);
        await submit();
        expect(put).toHaveBeenCalledWith("notes/parent/sort-children", expect.objectContaining({
            sortBy: "title:asc",
            foldersFirst: false,
            sortNatural: false
        }));
    });

    it("builds a multi-level criteria string from the added levels", async () => {
        await click(container.querySelector(".sort-level-add"));
        await click(container.querySelector(".sort-level-add"));
        expect(levels()).toHaveLength(3);

        const [ first, second, third ] = levels();
        await choose(first.querySelector("select"), "label");
        await type(first.querySelector<HTMLInputElement>(".sort-level-label"), "priority");
        await click(buttonTitled(first, "sort_child_notes.descending"));
        await choose(second.querySelector("select"), "dateModified");

        // Removing the last level leaves the first two as they were set.
        await click(third.querySelector(".sort-level-remove"));
        expect(levels()).toHaveLength(2);

        await submit();
        expect(put).toHaveBeenCalledWith("notes/parent/sort-children", expect.objectContaining({
            sortBy: "priority:desc,dateModified:asc"
        }));
    });

    it("keeps the only level from being removed", () => {
        const remove = levels()[0].querySelector<HTMLButtonElement>(".sort-level-remove[disabled]");
        expect(remove).not.toBeNull();
    });
});
