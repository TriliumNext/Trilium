import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import NoteContext from "../../components/note_context";
import Dropdown from "../react/Dropdown";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { buildNote } from "../../test/easy-froca";
import { CommandItem, NoteContextMenu } from "./NoteActions";

// A dialog's focus trap would pull focus out of a menu portaled over it.
vi.mock("../react/modal_focustrap", () => ({ suspendModalFocusTraps: () => () => {} }));

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
            const items = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
            const hasIcon = (icon: string) => items.some((li) => li.querySelector(`.${icon}`));
            const state = {
                search: hasIcon("bx-search"),
                noteMap: hasIcon("bxs-network-chart"),
                fullWidth: hasIcon("bx-expand-horizontal"),
                // The attachments item carries the same icon, above the convert item.
                paperclips: items.filter((li) => li.querySelector(".bx-paperclip")).length
            };
            render(null, host);
            return state;
        };

        expect(await shownIn("ntx-tab", text)).toEqual({ search: true, noteMap: true, fullWidth: true, paperclips: 1 });
        expect(await shownIn("_popup-editor", text)).toEqual({ search: false, noteMap: false, fullWidth: false, paperclips: 1 });
        if (image) {
            expect((await shownIn("ntx-tab", image)).paperclips).toBe(2);
            expect((await shownIn("_popup-editor", image)).paperclips).toBe(1);
        }
    });
});
