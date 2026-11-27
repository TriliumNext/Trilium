import type { TriliumVim, VimHintSection } from "@triliumnext/ckeditor5";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ triggerEvent: vi.fn() }));

vi.mock("../../../components/app_context", () => ({
    default: { triggerEvent: mocks.triggerEvent }
}));

import { getVimHintSection, toggleVimKeyReference, VimKeyReference } from "./vim_key_reference";

let container: HTMLElement;

beforeEach(() => {
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.resetAllMocks();
});

describe("the Vim key list", () => {
    it("shows the sections of the Vim mode, and follows its status", () => {
        const { vim, setReference } = createVim([ {
            title: "Moving",
            hints: [
                { keys: [ "h", "l" ], description: "left, right" },
                { keys: [ "a", "z" ], isRange: true, description: "a mark" },
                { keys: [ "s[ubstitute]" ], isLiteral: true, description: "replace" }
            ]
        } ]);
        act(() => render(<VimKeyReference vim={vim} />, container));
        expect(container.querySelector(".shortcut-hints-section-title")?.textContent)
            .toBe("Moving");
        expect([ ...container.querySelectorAll("dt") ].map((row) => row.textContent))
            .toEqual([ "left, right", "a mark", "replace" ]);
        expect([ ...container.querySelectorAll("dd") ].map((row) => row.innerHTML)).toEqual([
            "<span class=\"shortcut-hint-alt\"><kbd>h</kbd></span>"
                + "<span class=\"shortcut-hint-alt\"><kbd>l</kbd></span>",
            "<kbd>a</kbd>-<kbd>z</kbd>",
            "<span class=\"shortcut-hint-alt\"><code>s[ubstitute]</code></span>"
        ]);

        act(() => setReference([ { title: "Insert mode keys", hints: [] } ]));
        expect(container.querySelector(".shortcut-hints-section-title")?.textContent)
            .toBe("Insert mode keys");
        act(() => render(null, container));
        expect(vim.listeners.size).toBe(0);
    });

    it("opens as a section of the Shortcut Hints panel that stays", () => {
        const { vim } = createVim([]);
        const section = getVimHintSection(vim);
        expect(section).toMatchObject({ hints: [], isPersistent: true });
        act(() => render(<>{section.content?.()}</>, container));
        expect(vim.getKeyReference).toHaveBeenCalled();

        const anchor = document.createElement("button");
        toggleVimKeyReference(vim, anchor);
        expect(mocks.triggerEvent).toHaveBeenCalledWith("shortcutHintsRequested", {
            sections: [ expect.objectContaining({ isPersistent: true }) ], anchor
        });
    });
});

function createVim(initial: VimHintSection[]) {
    let reference = initial;
    const listeners = new Set<() => void>();
    const vim = {
        listeners,
        getKeyReference: vi.fn(() => reference),
        on: (_event: string, callback: () => void) => listeners.add(callback),
        off: (_event: string, callback: () => void) => listeners.delete(callback)
    };
    const setReference = (next: VimHintSection[]) => {
        reference = next;
        for (const listener of listeners) {
            listener();
        }
    };
    return { vim: vim as unknown as TriliumVim & { listeners: Set<() => void> }, setReference };
}
