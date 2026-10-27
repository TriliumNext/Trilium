import type { RefObject } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import type { Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import type { NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { ParentComponent } from "../react/react_utils";
import ContentEmbedDialog from "./content_embed";

const autocomplete = vi.hoisted(() => ({
    onChange: undefined as ((suggestion: Suggestion | null) => void) | undefined,
    clear: vi.fn()
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ onChange, handleRef }: {
        onChange: (suggestion: Suggestion | null) => void;
        handleRef: RefObject<Partial<NoteAutocompleteHandle>>;
    }) => {
        autocomplete.onChange = onChange;
        handleRef.current = { clear: autocomplete.clear };
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

    async function open(sizeEditable?: boolean) {
        await act(async () => {
            void host.handleEventInChildren("showContentEmbedDialog", { editorApi, sizeEditable });
        });
    }

    async function pick(note: FNote) {
        await act(async () => {
            autocomplete.onChange?.({ notePath: `root/${note.noteId}` });
        });
    }

    function sizeButtons() {
        return [ ...container.querySelectorAll<HTMLButtonElement>(
            ".include-note-size .tn-segmented-choice button"
        ) ];
    }

    function checkedSize() {
        const active = sizeButtons().filter((button) => button.getAttribute("aria-pressed") === "true");
        if (active.length !== 1) throw new Error(`${active.length} box sizes are pressed.`);
        return /^include_note\.size_(\w+)$/.exec(active[0]?.textContent?.trim() ?? "")?.[1];
    }

    async function choose(size: string) {
        const button = sizeButtons()
            .find((b) => b.textContent?.trim() === `include_note.size_${size}`);
        if (!button) throw new Error(`No button for ${size}.`);
        await act(async () => button.click());
    }

    async function submit() {
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
    }

    it("lays out the note and the box size as rows of one card", async () => {
        expect(container.querySelectorAll(".tn-card")).toHaveLength(1);
        expect(container.querySelector(".tn-card-heading")).toBeNull();
        const labels = [ ...container.querySelectorAll(".tn-card-option-title") ]
            .map((label) => label.textContent);
        expect(labels).toStrictEqual([ "include_note.label_note", "include_note.box_size" ]);
        expect(container.querySelector(".include-note-note input")).not.toBeNull();
        expect(sizeButtons().map((button) => button.textContent?.trim())).toStrictEqual([
            "include_note.size_tiny", "include_note.size_small", "include_note.size_medium",
            "include_note.size_full", "include_note.size_expandable"
        ]);
        expect(sizeButtons().every((button) => button.querySelector("svg"))).toBe(true);
        // The name is written on the button, so a tooltip would only repeat it.
        expect(sizeButtons().some((button) => button.hasAttribute("title"))).toBe(false);

        // Every description is laid out, so the row keeps the height of the longest; only the
        // chosen one is shown.
        expect(container.querySelector(".include-note-size .tn-card-option-label small")).toBeNull();
        const descriptions = [ ...container.querySelectorAll(".include-note-size-description > *") ];
        expect(descriptions).toHaveLength(5);
        const description = () => {
            const shown = descriptions.filter((d) => d.getAttribute("aria-hidden") !== "true");
            return shown.length === 1 ? shown[0]?.textContent : `${shown.length} shown`;
        };
        expect(checkedSize()).toBe("medium");
        expect(description()).toBe("include_note.size_medium_description");
        await choose("tiny");
        expect(checkedSize()).toBe("tiny");
        expect(description()).toBe("include_note.size_tiny_description");
    });

    it("preselects the size that suits the picked note, until another size is chosen", async () => {
        const script = buildNote({ title: "Script", type: "code", mime: "text/javascript" });
        const song = buildNote({ title: "Song", type: "file", mime: "audio/mpeg" });
        expect(checkedSize()).toBe("medium");

        await pick(script);
        expect(checkedSize()).toBe("full");
        await choose("tiny");
        expect(checkedSize()).toBe("tiny");

        // Another note drops the size chosen by hand.
        await pick(song);
        expect(checkedSize()).toBe("small");
        await choose("expandable");
        await submit();
        expect(editorApi.addContentEmbed).toHaveBeenCalledWith(song.noteId, "expandable");
    });

    it("explains instead of offering sizes for a note inserted as an image", async () => {
        const picture = buildNote({ title: "Picture", type: "image", mime: "image/png" });
        const script = buildNote({ title: "Script", type: "code", mime: "text/javascript" });
        const notice = () => container.querySelector(".include-note-size .include-note-as-image");

        await pick(picture);
        expect(sizeButtons()).toHaveLength(0);
        expect(container.querySelector(".include-note-size-description")).toBeNull();
        expect(notice()?.textContent).toBe("include_note.inserted_as_image");
        await submit();
        expect(editorApi.addImage).toHaveBeenCalledExactlyOnceWith(picture.noteId);
        expect(editorApi.addContentEmbed).not.toHaveBeenCalled();

        await open();
        await pick(script);
        expect(notice()).toBeNull();
        expect(checkedSize()).toBe("full");
    });

    it("says the size can be changed later only where the editor allows it", async () => {
        const picture = buildNote({ title: "Picture", type: "image", mime: "image/png" });
        const hint = () => container.querySelector(".include-note-size-hint")?.textContent;
        expect(hint()).toBeUndefined();

        await open(true);
        expect(hint()).toBe("include_note.size_hint");
        await pick(picture);
        expect(hint()).toBe("include_note.image_size_hint");

        await open(false);
        await pick(picture);
        expect(hint()).toBeUndefined();
    });

    it("keeps the include button disabled while no note is picked", async () => {
        const script = buildNote({ title: "Script", type: "code", mime: "text/javascript" });
        const button = container.querySelector<HTMLButtonElement>(".modal-footer button");
        if (!button) throw new Error("The dialog has no include button.");
        expect(button.disabled).toBe(true);

        await pick(script);
        expect(button.disabled).toBe(false);

        await act(async () => autocomplete.onChange?.(null));
        expect(button.disabled).toBe(true);
    });

    it("forgets the note picked the last time it was open", async () => {
        const script = buildNote({ title: "Script", type: "code", mime: "text/javascript" });
        await pick(script);
        await submit();
        expect(editorApi.addContentEmbed).toHaveBeenCalledExactlyOnceWith(script.noteId, "full");

        autocomplete.clear.mockClear();
        await open();
        expect(autocomplete.clear).toHaveBeenCalledOnce();
        expect(checkedSize()).toBe("medium");
        await submit();
        expect(editorApi.addContentEmbed).toHaveBeenCalledOnce();
    });
});
