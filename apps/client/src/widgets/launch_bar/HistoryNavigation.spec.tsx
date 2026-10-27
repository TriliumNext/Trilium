import type { ElectronApi } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { getHistoryItems, type HistoryDirection, useHistoryContextMenu } from "./HistoryNavigation";

const mocks = vi.hoisted(() => ({ showLauncherContextMenu: vi.fn() }));

vi.mock("../../menus/launcher_button_context_menu", () => ({
    showLauncherContextMenu: mocks.showLauncherContextMenu
}));

const urlOf = (noteId: string) => `http://localhost:8080/#root/${noteId}`;

beforeEach(() => {
    buildNote({
        id: "root",
        title: "root",
        children: Array.from({ length: 30 }, (_, i) => ({ id: `note${i}`, title: `Note ${i}` }))
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronApi;
    delete (window as { navigation?: unknown }).navigation;
});

describe("getHistoryItems", () => {
    it("lists the notes on either side of the current one in Electron, nearest first", async () => {
        buildNote({ id: "html", title: "<b>Bold</b>" });
        buildNote({
            id: "work",
            title: "Work",
            children: [ { id: "rdep", title: "R&D", children: [ { id: "plan", title: "Plan" } ] } ]
        });
        const navigationGoToIndex = vi.fn();
        const urls = [ "note1", "", "html", "note3", "work/rdep/plan", "note5" ].map(urlOf);
        stubElectronHistory(urls, 3, navigationGoToIndex);

        const back = await getHistoryItems("back");
        expect(back.map((item) => item.title))
            .toEqual([ "&lt;b&gt;Bold&lt;&#x2F;b&gt;", "Note 1" ]);
        expect(back[1].uiIcon).toBe(froca.getNoteFromCache("note1")?.getIcon());

        // The title is HTML; the path is text.
        const forward = await getHistoryItems("forward");
        expect(forward.map(({ title, trailingText }) => [ title, trailingText ]))
            .toEqual([ [ "Plan", "Work › R&D" ], [ "Note 5", undefined ] ]);

        select(back[1]);
        expect(navigationGoToIndex).toHaveBeenLastCalledWith(0);
        select(forward[0]);
        expect(navigationGoToIndex).toHaveBeenLastCalledWith(4);
    });

    it("lists at most 20 notes per direction from the Navigation API in a browser", async () => {
        expect(await getHistoryItems("back")).toEqual([]);

        const traverseTo = vi.fn(() => ({
            committed: Promise.resolve(),
            finished: Promise.reject(new DOMException("Interrupted", "AbortError"))
        }));
        Object.defineProperty(window, "navigation", {
            configurable: true,
            value: {
                currentEntry: { index: 25 },
                entries: () => Array.from({ length: 30 }, (_, i) => ({
                    url: urlOf(`note${i}`),
                    key: `k${i}`
                })),
                traverseTo
            }
        });

        const back = await getHistoryItems("back");
        expect(back).toHaveLength(20);
        expect(back[0].title).toBe("Note 24");
        expect(back[19].title).toBe("Note 5");

        const forward = await getHistoryItems("forward");
        expect(forward.map((item) => item.title))
            .toEqual([ "Note 26", "Note 27", "Note 28", "Note 29" ]);

        select(forward[2]);
        expect(traverseTo).toHaveBeenCalledWith("k28");
    });
});

describe("useHistoryContextMenu", () => {
    let container: HTMLElement;

    beforeEach(() => {
        stubElectronHistory([ urlOf("note0"), urlOf("note1"), urlOf("note2") ], 1, vi.fn());
        container = document.createElement("div");
        document.body.append(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    it("shows the notes of its own direction on a right-click", async () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
        const button = renderButton("forward");

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        button.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
        expect(show.mock.calls[0][0].items.map((item) => "title" in item && item.title))
            .toEqual([ "Note 2" ]);
    });

    it("adds the notes to the menu of a launcher", async () => {
        const launcherNote = buildNote({ id: "_lbBackInHistory", title: "Back" });
        const button = renderButton("back", launcherNote);

        button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => expect(mocks.showLauncherContextMenu).toHaveBeenCalledOnce());
        const [ note, , options ] = mocks.showLauncherContextMenu.mock.calls[0];
        expect(note).toBe(launcherNote);
        expect(options.extraItems.map((item: { title: string }) => item.title))
            .toEqual([ "Note 0" ]);
    });

    function renderButton(direction: HistoryDirection, launcherNote?: FNote) {
        function Probe() {
            return <button type="button" {...useHistoryContextMenu(direction, launcherNote)} />;
        }

        act(() => render(<Probe />, container));
        const button = container.querySelector("button");
        if (!button) throw new Error("The probe did not render its button.");
        return button;
    }
});

function stubElectronHistory(
    urls: string[],
    activeIndex: number,
    navigationGoToIndex: (index: number) => void
) {
    window.electronApi = {
        navigation: {
            navigationGetAllEntries: () => urls.map((url) => ({ url, title: "" })),
            navigationGetActiveIndex: () => activeIndex,
            navigationGoToIndex
        }
    } as unknown as ElectronApi;
}

function select(item: { handler?: (...args: never[]) => void }) {
    if (!item.handler) throw new Error("The menu item has no handler.");
    item.handler();
}
