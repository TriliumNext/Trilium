import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import contextMenu, { type MenuItem } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import type RelationMapApi from "./api";
import { buildNoteContextMenuHandler, showCanvasContextMenu } from "./context_menu";

describe("relation map note context menu", () => {
    let container: HTMLElement | undefined;
    const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
    const mapApiRef = { current: null as RelationMapApi | null };

    beforeEach(() => {
        show.mockClear();
        // Its items depend on the tab manager, which these tests do not build.
        vi.spyOn(link_context_menu, "getItems").mockReturnValue([]);
        buildNote({ id: "boxnote", title: "Specification" });
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Opens the menu of the box for `boxnote`, and returns the items it shows. */
    function openMenu(isReadOnly: boolean) {
        const handler = buildNoteContextMenuHandler(froca.notes["boxnote"], mapApiRef, isReadOnly);
        handler(new MouseEvent("contextmenu", { cancelable: true }));
        return (show.mock.calls.at(-1)?.[0].items ?? []) as (MenuItem<string> | null)[];
    }

    it("ends with a color picker for the note", async () => {
        const last = openMenu(false).at(-1);
        if (!last || !("kind" in last) || last.kind !== "custom") {
            throw new Error("expected the color picker as the last item");
        }

        container = document.createElement("div");
        document.body.appendChild(container);
        await act(async () => {
            render(h(last.componentFn, {}), container as HTMLElement);
        });

        expect(container.querySelector(".note-color-picker")).toBeTruthy();
    });

    it("offers no color picker on a read-only map", () => {
        const custom = openMenu(true).filter((item) => item && "kind" in item && item.kind === "custom");

        expect(custom).toHaveLength(0);
    });
});

describe("relation map canvas context menu", () => {
    it("pastes notes or adds one where it opened", () => {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const onPaste = vi.fn();
        const onAddNote = vi.fn();
        const event = new MouseEvent("contextmenu", { cancelable: true });

        showCanvasContextMenu(event, { onPaste, onAddNote });
        expect(event.defaultPrevented).toBe(true);

        const items = (show.mock.calls.at(-1)?.[0].items ?? []) as MenuItem<string>[];
        const choose = (index: number) => {
            const item = items[index];
            if (item && "handler" in item) item.handler?.(item, event);
        };
        expect(items.map((item) => ("kind" in item ? item.kind : item.uiIcon))).toEqual([ "bx bx-paste", "separator", "bx bx-note" ]);

        choose(0);
        expect([ onPaste.mock.calls.length, onAddNote.mock.calls.length ]).toEqual([ 1, 0 ]);
        choose(2);
        expect(onAddNote).toHaveBeenCalledTimes(1);
    });
});
