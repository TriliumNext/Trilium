import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noteContent = vi.hoisted(() => ({ rendered: [] as string[] }));
const autocomplete = vi.hoisted(() => ({
    onTextChange: undefined as ((text: string) => void) | undefined
}));

vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ onTextChange }: { onTextChange: (text: string) => void }) => {
        autocomplete.onTextChange = onTextChange;
        return <input />;
    }
}));

vi.mock("../collections/legacy/ListOrGridView", () => ({
    NoteContent: ({ note }: { note: { noteId: string } }) => {
        noteContent.rendered.push(note.noteId);
        return <div className="stub-content">{`content of ${note.noteId}`}</div>;
    },
    NoteAttributes: () => <span className="stub-attributes" />
}));

import Component from "../../components/component";
import type { Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import JumpToNoteDialog, { JumpToNotePreview, PREVIEW_DELAY_MS } from "./jump_to_note";

describe("JumpToNotePreview", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        noteContent.rendered = [];
        buildNote({ id: "parent", title: "Projects", children: [ { id: "plan", title: "Quarterly plan" } ] });
        buildNote({ id: "other", title: "Other" });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function show(suggestion: Suggestion | undefined, container?: HTMLElement) {
        const host = container ?? document.createElement("div");
        await act(async () => {
            const { render } = await import("preact");
            render(<JumpToNotePreview suggestion={suggestion} />, host);
        });
        return host;
    }

    async function wait(ms: number) {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }

    it("shows the highlighted note once the highlight settles, with its path, title and content", async () => {
        const host = renderInto(<div />);
        await show({ notePath: "root/parent/plan", noteTitle: "Quarterly plan", highlightedParentPathTitle: "Projects" }, host);
        expect(host.querySelector(".jump-to-note-preview-title")).toBeNull();

        await wait(PREVIEW_DELAY_MS);
        expect(host.querySelector(".jump-to-note-preview-path")?.textContent).toBe("Projects");
        expect(host.querySelector(".jump-to-note-preview-title")?.textContent).toBe("Quarterly plan");
        expect(host.querySelector(".stub-content")?.textContent).toBe("content of plan");
    });

    it("shows the path the row carries, prefixes and ancestors froca does not hold included", async () => {
        const host = renderInto(<div />);
        await show({
            notePath: "root/uncached/parent/plan",
            highlightedParentPathTitle: "Unloaded › Work: <b>Pro</b>jects &amp; more"
        }, host);
        await wait(PREVIEW_DELAY_MS);
        expect(host.querySelector(".jump-to-note-preview-path")?.textContent).toBe("Unloaded › Work: Projects & more");
    });

    it("keeps the path of the note it shows until the next one has loaded", async () => {
        const host = renderInto(<div />);
        await show({ notePath: "root/parent/plan", highlightedParentPathTitle: "Projects" }, host);
        await wait(PREVIEW_DELAY_MS);

        await show({ notePath: "root/other", highlightedParentPathTitle: "Elsewhere" }, host);
        expect(host.querySelector(".jump-to-note-preview-title")?.textContent).toBe("Quarterly plan");
        expect(host.querySelector(".jump-to-note-preview-path")?.textContent).toBe("Projects");

        await wait(PREVIEW_DELAY_MS);
        expect(host.querySelector(".jump-to-note-preview-title")?.textContent).toBe("Other");
        expect(host.querySelector(".jump-to-note-preview-path")?.textContent).toBe("Elsewhere");
    });

    it("renders only the note the keys stop on, and nothing for a row that is no note", async () => {
        const host = renderInto(<div />);
        await show({ notePath: "root/other" }, host);
        await wait(PREVIEW_DELAY_MS / 2);
        await show({ notePath: "root/parent/plan" }, host);
        await wait(PREVIEW_DELAY_MS);
        expect(noteContent.rendered).toEqual([ "plan" ]);

        for (const row of [ { action: "create-note", noteTitle: "New" }, { action: "command", commandId: "x" }, undefined ]) {
            await show(row as Suggestion | undefined, host);
            await wait(PREVIEW_DELAY_MS);
            expect(host.querySelector(".jump-to-note-preview-title")).toBeNull();
            expect(host.querySelector(".jump-to-note-preview")).not.toBeNull();
        }
    });
});

describe("JumpToNoteDialog's preview", () => {
    it("is left out for the command palette, and back once the query names notes again, the dialog keeping its width", async () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({
            matches: true, addEventListener() {}, removeEventListener() {}
        } as unknown as MediaQueryList);
        const host = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={host}><JumpToNoteDialog /></ParentComponent.Provider>
        );
        await act(async () => { void host.handleEventInChildren("commandPalette", {}); });
        await act(async () => { autocomplete.onTextChange?.(">"); });

        const dialog = () => container.querySelector(".jump-to-note-dialog");
        expect(container.querySelector(".jump-to-note-preview")).toBeNull();
        expect(dialog()?.classList.contains("with-preview")).toBe(false);
        expect(dialog()?.classList.contains("wide")).toBe(true);

        await act(async () => { autocomplete.onTextChange?.("plan"); });
        expect(container.querySelector(".jump-to-note-preview")).not.toBeNull();
        expect(dialog()?.classList.contains("with-preview")).toBe(true);
        expect(dialog()?.classList.contains("wide")).toBe(true);
        vi.restoreAllMocks();
    });
});
