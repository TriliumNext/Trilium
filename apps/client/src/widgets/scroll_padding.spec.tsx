import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The widget is rendered on its own, outside a note split, so the context it would pick up from the
// tree is handed to it instead — a real note context, so the read-only decision is the actual one.
const shownContext = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => shownContext.current
}));

import Component from "../components/component";
import NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import type { ViewScope } from "../services/link";
import options from "../services/options";
import { buildNote } from "../test/easy-froca";
import { renderInto } from "../test/render";
import { ParentComponent } from "./react/react_utils";
import ScrollPadding from "./scroll_padding";

describe("ScrollPadding", () => {
    let parentComponent: Component;
    let noteContext: NoteContext;
    let container: HTMLElement;

    beforeEach(() => {
        options.load({ autoReadonlySizeText: 100, autoReadonlySizeCode: 100 });
        parentComponent = new Component();
        noteContext = new NoteContext();
        container = renderInto(null);
    });

    /**
     * Shows the given note in the tab, inside the scrolling container the widget measures itself
     * against. The context handed over here is not the reactive one the widget subscribes to in the
     * app, so a note switch is staged as a fresh mount.
     */
    async function show(note: FNote, viewScope: ViewScope = { viewMode: "default" }) {
        noteContext.noteId = note.noteId;
        noteContext.notePath = note.noteId;
        noteContext.viewScope = viewScope;
        shownContext.current = {
            note,
            noteContext,
            parentComponent,
            ntxId: noteContext.ntxId,
            viewScope
        };

        await act(async () => {
            render(null, container);
            render(
                <ParentComponent.Provider value={parentComponent}>
                    <div className="scrolling-container"><ScrollPadding /></div>
                </ParentComponent.Provider>,
                container
            );
        });
        await settle();
    }

    /** Lets the asynchronous read-only check resolve, along with the re-render it schedules. */
    async function settle() {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }

    function isShown() {
        return !!container.querySelector(".scroll-padding-widget");
    }

    /** What the read-only badge's edit button does: flips the toggle, then announces it. */
    async function setTemporarilyEditable(editable: boolean) {
        if (noteContext.viewScope) {
            noteContext.viewScope.readOnlyTemporarilyDisabled = editable;
        }
        await act(async () => {
            parentComponent.handleEvent("readOnlyTemporarilyDisabled", { noteContext });
        });
        await settle();
    }

    it("pads an editable note, but not one its label holds read-only", async () => {
        await show(buildNote({ title: "Editable" }));
        expect(isShown()).toBe(true);

        await show(buildNote({ title: "Locked", "#readOnly": "true" }));
        expect(isShown()).toBe(false);
    });

    it("pads a read-only note for as long as it is temporarily editable", async () => {
        await show(buildNote({ title: "Locked", "#readOnly": "true" }));
        expect(isShown()).toBe(false);

        await setTemporarilyEditable(true);
        expect(isShown()).toBe(true);

        await setTemporarilyEditable(false);
        expect(isShown()).toBe(false);
    });

    it("skips a note the size limit turned read-only on its own", async () => {
        await show(buildNote({ title: "Huge", content: "a".repeat(200) }));
        expect(isShown()).toBe(false);

        await setTemporarilyEditable(true);
        expect(isShown()).toBe(true);
    });

    it("skips every note while the database itself is read-only", async () => {
        options.set("databaseReadonly", "true");

        await show(buildNote({ title: "Editable" }));
        expect(isShown()).toBe(false);
    });

    it("only pads text and code notes shown in their default view", async () => {
        await show(buildNote({ title: "Code", type: "code", mime: "text/plain" }));
        expect(isShown()).toBe(true);

        await show(buildNote({ title: "Canvas", type: "canvas" }));
        expect(isShown()).toBe(false);

        await show(buildNote({ title: "Sourced" }), { viewMode: "source" });
        expect(isShown()).toBe(false);
    });

    it("scrolls the note to its end when clicked", async () => {
        const triggerCommand = vi.spyOn(parentComponent, "triggerCommand");
        await show(buildNote({ title: "Editable" }));

        await act(async () => {
            container.querySelector<HTMLElement>(".scroll-padding-widget")?.click();
        });

        expect(triggerCommand).toHaveBeenCalledWith("scrollToEnd", { ntxId: noteContext.ntxId });
    });
});
