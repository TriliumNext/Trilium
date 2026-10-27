import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import NoteContext from "../../components/note_context";
import Dropdown from "../react/Dropdown";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { buildNote } from "../../test/easy-froca";
import { CommandItem, NoteContextMenu } from "./NoteActions";

const ctrl = vi.hoisted(() => ({ mobile: false }));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => ctrl.mobile
}));

// A dialog's focus trap would pull focus out of a menu portaled over it.
vi.mock("../react/modal_focustrap", () => ({ suspendModalFocusTraps: () => () => {} }));

// The rows are read by their keys.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

// The tiles look up their shortcuts for their tooltips; a spec loads no keyboard actions.
vi.mock("../../services/keyboard_actions", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/keyboard_actions")>();
    return { ...original, default: { ...original.default, getAction: async () => ({ effectiveShortcuts: [] }) } };
});

describe("CommandItem", () => {
    const host = document.createElement("div");
    document.body.append(host);

    afterEach(() => {
        render(null, host);
    });

    it("runs its command on the component the menu stands in, on a click and on Enter", async () => {
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        render((
            <ParentComponent.Provider value={parent}>
                <Dropdown text="Actions">
                    <CommandItem command="showRevisions" icon="bx bx-history" text="Revisions" />
                </Dropdown>
            </ParentComponent.Provider>
        ), host);
        const toggle = host.querySelector<HTMLButtonElement>("button");
        if (!toggle) throw new Error("expected the toggle to render");
        const popup = () => document.querySelector<HTMLElement>(".tn-popup");
        const row = () => popup()?.querySelector<HTMLElement>("li.dropdown-item");

        toggle.click();
        await vi.waitFor(() => expect(row()).toBeTruthy());
        row()?.click();
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("showRevisions", { ntxId: undefined });
        await vi.waitFor(() => expect(popup()).toBeNull());

        toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        await vi.waitFor(() => expect(row()?.classList.contains("tn-menu-active")).toBe(true));
        popup()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(triggerCommand).toHaveBeenCalledTimes(2);
        expect(triggerCommand).toHaveBeenLastCalledWith("showRevisions", { ntxId: undefined });
    });

    it("passes the ntxId of the surrounding note context", async () => {
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        render((
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={{ ntxId: "_popup-editor" } as NoteContext}>
                    <Dropdown text="Actions">
                        <CommandItem command="printActiveNote" icon="bx bx-printer" text="Print" />
                    </Dropdown>
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), host);
        host.querySelector<HTMLButtonElement>("button")?.click();
        const row = () => document.querySelector<HTMLElement>(".tn-popup li.dropdown-item");
        await vi.waitFor(() => expect(row()).toBeTruthy());

        row()?.click();
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("printActiveNote", { ntxId: "_popup-editor" });
    });
});

describe("NoteContextMenu", () => {
    const host = document.createElement("div");
    document.body.append(host);

    afterEach(() => {
        render(null, host);
    });

    it("leaves out of the quick edit popup the actions that act outside it", async () => {
        const text = buildNote({ title: "Text", type: "text", content: "<p>Hi</p>" });
        // Only an image with a single parent can be converted into an attachment.
        const parent = buildNote({ title: "Parent", children: [ { title: "Diagram", type: "image", content: "img" } ] });
        const image = froca.getNoteFromCache(parent.children[0]);
        expect(image?.type).toBe("image");

        const shownIn = async (ntxId: string, note: FNote) => {
            const noteContext = new NoteContext(ntxId);
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            render((
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            await vi.waitFor(() => expect(document.querySelector(".tn-popup li.dropdown-item")).toBeTruthy());
            // A row, or a tile in the strip at the top.
            const items = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item, .tn-popup .tn-menu-action") ];
            const hasIcon = (icon: string) => items.some((li) => li.querySelector(`.${icon}`));
            const state = {
                search: hasIcon("bx-file-find"),
                noteMap: hasIcon("bxs-network-chart"),
                fullWidth: hasIcon("bx-expand-horizontal"),
                // The attachments item carries the same icon, above the convert item.
                paperclips: items.filter((li) => li.querySelector(".bx-paperclip")).length
            };
            render(null, host);
            return state;
        };

        expect(await shownIn("ntx-tab", text)).toEqual({ search: true, noteMap: true, fullWidth: true, paperclips: 1 });
        expect(await shownIn("_popup-editor", text)).toEqual({ search: true, noteMap: false, fullWidth: false, paperclips: 1 });
        if (image) {
            expect((await shownIn("ntx-tab", image)).paperclips).toBe(2);
            expect((await shownIn("_popup-editor", image)).paperclips).toBe(1);
        }
    });

    it("offers the properties dialog of the collections that have one", async () => {
        const hasPropertiesItem = async (viewType: string, labels: Record<string, string> = {}) => {
            const note = buildNote({
                title: viewType, type: "book", "#viewType": viewType, ...labels
            });
            const noteContext = new NoteContext("ntx-collection");
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            render((
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            await vi.waitFor(() => expect(document.querySelector(".tn-popup li.dropdown-item")).toBeTruthy());
            const item = document.querySelector(".tn-popup li.dropdown-item:has(.bx-cog)");
            render(null, host);
            return !!item;
        };

        expect(await hasPropertiesItem("table")).toBe(true);
        expect(await hasPropertiesItem("geoMap")).toBe(true);
        expect(await hasPropertiesItem("list")).toBe(false);

        // The board opens its dialog on a read-only note; the other views do not.
        for (const viewType of [ "table", "geoMap", "calendar" ]) {
            expect(await hasPropertiesItem(viewType, { "#readOnly": "" })).toBe(false);
        }
        expect(await hasPropertiesItem("calendar")).toBe(true);
        expect(await hasPropertiesItem("board", { "#readOnly": "" })).toBe(true);
    });

    it("offers to print the note types and views that have a print renderer", async () => {
        const isPrintEnabled = async (note: FNote) => {
            const noteContext = new NoteContext("ntx-render");
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            render((
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            const printItem = await vi.waitFor(() => {
                const item = document.querySelector<HTMLElement>(".tn-popup li.dropdown-item:has(.bx-printer)");
                expect(item).toBeTruthy();
                return item;
            });
            const enabled = !printItem?.classList.contains("disabled");
            render(null, host);
            return enabled;
        };

        const script = buildNote({ title: "Script", type: "code" });
        expect(await isPrintEnabled(buildNote({ title: "Render", type: "render", "~renderNote": script.noteId }))).toBe(true);
        expect(await isPrintEnabled(buildNote({ title: "Unset", type: "render" }))).toBe(false);
        expect(await isPrintEnabled(buildNote({ title: "Disabled", type: "render", "~disabled:renderNote": script.noteId }))).toBe(false);

        expect(await isPrintEnabled(buildNote({ title: "Search", type: "search" }))).toBe(true);
        expect(await isPrintEnabled(buildNote({ title: "Search list", type: "search", "#viewType": "list" }))).toBe(true);
        expect(await isPrintEnabled(buildNote({ title: "Search grid", type: "search", "#viewType": "grid" }))).toBe(false);
    });

    it("draws the actions that look into the note as a strip of tiles, or a row where one is left", async () => {
        const note = buildNote({ title: "Text", type: "text", content: "<p>Hi</p>" });
        const parentComponent = new Component();
        const triggerCommand = vi.spyOn(parentComponent, "triggerCommand").mockImplementation(() => Promise.resolve());
        const popup = () => document.querySelector<HTMLElement>(".tn-popup");
        const openIn = async (ntxId: string) => {
            const noteContext = new NoteContext(ntxId);
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            render((
                <ParentComponent.Provider value={parentComponent}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            await vi.waitFor(() => expect(popup()?.querySelector("li.dropdown-item")).toBeTruthy());
        };

        await openIn("ntx-tiles");
        const tiles = [ ...popup()?.querySelectorAll<HTMLElement>(".tn-menu-scroll > li.tn-menu-actions:first-child .tn-menu-action") ?? [] ];
        expect(tiles.map((tile) => tile.textContent?.trim())).toEqual([ "note_actions.search_in_note_short", "note_actions.note_attachments_short", "note_actions.note_map" ]);
        expect(popup()?.querySelector("li.dropdown-item:has(.bx-file-find)")).toBeNull();

        await act(async () => tiles[0]?.click());
        expect(triggerCommand).toHaveBeenCalledWith("findInText", expect.objectContaining({ ntxId: "ntx-tiles" }));
        await vi.waitFor(() => expect(popup()).toBeNull());
        render(null, host);

        // The quick edit popup searches its own note, and opens no note map.
        await openIn("_popup-editor");
        const popupTiles = [ ...popup()?.querySelectorAll<HTMLElement>(".tn-menu-actions .tn-menu-action") ?? [] ];
        expect(popupTiles.map((tile) => tile.textContent?.trim())).toEqual([ "note_actions.search_in_note_short", "note_actions.note_attachments_short" ]);
        await act(async () => popupTiles[0]?.click());
        expect(triggerCommand).toHaveBeenCalledWith("findInText", expect.objectContaining({ ntxId: "_popup-editor" }));
        await vi.waitFor(() => expect(popup()).toBeNull());
        render(null, host);

        // On a phone the popup leaves only Find, which a strip of one would not suit.
        ctrl.mobile = true;
        try {
            await openIn("_popup-editor");
            expect(popup()?.querySelector(".tn-menu-actions")).toBeNull();
            expect(popup()?.querySelector("li.dropdown-item:has(.bx-file-find)")?.textContent?.trim()).toBe("note_actions.search_in_note");
        } finally {
            ctrl.mobile = false;
        }
    });

    it("folds the revisions into one row that opens them, with the saving actions beside it", async () => {
        const note = buildNote({ title: "Text", type: "text", content: "<p>Hi</p>" });
        const noteContext = new NoteContext("ntx-revisions");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };
        const parentComponent = new Component();
        const triggerCommand = vi.spyOn(parentComponent, "triggerCommand").mockImplementation(() => Promise.resolve());
        const popup = () => document.querySelector<HTMLElement>(".tn-popup");
        const open = async () => {
            host.querySelector<HTMLButtonElement>("button")?.click();
            await vi.waitFor(() => expect(popup()?.querySelector("li.dropdown-item")).toBeTruthy());
            return popup()?.querySelector<HTMLElement>(".tn-menu-scroll > li.dropdown-item:has(.bx-history)");
        };
        render((
            <ParentComponent.Provider value={parentComponent}>
                <NoteContextContext.Provider value={noteContext}>
                    <NoteContextMenu note={note} noteContext={noteContext} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), host);

        const row = await open();
        expect(row?.classList.contains("tn-menu-split")).toBe(true);
        expect(popup()?.querySelectorAll(".tn-menu-scroll > li.dropdown-item:is(:has(.bx-save), :has(.bx-purchase-tag))")).toHaveLength(0);

        await act(async () => row?.querySelector<HTMLElement>(".dropdown-toggle")?.click());
        expect(triggerCommand).toHaveBeenCalledWith("showRevisions", expect.objectContaining({ ntxId: "ntx-revisions" }));
        await vi.waitFor(() => expect(popup()).toBeNull());

        const reopened = await open();
        await act(async () => {
            reopened?.dispatchEvent(new PointerEvent("pointerenter"));
        });
        const submenu = await vi.waitFor(() => {
            const layer = popup()?.querySelector(":scope > div.dropdown-submenu > .dropdown-menu");
            expect(layer).toBeTruthy();
            return layer;
        });
        expect(submenu?.querySelector("li.dropdown-item:has(.bx-save)")).toBeTruthy();
        expect(submenu?.querySelector("li.dropdown-item:has(.bx-purchase-tag)")).toBeTruthy();
    });

    it("offers to export a help page, but not an options page", async () => {
        const isExportEnabled = async (note: FNote) => {
            const noteContext = new NoteContext("ntx-export");
            noteContext.noteId = note.noteId;
            noteContext.viewScope = { viewMode: "default" };
            render((
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            const exportItem = await vi.waitFor(() => {
                const item = document.querySelector<HTMLElement>(".tn-popup li.dropdown-item:has(.bx-export)");
                expect(item).toBeTruthy();
                return item;
            });
            const enabled = !exportItem?.classList.contains("disabled");
            render(null, host);
            return enabled;
        };

        expect(await isExportEnabled(buildNote({ id: "_helpExportPage", title: "Help page" }))).toBe(true);
        expect(await isExportEnabled(buildNote({ id: "_optionsExportPage", title: "Options page" }))).toBe(false);
    });

    it("puts the strip of tiles first on a phone, around the tiles it is given, and folds the note settings into one row", async () => {
        ctrl.mobile = true;
        const note = buildNote({ title: "Text", type: "text", content: "<p>Hi</p>" });
        const noteContext = new NoteContext("ntx-phone");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };
        const createChild = vi.fn();
        try {
            render((
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteContextMenu note={note} noteContext={noteContext}
                            leadingViewActions={[ { title: "split", uiIcon: "bx bx-dock-right", handler: () => {} } ]}
                            trailingViewActions={[ { title: "child", uiIcon: "bx bx-plus", handler: createChild } ]}
                            itemsAtStart={<CommandItem icon="bx bx-link" text="start" command={() => {}} />}
                            itemsNearNoteSettings={<CommandItem icon="bx bx-info-circle" text="near" command={() => {}} />} />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            ), host);
            host.querySelector<HTMLButtonElement>("button")?.click();
            const popup = () => document.querySelector<HTMLElement>(".tn-popup");
            await vi.waitFor(() => expect(popup()?.querySelector("li.dropdown-item")).toBeTruthy());

            const first = popup()?.querySelector(".tn-menu-scroll > :first-child");
            const tiles = [ ...first?.querySelectorAll<HTMLElement>(".tn-menu-action") ?? [] ];
            expect(tiles.map((tile) => tile.textContent?.trim())).toEqual([ "split", "note_actions.note_map", "note_actions.search_in_note_short", "child" ]);
            expect(first?.classList.contains("note-actions-strip")).toBe(true);
            const start = popup()?.querySelector("li.dropdown-item:has(.bx-link)");
            expect(start).toBeTruthy();
            expect(first?.compareDocumentPosition(start as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

            // The settings a note is given once are one row, which opens them.
            const topRows = [ ...popup()?.querySelectorAll(".tn-menu-scroll > li.dropdown-item") ?? [] ].map((row) => row.textContent ?? "");
            expect(topRows.some((text) => text.includes("note_actions.note_settings"))).toBe(true);
            expect(topRows.some((text) => [ "basic_properties.note_type", "template_switch.template", "shared_switch.shared", "bookmark_switch.bookmark" ]
                .some((key) => text.includes(key)))).toBe(false);
            expect(topRows.some((text) => text.includes("protect_note.toggle-on"))).toBe(true);
            // The rows given to sit near the settings join their group, with a divider only after them.
            const near = popup()?.querySelector("li.dropdown-item:has(.bx-info-circle)");
            expect(near?.previousElementSibling?.textContent).toContain("note_actions.note_settings");
            expect(near?.nextElementSibling?.classList.contains("dropdown-divider")).toBe(true);

            // Its page lists the editability choices under a heading, not behind a further row.
            await act(async () => [ ...popup()?.querySelectorAll<HTMLElement>(".tn-menu-scroll > li.dropdown-item") ?? [] ]
                .find((row) => row.textContent?.includes("note_actions.note_settings"))?.click());
            await vi.waitFor(() => expect(document.body.textContent).toContain("editability_select.auto"));
            expect([ ...document.querySelectorAll(".tn-popup .dropdown-header") ].map((header) => header.textContent)).toContain("basic_properties.editable");

            await act(async () => tiles[3]?.click());
            expect(createChild).toHaveBeenCalledOnce();
        } finally {
            ctrl.mobile = false;
        }
    });

    it("opens on the Basic Properties shortcut only for its own note context", async () => {
        const note = buildNote({ title: "Text", type: "text", content: "<p>Hi</p>" });
        const noteContext = new NoteContext("ntx-split-2");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };
        const parent = new Component();
        render((
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <NoteContextMenu note={note} noteContext={noteContext} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), host);
        const popup = () => document.querySelector(".tn-popup");

        await act(async () => { await parent.handleEvent("toggleRibbonTabBasicProperties", { ntxId: "ntx-split-1" }); });
        expect(popup()).toBeNull();

        await act(async () => { await parent.handleEvent("toggleRibbonTabBasicProperties", { ntxId: "ntx-split-2" }); });
        await vi.waitFor(() => expect(popup()).not.toBeNull());
    });
});
