import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import NoteChips from "./NoteChips";

vi.mock("../../services/i18n", () => ({
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key)
}));
vi.mock("./NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <span className="note-link">{notePath}</span>
}));

const ids = (count: number) => Array.from({ length: count }, (_, index) => `n${index + 1}`);

describe("NoteChips", () => {
    it("shows the first notes and reveals the rest a page at a time", async () => {
        const container = renderInto(<NoteChips noteIds={ids(250)} />);
        expect(shownIds(container)).toStrictEqual(ids(5));
        expect(moreLink(container)?.textContent).toBe("note_chips.more:245");

        await act(async () => moreLink(container)?.click());
        expect(shownIds(container)).toHaveLength(105);
        expect(moreLink(container)?.textContent).toBe("note_chips.more:145");

        await act(async () => moreLink(container)?.click());
        await act(async () => moreLink(container)?.click());
        expect(shownIds(container)).toHaveLength(250);
        expect(moreLink(container)).toBeNull();
    });

    it("offers no removal unless asked to", async () => {
        const readOnly = renderInto(<NoteChips noteIds={ids(2)} />);
        expect([ ...readOnly.querySelectorAll<HTMLButtonElement>(".tn-chip-remove") ].every((b) => b.disabled)).toBe(true);

        const onRemove = vi.fn();
        const editable = renderInto(<NoteChips noteIds={ids(2)} onRemove={onRemove} removeButtonText="remove" />);
        const button = editable.querySelector<HTMLButtonElement>(".tn-chip-remove");
        expect(button?.disabled).toBe(false);
        await act(async () => button?.click());
        expect(onRemove).toHaveBeenCalledWith("n1");
    });
});

function shownIds(container: HTMLElement) {
    return [ ...container.querySelectorAll(".note-chips .tn-chip .note-link") ].map((el) => el.textContent);
}

function moreLink(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".note-chips .note-chips-more");
}
