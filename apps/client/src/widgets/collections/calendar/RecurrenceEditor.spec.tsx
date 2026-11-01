import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import RecurrenceEditor, { YEAR_COUNT_TEMPLATE } from "./RecurrenceEditor";

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

describe("RecurrenceEditor's year count", () => {
    let container: HTMLElement;
    const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
    const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockResolvedValue(true);

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        setLabel.mockClear();
        removeLabel.mockClear();
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    /** Renders the editor for `note` and opens its dropdown. */
    function open(note: FNote) {
        act(() => render(
            <ParentComponent.Provider value={new Component()}>
                <RecurrenceEditor note={note} />
            </ParentComponent.Provider>,
            container));

        const toggle = container.querySelector<HTMLButtonElement>(".calendar-recurrence-dropdown button");
        if (!toggle) throw new Error("expected the dropdown toggle to render");
        act(() => {
            toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle.click();
        });
        // The frequency choice is in the panel whatever the rule, so its absence means it never opened.
        expect(document.querySelector(".calendar-recurrence-dropdown .tn-segmented-choice")).not.toBeNull();
    }

    const checkbox = () =>
        document.querySelector<HTMLInputElement>(".calendar-recurrence-years input[type='checkbox']");

    it("is offered on a yearly rule only", () => {
        open(buildNote({ title: "Standup", "#startDate": "2026-01-05", "#recurrence": "RRULE:FREQ=WEEKLY" }));
        expect(checkbox()).toBeNull();

        act(() => render(null, container));
        open(buildNote({ title: "John Smith", "#startDate": "1990-05-12", "#recurrence": "RRULE:FREQ=YEARLY" }));
        expect(checkbox()?.checked).toBe(false);
        expect(checkbox()?.disabled).toBe(false);
    });

    it("writes the template when checked and removes it when unchecked", () => {
        const note = buildNote({ title: "John Smith", "#startDate": "1990-05-12", "#recurrence": "RRULE:FREQ=YEARLY" });
        open(note);
        act(() => { checkbox()?.click(); });
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "calendar:titleTemplate", YEAR_COUNT_TEMPLATE);

        act(() => render(null, container));
        const counted = buildNote({
            title: "Jane Smith",
            "#startDate": "1990-05-12",
            "#recurrence": "RRULE:FREQ=YEARLY",
            "#calendar:titleTemplate": YEAR_COUNT_TEMPLATE
        });
        open(counted);
        expect(checkbox()?.checked).toBe(true);
        act(() => { checkbox()?.click(); });
        expect(removeLabel).toHaveBeenCalledWith(counted, "calendar:titleTemplate");
    });

    it("is locked when a template the checkbox did not write applies", () => {
        open(buildNote({
            title: "John Smith",
            "#startDate": "1990-05-12",
            "#recurrence": "RRULE:FREQ=YEARLY",
            "#calendar:titleTemplate": "${title} turns ${years}"
        }));
        expect(checkbox()?.checked).toBe(false);
        expect(checkbox()?.disabled).toBe(true);

        act(() => render(null, container));
        const calendar = buildNote({
            title: "Birthdays",
            "#calendar:titleTemplate(inheritable)": YEAR_COUNT_TEMPLATE,
            children: [
                { title: "John Smith", "#startDate": "1990-05-12", "#recurrence": "RRULE:FREQ=YEARLY" }
            ]
        });
        const inheriting = froca.notes[calendar.getChildNoteIds()[0] ?? ""];
        expect(inheriting).toBeDefined();
        open(inheriting);
        expect(checkbox()?.checked).toBe(true);
        expect(checkbox()?.disabled).toBe(true);
    });
});
