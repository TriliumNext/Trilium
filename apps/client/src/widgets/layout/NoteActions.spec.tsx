import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import Dropdown from "../react/Dropdown";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { CommandItem } from "./NoteActions";

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
