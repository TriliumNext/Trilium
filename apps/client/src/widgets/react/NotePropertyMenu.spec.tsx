import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { buildNote } from "../../test/easy-froca";
import type FNote from "../../entities/fnote";
import { ViewProperty } from "./NotePropertyMenu";

describe("A collection property's explanation", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function draw(property: Parameters<typeof ViewProperty>[0]["property"]) {
        const note = buildNote({ title: "Board" }) as unknown as FNote;
        const element = document.createElement("div");
        container = element;
        document.body.appendChild(element);

        await act(async () => {
            render(<ViewProperty note={note} property={property} />, element);
        });
        return element;
    }

    /**
     * The note belongs to a property of any kind, so a button carries one the same way a checkbox
     * does. The label is what it stands beside, which is what this asserts alongside it.
     */
    it("stands beside the label of a property that is not a checkbox", async () => {
        const element = await draw({
            type: "button",
            label: "Collapse",
            icon: "bx bx-layer-minus",
            helpTooltip: "Folds every note under this one.",
            onClick() {}
        });

        expect(element.textContent).toContain("Collapse");
        expect(element.querySelector(".help-tooltip-button")).not.toBeNull();
    });

    it("is left out where the property carries none", async () => {
        const element = await draw({
            type: "button",
            label: "Collapse",
            icon: "bx bx-layer-minus",
            onClick() {}
        });

        expect(element.textContent).toContain("Collapse");
        expect(element.querySelector(".help-tooltip-button")).toBeNull();
    });

    it("stands on a checkbox too, whose label is the switch's own", async () => {
        const element = await draw({
            type: "checkbox",
            label: "Inbox column",
            icon: "bx bx-inbox",
            helpTooltip: "Shows the notes with no column yet.",
            bindToLabel: "enableInboxColumn"
        });

        expect(element.textContent).toContain("Inbox column");
        expect(element.querySelector(".help-tooltip-button")).not.toBeNull();
    });
});
