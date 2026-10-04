import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import type { Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ContentEmbedDialog from "./content_embed";

const autocomplete = vi.hoisted(() => ({
    onChange: undefined as ((suggestion: Suggestion | null) => void) | undefined
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ onChange }: { onChange: (suggestion: Suggestion | null) => void }) => {
        autocomplete.onChange = onChange;
        return <input />;
    }
}));

describe("ContentEmbedDialog", () => {
    let host: Component;
    let container: HTMLElement;
    const editorApi = { addContentEmbed: vi.fn(), addImage: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <ContentEmbedDialog />
            </ParentComponent.Provider>
        );
        await open();
    });

    async function open() {
        await act(async () => {
            void host.handleEventInChildren("showContentEmbedDialog", { editorApi });
        });
    }

    async function pick(note: FNote) {
        await act(async () => {
            autocomplete.onChange?.({ notePath: `root/${note.noteId}` });
        });
    }

    function checkedSize() {
        return container.querySelector<HTMLInputElement>("input[type='radio']:checked")?.value;
    }

    async function choose(size: string) {
        const radio = container.querySelector<HTMLInputElement>(
            `input[type='radio'][value='${size}']`
        );
        if (!radio) throw new Error(`No radio for ${size}.`);
        await act(async () => {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    async function submit() {
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("preselects the size that suits the picked note, until another size is chosen", async () => {
        const script = buildNote({ title: "Script", type: "code", mime: "text/javascript" });
        const song = buildNote({ title: "Song", type: "file", mime: "audio/mpeg" });
        expect(checkedSize()).toBe("medium");

        await pick(script);
        expect(checkedSize()).toBe("full");
        await choose("tiny");
        expect(checkedSize()).toBe("tiny");

        // Another note, or opening the dialog again, drops the size chosen by hand.
        await pick(song);
        expect(checkedSize()).toBe("small");
        await choose("expandable");
        await open();
        expect(checkedSize()).toBe("small");

        await choose("expandable");
        await submit();
        expect(editorApi.addContentEmbed).toHaveBeenCalledWith(song.noteId, "expandable");
    });
});
