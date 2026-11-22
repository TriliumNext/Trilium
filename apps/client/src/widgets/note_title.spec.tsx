import type { NoteType } from "@triliumnext/commons";
import clsx from "clsx";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import NoteContext from "../components/note_context";
import froca from "../services/froca";
import protectedSessionHolder from "../services/protected_session_holder";
import server from "../services/server";
import { buildNote } from "../test/easy-froca";
import { renderInto } from "../test/render";
import NoteTitleWidget from "./note_title";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

vi.stubGlobal("logError", vi.fn());

vi.mock("../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n")>()),
    t: (key: string) => key
}));

describe("NoteTitleWidget", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderProtectedTitle(isUnlocked: boolean) {
        vi.spyOn(protectedSessionHolder, "isProtectedSessionAvailable").mockReturnValue(isUnlocked);
        const note = buildNote({ title: "R&D" });
        note.isProtected = true;
        return renderTitle(note);
    }

    async function renderTitle(note: ReturnType<typeof buildNote>) {
        const noteContext = new NoteContext("ntx-title");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };

        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={new Component()}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteTitleWidget />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            );
        });

        const input = container?.querySelector("input.note-title");
        if (!(input instanceof HTMLInputElement)) {
            throw new Error("title input missing");
        }
        return input;
    }

    it("reads Protected in its own style while the protected session is locked", async () => {
        const input = await renderProtectedTitle(false);
        expect(input.value).toBe("protected_session.locked_note_title");
        expect(input.classList.contains("protected-title")).toBe(true);
        expect(input.readOnly).toBe(true);
    });

    it("reads the note's own title inside the protected session", async () => {
        const input = await renderProtectedTitle(true);
        expect(input.value).toBe("R&D");
        expect(input.classList.contains("protected-title")).toBe(false);
        expect(input.readOnly).toBe(false);
    });

    it("keeps a user's home, named after its user, from being renamed", async () => {
        const input = await renderTitle(buildNote({ id: "home_alice", title: "alice" }));
        expect(input.readOnly).toBe(true);
    });

    it("drops a title change to a note deleted before it saves", async () => {
        const put = vi.spyOn(server, "put").mockRejectedValue(new Error("Note not found"));
        const note = buildNote({ title: "Doomed" });
        const noteContext = new NoteContext("ntx-title");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };
        const parent = new Component();

        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteTitleWidget />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            );
        });
        const input = container?.querySelector<HTMLInputElement>("input.note-title");
        expect(input?.readOnly).toBe(false);

        act(() => {
            if (!input) return;
            input.value = "Renamed";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        delete froca.notes[note.noteId];
        await act(async () => {
            await parent.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(put).not.toHaveBeenCalled();
    });

    it("selects the title the split shows for a note created from a note of another type", async () => {
        vi.spyOn(HTMLElement.prototype, "checkVisibility").mockImplementation(function (this: HTMLElement) {
            return !this.closest(".hidden, .hide-title");
        });

        const fromCanvas = await createNoteInSplit("canvas", "text");
        expect(fromCanvas.focused?.closest(".title-row")).toBeNull();
        expect(fromCanvas.focused).toBe(fromCanvas.inlineInput);
        expect(fromCanvas.inlineInput?.value).toBe("New note");
        expect(fromCanvas.inlineInput?.selectionStart).toBe(0);
        expect(fromCanvas.inlineInput?.selectionEnd).toBe("New note".length);

        const fromText = await createNoteInSplit("text", "canvas");
        expect(fromText.focused).toBe(fromText.titleRowInput);
        expect(fromText.titleRowInput?.value).toBe("New note");
        expect(fromText.titleRowInput?.selectionStart).toBe(0);
        expect(fromText.titleRowInput?.selectionEnd).toBe("New note".length);
    });
});

/**
 * Renders a split on a note of type `fromType`, then switches it to a new note of type `toType` the
 * way `note_create` does: `focusAndSelectTitle` arrives before the split has rendered the new note.
 */
async function createNoteInSplit(fromType: NoteType, toType: NoteType) {
    const previous = buildNote({ title: "Previous", type: fromType });
    const created = buildNote({ title: "New note", type: toType });
    const noteContext = new NoteContext("ntx-title");
    noteContext.noteId = previous.noteId;
    noteContext.notePath = `root/${previous.noteId}`;
    noteContext.viewScope = { viewMode: "default" };
    const parent = new Component();
    let showInlineTitle: (shown: boolean) => void = () => {};

    // Stands in for the note split: `InlineTitle` shows its copy of the title for a text note and
    // hides the title row's with `hide-title`, a render after the note switch.
    function Pane() {
        const [ inlineShown, setInlineShown ] = useState(fromType === "text");
        showInlineTitle = setInlineShown;
        return (
            <>
                <div className={clsx("title-row", inlineShown && "hide-title")}>
                    <NoteTitleWidget placement="split" />
                </div>
                <div className={clsx("inline-title", !inlineShown && "hidden")}>
                    <NoteTitleWidget placement="inline" />
                </div>
            </>
        );
    }

    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <Pane />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
    });

    act(() => {
        noteContext.noteId = created.noteId;
        noteContext.notePath = `root/${created.noteId}`;
        void parent.handleEvent("noteSwitched", { noteContext, notePath: noteContext.notePath });
        void parent.handleEvent("focusAndSelectTitle", { isNewNote: true, ntxId: noteContext.ntxId });
    });
    act(() => showInlineTitle(toType === "text"));
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    return {
        focused: document.activeElement,
        titleRowInput: container?.querySelector<HTMLInputElement>(".title-row input.note-title"),
        inlineInput: container?.querySelector<HTMLInputElement>(".inline-title input.note-title")
    };
}
