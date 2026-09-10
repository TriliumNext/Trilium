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
    it("writes each level as its key plus desc where descending, skipping a nameless label", () => {
        expect(serializeSortLevels([
            { kind: "label", labelName: " priority ", direction: "desc" },
            { kind: "label", labelName: "", direction: "asc" },
            { kind: "dateCreated", labelName: "", direction: "asc" },
            { kind: "title", labelName: "ignored", direction: "desc" }
        ])).toBe("priority desc, dateCreated, title desc");
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
            void host.handleEventInChildren("sortChildNotes", {
                noteId: "parent", selectedOrActiveBranchIds: []
            });
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
        return scope.querySelector(`button[title="${title}"]`);
    }

    async function submit() {
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("starts with one unremovable level and sends the single-criterion sort", async () => {
        expect(levels()).toHaveLength(1);
        expect(levels()[0].querySelector(".sort-level-remove")).toHaveProperty("disabled", true);
        await submit();
        expect(put).toHaveBeenCalledWith("notes/parent/sort-children", expect.objectContaining({
            sortBy: "title",
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
            sortBy: "priority desc, dateModified"
        }));
    });

    it("reorders levels with the arrows, which are off at the ends", async () => {
        await click(container.querySelector(".sort-level-add"));
        const [ first, second ] = levels();
        await choose(second.querySelector("select"), "dateCreated");
        expect(first.querySelector(".sort-level-up")).toHaveProperty("disabled", true);
        expect(second.querySelector(".sort-level-down")).toHaveProperty("disabled", true);

        await click(second.querySelector(".sort-level-up"));
        await submit();
        expect(put).toHaveBeenCalledWith("notes/parent/sort-children", expect.objectContaining({
            sortBy: "dateCreated, title"
        }));
    });

    it("refuses a label name the attribute rules would not allow", async () => {
        await choose(levels()[0].querySelector("select"), "label");
        const input = levels()[0].querySelector<HTMLInputElement>(".sort-level-label");
        await type(input, "priority desc");
        expect(input?.checkValidity()).toBe(false);
        // A browser compiles `pattern` with the v flag, which happy-dom lacks; check the rule itself.
        const pattern = new RegExp(`^(?:${input?.getAttribute("pattern")})$`, "v");
        expect(pattern.test("priority")).toBe(true);
        expect(pattern.test("calendar:view")).toBe(true);
        expect(pattern.test("priority desc")).toBe(false);
    });
});
