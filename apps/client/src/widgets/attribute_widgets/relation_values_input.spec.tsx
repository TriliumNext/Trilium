import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mock hands the test the props of the box, `noteIdChanged` being the one the field's behavior
// hangs off, and the field a handle whose `clear` it can watch.
const { autocomplete, clear } = vi.hoisted(() => ({
    autocomplete: { current: null as Record<string, unknown> | null },
    clear: vi.fn()
}));
vi.mock("../react/NoteAutocomplete", async () => {
    const { h } = await import("preact");
    return {
        default: (props: Record<string, unknown>) => {
            autocomplete.current = props;
            const handleRef = props.handleRef as { current: unknown } | undefined;
            if (handleRef) handleRef.current = { clear };
            return h("input", {
                id: props.id as string | undefined,
                tabIndex: props.tabIndex as number | undefined
            });
        }
    };
});

import { buildNote } from "../../test/easy-froca";
import RelationValuesInput, { RelationValueChips } from "./relation_values_input";

describe("RelationValuesInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof RelationValuesInput>[0]) {
        await act(async () => render(<RelationValuesInput {...props} />, container));
        return container;
    }

    it("shows the targets as chips linking to their notes, and drops the one pressed", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const onCommit = vi.fn();
        await mount({ values: [ alpha.noteId, beta.noteId ], onCommit });

        const chips = [ ...container.querySelectorAll(".tn-chip") ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "Alpha", "Beta" ]);

        // The title is the only way from the field to a target already held, so it opens the note:
        // an anchor, which is what the global handler navigates on. The icon stays outside it, so
        // the hover underline does not run across the gap between the two.
        const links = chips.map((chip) => chip.querySelector("a.tn-link"));
        expect(links.map((link) => link?.getAttribute("href")))
            .toEqual([ `#root/${alpha.noteId}`, `#root/${beta.noteId}` ]);
        expect(links[0]?.textContent).toBe("Alpha");
        expect(links[0]?.querySelector(".tn-icon")).toBeNull();

        await act(async () => chips[0]?.querySelector<HTMLElement>(".tn-chip-remove")?.click());
        expect(onCommit).toHaveBeenCalledWith([ beta.noteId ]);
    });

    it("takes a picked note once, refusing a second of the same and a pick of nothing", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const gamma = buildNote({ title: "Gamma" });
        const onCommit = vi.fn();
        await mount({ values: [ alpha.noteId ], onCommit });

        const pick = autocomplete.current?.noteIdChanged as (noteId: string) => void;

        await act(async () => pick(gamma.noteId));
        expect(onCommit).toHaveBeenCalledWith([ alpha.noteId, gamma.noteId ]);
        // What was in the box is spent on the choice made.
        expect(clear).toHaveBeenCalled();

        // A target already held would come out as a second chip there is no telling apart — and
        // clearing the box reports an empty pick, which is not a target at all.
        onCommit.mockClear();
        await act(async () => pick(alpha.noteId));
        await act(async () => pick(""));
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("points a host's own label at the box, and hands it the host's place in the tab order", async () => {
        await mount({ values: [], onCommit: vi.fn(), inputId: "field-id", tabIndex: 205 });
        const input = container.querySelector("input");
        expect(input?.id).toBe("field-id");
        expect(input?.getAttribute("tabindex")).toBe("205");
    });
});

describe("RelationValueChips", () => {
    it("names each target and links to it, the set being read rather than edited", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const container = document.createElement("div");
        document.body.appendChild(container);

        await act(async () => render(<RelationValueChips values={[ alpha.noteId ]} />, container));

        const link = container.querySelector(".tn-chip .reference-link");
        expect(link?.textContent?.trim()).toBe("Alpha");
        expect(link?.getAttribute("data-href")).toBe(`#root/${alpha.noteId}`);

        render(null, container);
        container.remove();
    });
});
