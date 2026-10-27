import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import NoteContext from "../components/note_context";
import protectedSessionHolder from "../services/protected_session_holder";
import { buildNote } from "../test/easy-froca";
import { renderInto } from "../test/render";
import NoteTitleWidget from "./note_title";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

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
});
