import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GhostPopover from "./GhostPopover";
import { EventDraft } from "./selection";

describe("GhostPopover", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        document.body.innerHTML = "";
    });

    const draft: EventDraft = { startDate: "2026-06-05" };

    function mount(onCommit: (title: string) => Promise<void> | void) {
        act(() => render(
            <GhostPopover
                draft={draft}
                anchor={{ x: 10, y: 10 }}
                container={container}
                onCommit={onCommit}
                onCancel={() => {}}
                onDismiss={() => {}}
            />,
            container));
    }

    /** The form's only button, which is the one that asks for the note. */
    const createButton = () => document.querySelector<HTMLButtonElement>(".calendar-ghost-actions button");
    const titleInput = () => document.querySelector<HTMLInputElement>(".calendar-ghost-body input");

    it("asks for the note once, however many times the ask is made before it arrives", async () => {
        // A request still out, which is the window each further Enter would make its own note in.
        const onCommit = vi.fn().mockReturnValue(new Promise<void>(() => {}));
        mount(onCommit);

        act(() => { createButton()?.click(); });
        act(() => { createButton()?.click(); });

        expect(onCommit).toHaveBeenCalledTimes(1);
        // Held shut for as long as the asking lasts.
        expect(createButton()?.disabled).toBe(true);
    });

    it("opens the form again where the note could not be made, keeping the title for another try", async () => {
        const onCommit = vi.fn().mockRejectedValue(new Error("the server said no"));
        mount(onCommit);

        const input = titleInput();
        if (!input) throw new Error("The ghost has no title field.");
        input.value = "Fair";
        act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });

        await act(async () => { createButton()?.click(); });

        // Nothing was created and the calendar keeps the ghost up, so the button that asks must be
        // pressable again — otherwise the title just typed can only be discarded.
        expect(createButton()?.disabled).toBe(false);
        expect(titleInput()?.value).toBe("Fair");

        // And a second try really does ask again.
        await act(async () => { createButton()?.click(); });
        expect(onCommit).toHaveBeenCalledTimes(2);
        expect(onCommit).toHaveBeenLastCalledWith("Fair");
    });

    it("hands over the title as typed, an empty one standing for the calendar's own naming", async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        mount(onCommit);

        await act(async () => { createButton()?.click(); });

        // Committing blank is meaningful: the note is then named by the calendar's #titleTemplate.
        expect(onCommit).toHaveBeenCalledWith("");
    });
});
