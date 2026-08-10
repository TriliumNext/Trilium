import { type LabelType } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MultiValueInput from "./multi_value_input";

describe("MultiValueInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Partial<Parameters<typeof MultiValueInput>[0]> & { labelType: LabelType }) {
        await act(async () => render(
            <MultiValueInput values={[]} onCommit={vi.fn()} {...props} />, container
        ));
        return container;
    }

    it("picks a closed set from a list, and takes anything else through a box of its type", async () => {
        // A select's options and the two values a flag can be are both closed sets, so neither may be
        // typed into: a value has to be picked, which is what the list-backed box is for.
        for (const labelType of [ "select", "boolean" ] as const) {
            await mount({ labelType, options: [ "Todo", "Done" ] });
            expect(container.querySelector(".select-values-input")).not.toBeNull();
        }

        // Everything else is entered directly, through the field a single value of that type uses —
        // a calendar for a date, a dialog for a colour, a plain box for text.
        for (const [ labelType, type ] of [
            [ "text", "text" ], [ "date", "date" ], [ "datetime", "datetime-local" ],
            [ "time", "time" ], [ "color", "color" ], [ "number", "number" ], [ "email", "email" ]
        ] as const) {
            await mount({ labelType });
            expect(container.querySelector(".select-values-input")).toBeNull();
            expect(container.querySelector("input")?.type).toBe(type);
        }
    });

    it("shows each value as its type reads it, rather than as the text it is stored as", async () => {
        // `#3d5a80` names nothing to the eye, so a colour is its swatch even while being edited.
        await mount({ labelType: "color", values: [ "#3d5a80" ] });
        expect(container.querySelector(".tn-chip .label-color-swatch")?.getAttribute("title"))
            .toBe("#3d5a80");

        // And a flag is the mark a single flag's own field shows, not the word "true".
        await mount({ labelType: "boolean", values: [ "true", "false" ] });
        const marks = [ ...container.querySelectorAll(".tn-chip .tn-icon") ];
        expect(marks.map((mark) => mark.getAttribute("title"))).toEqual([ "true", "false" ]);
        expect(marks[0]?.className).toContain("label-flag-set");
        expect(marks[0]?.className).toContain("bx-check");
        expect(marks[1]?.className).toContain("label-flag-unset");
        expect(marks[1]?.className).toContain("bx-x");
    });

    it("offers a flag no way of adding to its options, there being nothing a flag can also be", async () => {
        const onCreateOption = vi.fn();
        await mount({ labelType: "boolean", values: [], onCreateOption });

        const input = container.querySelector("input");
        await act(async () => input?.focus());
        await act(async () => {
            if (input) {
                input.value = "maybe";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
        });

        expect(document.querySelector(".select-create-option")).toBeNull();
        expect(onCreateOption).not.toHaveBeenCalled();
    });

    it("points a host's own label and tab order at the box, whichever box that is", async () => {
        for (const labelType of [ "select", "text", "color" ] as const) {
            await mount({ labelType, inputId: "field-id", tabIndex: 207 });
            const input = container.querySelector("input");
            expect(input?.id).toBe("field-id");
            expect(input?.tabIndex).toBe(207);
        }
    });
});
