import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component.js";
import NoteContext, { type SaveState } from "../../components/note_context.js";
import type { MenuCommandItem, MenuItem } from "../../menus/context_menu.js";
import type { TreeCommandNames } from "../../menus/tree_context_menu.js";
import attributes from "../../services/attributes.js";
import type { NoteTypeData } from "../../services/note_types.js";
import server from "../../services/server.js";
import { buildNote } from "../../test/easy-froca.js";
import { noteSavedDataStore } from "../react/NoteStore.js";
import { NoteContextContext, ParentComponent } from "../react/react_utils.js";
import NoteTypeSwitcher, { NoteTypeBadges, toSwitcherItems, useNoteTypeData } from "./NoteTypeSwitcher.js";

vi.mock("../../services/i18n.js", () => ({
    t: (key: string) => key
}));

let container: HTMLDivElement | undefined;

afterEach(() => {
    if (container) {
        const mounted = container;
        act(() => render(null, mounted));
        mounted.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

describe("NoteTypeSwitcher", () => {
    it("offers a switch on a text note, and stays away from code notes", () => {
        expect(mount(<NoteTypeSwitcher note={buildNote({ id: "textNote", title: "Note", type: "text" })} />)
            .querySelector(".note-type-switcher")).not.toBeNull();
        expect(mount(<NoteTypeSwitcher note={buildNote({ id: "codeNote", title: "Script", type: "code", mime: "application/javascript;env=backend" })} />)
            .querySelector(".note-type-switcher")).toBeNull();
    });

    it("steps back while the note has changes not yet saved, which a switch would drop", async () => {
        vi.spyOn(server, "get").mockResolvedValue({ templateNoteIds: [], newTemplateNoteIds: [] });
        buildNote({ id: "_templates", title: "Templates" });
        const note = buildNote({ id: "pendingNote", title: "Note", type: "text" });
        noteSavedDataStore.set("pendingNote", "");
        const noteContext = new NoteContext("pending-ntx");
        const host = new Component();
        const intro = () => container?.querySelector(".note-type-switcher .intro");
        const deliver = (state: SaveState) => act(() => {
            host.handleEvent("contextDataChanged", { noteContext, key: "saveState", value: { state } });
        });

        mount(<NoteContextContext.Provider value={noteContext}><NoteTypeSwitcher note={note} /></NoteContextContext.Provider>, host);
        await flush();
        expect(intro()).not.toBeNull();

        for (const state of [ "unsaved", "saving", "error" ] as const) {
            deliver(state);
            expect(intro(), state).toBeNull();
        }

        // Saved and still empty, the note can be switched again.
        deliver("saved");
        expect(intro()).not.toBeNull();
    });

    it("offers Markdown and Canvas as pills, and the code languages, collections, templates and the rest from dropdowns", async () => {
        buildNote({
            id: "_templates",
            title: "Templates",
            children: [
                { id: "_board", title: "Board", "#template": "", "#collection": "" },
                { id: "_meeting", title: "Meeting", "#template": "" }
            ]
        });
        vi.spyOn(server, "get").mockResolvedValue({ templateNoteIds: [], newTemplateNoteIds: [] });

        const host = mount(<NoteTypeBadges noteId="someNote" />);
        await flush();

        const icons = [ ...host.querySelectorAll(".ext-badge > .bx:first-child, .ext-badge .bx:not(.arrow)") ]
            .map((icon) => [ ...icon.classList ].find((name) => name !== "bx"));
        expect(icons).toEqual([ "bxl-markdown", "bx-pen", "bx-code", "bx-book", "bx-copy-alt", "bx-dots-vertical-rounded" ]);
    });
});

describe("toSwitcherItems", () => {
    it("switches the note to the row's note type, template or preset, keeping rows of their own and leaving out what the note is or cannot become", async () => {
        const put = vi.spyOn(server, "put").mockResolvedValue({});
        const setRelation = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const configure = vi.fn();
        const row = (item: Partial<MenuCommandItem<TreeCommandNames>>): MenuItem<TreeCommandNames> =>
            ({ title: item.type ?? "row", command: "insertNoteAfter", ...item });

        const items = toSwitcherItems([
            row({ type: "text" }),
            row({ type: "code", mime: "text/plain", items: [ row({ type: "code", mime: "text/x-python" }), { kind: "separator" }, row({ title: "Configure", handler: configure }) ] }),
            { kind: "separator" },
            row({ title: "More", items: [ row({ type: "search" }), row({ type: "webView", mime: "" }) ] }),
            row({ title: "Meeting", type: "text", templateNoteId: "_meeting" }),
            row({ title: "Custom CSS", type: "code", mime: "text/css", notePreset: "appCss" })
        ], "someNote");

        const commandItems = (list: MenuItem<unknown>[]) => list.filter((item): item is MenuCommandItem<unknown> => !("kind" in item));
        const run = (item: MenuCommandItem<unknown> | undefined) => item?.handler?.(item, new MouseEvent("click"));
        const [ code, more, template, preset ] = commandItems(items);

        // Text is what the note already is, and a text note does not become a saved search.
        expect(commandItems(items).map((item) => item.title)).toEqual([ "code", "More", "Meeting", "Custom CSS" ]);
        expect(commandItems(more.items ?? []).map((item) => item.title)).toEqual([ "webView" ]);
        expect(commandItems(items).every((item) => item.command === undefined)).toBe(true);

        const [ python, configureRow ] = commandItems(code.items ?? []);
        run(python);
        expect(put).toHaveBeenCalledWith("notes/someNote/type", { type: "code", mime: "text/x-python" });
        run(configureRow);
        expect(configure).toHaveBeenCalled();
        run(template);
        expect(setRelation).toHaveBeenCalledWith("someNote", "template", "_meeting");
        expect(put).toHaveBeenCalledTimes(1);

        // A preset gives the note its type, then its label.
        run(preset);
        await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(3));
        expect(put).toHaveBeenNthCalledWith(2, "notes/someNote/type", { type: "code", mime: "text/css" });
        expect(put).toHaveBeenNthCalledWith(3, "notes/someNote/set-attribute", expect.objectContaining({ name: "appCss" }), undefined);
    });
});

describe("useNoteTypeData", () => {
    it("loads the templates again on frocaReloaded, for fresh FNote refs after a protected session starts", async () => {
        buildNote({ id: "_templates", title: "Templates" });
        buildNote({ id: "userTemplate1", title: "[protected]" });
        const serverGet = vi.spyOn(server, "get").mockResolvedValue({ templateNoteIds: [ "userTemplate1" ], newTemplateNoteIds: [] });

        const host = new Component();
        let data: NoteTypeData | undefined;
        function Harness() {
            data = useNoteTypeData();
            return null;
        }
        mount(<Harness />, host);
        await flush();
        expect(data?.userTemplateNotes.map((note) => note.title)).toEqual([ "[protected]" ]);

        // Entering the protected session rebuilds froca: same noteId, a new FNote with the decrypted title.
        buildNote({ id: "userTemplate1", title: "Meeting Notes" });
        serverGet.mockClear();
        await act(async () => { await host.handleEvent("frocaReloaded", {}); });
        await flush();
        expect(serverGet).toHaveBeenCalledWith("search-templates");
        expect(data?.userTemplateNotes.map((note) => note.title)).toEqual([ "Meeting Notes" ]);
    });
});

function mount(content: ComponentChildren, host = new Component()) {
    if (container) {
        const mounted = container;
        act(() => render(null, mounted));
        mounted.remove();
    }
    const element = document.createElement("div");
    container = element;
    document.body.appendChild(element);
    act(() => render(<ParentComponent.Provider value={host}>{content}</ParentComponent.Provider>, element));
    return element;
}

// Loading resolves the templates root, then its children and the user's templates; each async step
// needs its own act() round so that the state commits.
async function flush() {
    for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
    }
}
