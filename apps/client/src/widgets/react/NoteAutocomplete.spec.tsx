import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/note_autocomplete", () => ({
    default: { initNoteAutocomplete: vi.fn(), setText: vi.fn() }
}));

import $ from "jquery";

import { renderInto } from "../../test/render";
import NoteAutocomplete from "./NoteAutocomplete";

// The autocomplete plugin is not loaded here, so the calls that clear an empty input are stubbed.
type PluggedIn = {
    autocomplete(...args: unknown[]): PluggedIn;
    setSelectedNotePath(path: string): void;
};
($.fn as unknown as PluggedIn).autocomplete = function (this: PluggedIn) { return this; };
($.fn as unknown as PluggedIn).setSelectedNotePath = vi.fn();

describe("NoteAutocomplete", () => {
    it("sets tabIndex on the input only when the host gives one", async () => {
        let container = document.createElement("div");
        await act(async () => {
            container = renderInto(<NoteAutocomplete id="ordered" tabIndex={205} />);
        });
        const ordered = container.querySelector("input.note-autocomplete");
        expect(ordered).not.toBeNull();
        expect(ordered?.id).toBe("ordered");
        expect(ordered?.getAttribute("tabindex")).toBe("205");

        await act(async () => {
            container = renderInto(<NoteAutocomplete id="unordered" />);
        });
        const unordered = container.querySelector("input.note-autocomplete");
        expect(unordered).not.toBeNull();
        expect(unordered?.id).toBe("unordered");
        expect(unordered?.hasAttribute("tabindex")).toBe(false);
    });
});
