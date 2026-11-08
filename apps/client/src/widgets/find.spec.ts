import { describe, expect, it, vi } from "vitest";

import type NoteContext from "../components/note_context";
import FindWidget from "./find";

vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));

function fakeContext(ntxId: string) {
    return { ntxId, note: null } as unknown as NoteContext;
}

describe("FindWidget", () => {
    it("stays on its pinned context while the tabs switch theirs", async () => {
        const popup = fakeContext("_popup-editor");
        const tab = fakeContext("main");
        const widget = new FindWidget("_popup-editor");
        widget.render();

        await widget.handleEvent("activeContextChanged", { noteContext: popup });
        expect(widget.noteContext).toBe(popup);

        await widget.handleEvent("activeContextChanged", { noteContext: tab });
        await widget.handleEvent("noteSwitchedAndActivated", { noteContext: tab, notePath: "root/n2" });
        await widget.handleEvent("setNoteContext", { noteContext: tab });
        expect(widget.noteContext).toBe(popup);

        // Unpinned, the bar follows the active context, as it does in the tab row.
        const unpinned = new FindWidget();
        unpinned.render();
        await unpinned.handleEvent("activeContextChanged", { noteContext: tab });
        expect(unpinned.noteContext).toBe(tab);
    });

    it("keeps Escape to itself, so a dialog around it stays open", () => {
        const widget = new FindWidget();
        const host = document.body.appendChild(document.createElement("div"));
        const onHost = vi.fn();
        host.addEventListener("keydown", onHost);
        widget.render().appendTo(host);

        const input = host.querySelector(".find-widget-search-term-input");
        expect(input).not.toBeNull();
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onHost).not.toHaveBeenCalled();

        host.remove();
    });
});
