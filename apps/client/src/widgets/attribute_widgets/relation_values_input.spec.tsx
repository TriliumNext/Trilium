import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real box is an Algolia autocomplete bound to jQuery, which is not loaded here; the mock hands
// the test the props instead, `noteIdChanged` being the one the field's behaviour hangs off. The ref
// is forwarded to the box it builds, as the real field forwards it to the box the plugin builds.
const autocomplete = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("../react/NoteAutocomplete", async () => {
    const { h } = await import("preact");
    return {
        default: (props: Record<string, unknown>) => {
            autocomplete.current = props;
            return h("input", { id: props.id as string | undefined, ref: props.inputRef });
        }
    };
});

import $ from "jquery";

import { buildNote } from "../../test/easy-froca";
import RelationValuesInput, { RelationValueChips } from "./relation_values_input";

// Taking a pick clears the box through the plugin, which holds text of its own; the plugin is not
// loaded here, so its two calls are stubbed where jQuery keeps them.
const setSelectedNotePath = vi.fn();
type PluggedIn = { autocomplete(...args: unknown[]): PluggedIn; setSelectedNotePath(path: string): void };
($.fn as unknown as PluggedIn).autocomplete = function (this: PluggedIn) { return this; };
($.fn as unknown as PluggedIn).setSelectedNotePath = setSelectedNotePath;

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

    it("shows the targets as chips naming their notes, and drops the one pressed", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const onCommit = vi.fn();
        await mount({ values: [ alpha.noteId, beta.noteId ], onCommit });

        const chips = [ ...container.querySelectorAll(".tn-chip") ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "Alpha", "Beta" ]);

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
        // What was in the box is spent on the choice made: the plugin is told to let its text go,
        // or it would write the picked title right back over the cleared box.
        expect(setSelectedNotePath).toHaveBeenCalledWith("");

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
        // Set onto the box by hand: the field does not carry the attribute through to it.
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
