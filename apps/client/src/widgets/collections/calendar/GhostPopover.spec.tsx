import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type NoteTypeOption } from "../../../services/note_types";
import { type TemplateChoice } from "../../react/TemplateDropdown";
import GhostPopover from "./GhostPopover";
import { EventDraft } from "./selection";

// i18next is never initialized under test, so t() renders the key with the interpolated values
// appended, e.g. "calendar_view.duration_hours_minutes|1|30".
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => [ key, ...Object.values(opts ?? {}) ].join("|")
}));

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
    const TEXT: NoteTypeOption = {
        id: "type:text:text/html", title: "Text", icon: "bx bx-note", group: "type",
        options: { type: "text", mime: "text/html" }
    };

    function mount(
        onCommit: (title: string) => Promise<void> | void,
        templates: TemplateChoice = { offered: [ TEXT ], current: TEXT, onSelect() {}, onMore() {} }
    ) {
        act(() => render(
            <GhostPopover
                draft={draft}
                anchor={{ x: 10, y: 10 }}
                container={container}
                templates={templates}
                onCommit={onCommit}
                onCancel={() => {}}
                onDismiss={() => {}}
            />,
            container));
    }

    /** The button that asks for the note. */
    const createButton = () => document.querySelector<HTMLButtonElement>(".calendar-ghost-actions .btn-primary");
    const titleInput = () => document.querySelector<HTMLInputElement>(".calendar-ghost-body input");
    const timeInputs = () => [ ...document.querySelectorAll<HTMLInputElement>(".calendar-ghost-body input[type=time]") ];
    const dateInputs = () => [ ...document.querySelectorAll<HTMLInputElement>(".calendar-ghost-body input[type=date]") ];

    /** Commits a field as leaving it does, as the event popover's fields do (see EventDatesFields). */
    function commitValue(input: HTMLInputElement, value: string) {
        input.value = value;
        act(() => { input.dispatchEvent(new Event("focusout")); });
    }
    const duration = () => document.querySelector(".calendar-event-duration")?.textContent;

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
        expect(onCommit).toHaveBeenLastCalledWith("Fair", draft, TEXT);
    });

    it("focuses the title field once the popover is shown", async () => {
        // `Popover` keeps the card hidden until `placeFloating()` resolves, and a browser ignores
        // `focus()` on a hidden element, so the field must be focused only once the card shows.
        const visibilityAtFocus: string[] = [];
        const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
            visibilityAtFocus.push(this.closest<HTMLElement>(".tn-popover")?.style.visibility ?? "");
        });
        try {
            mount(vi.fn());
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        } finally {
            focus.mockRestore();
        }

        expect(visibilityAtFocus).not.toHaveLength(0);
        expect(visibilityAtFocus.every((visibility) => visibility === "visible")).toBe(true);
    });

    it("is given up on by Escape, except an Escape meant for a dialog or menu opened over it", () => {
        const onCancel = vi.fn();
        act(() => render(
            <GhostPopover
                draft={draft}
                anchor={{ x: 10, y: 10 }}
                container={container}
                templates={{ offered: [ TEXT ], current: TEXT, onSelect() {}, onMore() {} }}
                onCommit={vi.fn()}
                onCancel={onCancel}
                onDismiss={() => {}}
            />,
            container));
        const escape = (target: Element | null) => act(() => {
            target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        // The calendar's properties dialog, opened from the template field's menu.
        const dialog = document.createElement("div");
        dialog.className = "modal";
        dialog.appendChild(document.createElement("input"));
        document.body.appendChild(dialog);
        escape(dialog.querySelector("input"));
        expect(onCancel).not.toHaveBeenCalled();

        expect(titleInput()).not.toBeNull();
        escape(titleInput());
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("hands over the title as typed, an empty one standing for the calendar's own naming", async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        mount(onCommit);

        await act(async () => { createButton()?.click(); });

        // Committing blank is meaningful: the note is then named by the calendar's #titleTemplate.
        expect(onCommit).toHaveBeenCalledWith("", draft, TEXT);
    });

    it("names the template the event is made from, and makes it from the one shown at the commit", async () => {
        const canvas: NoteTypeOption = {
            ...TEXT, id: "type:canvas:application/json", title: "Canvas",
            options: { type: "canvas", mime: "application/json" }
        };
        const onCommit = vi.fn().mockResolvedValue(undefined);
        const choice = { offered: [ TEXT, canvas ], onSelect() {}, onMore() {} };
        const field = () => document.querySelector(".calendar-ghost-when .template-dropdown");
        const fieldName = () => field()?.querySelector(".template-dropdown-name")?.textContent;

        mount(onCommit, { ...choice, current: TEXT });
        // A row of the form like the dates, led by its own icon and showing the template's.
        const row = field()?.closest(".calendar-event-row");
        expect(row?.querySelector(".calendar-event-row-icon.bx-detail")).not.toBeNull();
        expect(field()?.querySelector(".select-button .bx-note")).not.toBeNull();
        expect(field()?.classList.contains("template-pill")).toBe(false);
        expect(fieldName()).toBe("Text");

        // A pick is stored by the calendar, which hands the ghost the new choice.
        mount(onCommit, { ...choice, current: canvas });
        expect(fieldName()).toBe("Canvas");

        await act(async () => { createButton()?.click(); });
        expect(onCommit).toHaveBeenCalledWith("", draft, canvas);
    });

    it("lets a whole-day draft be given hours before it is created", async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        mount(onCommit);

        const addTime = document.querySelector<HTMLButtonElement>(".calendar-event-add-time");
        if (!addTime) throw new Error("The ghost has no button to add a time.");
        expect(timeInputs()).toHaveLength(0);
        // The same date fields as the event popover: a start and an end day for a whole-day draft.
        expect(dateInputs().map((input) => input.value)).toEqual([ "2026-06-05", "" ]);
        expect(addTime.closest(".calendar-event-row")?.querySelector(".bx-time-five")).not.toBeNull();
        expect(duration()).toBeUndefined();

        act(() => { addTime.click(); });
        const [ start, end ] = timeInputs();
        expect(document.activeElement).toBe(start);
        expect(start.value).toBe("09:00");
        expect(end.value).toBe("10:00");
        expect(duration()).toBe("calendar_view.duration_hours|1");

        expect(dateInputs()).toHaveLength(2);
        commitValue(start, "14:00");
        commitValue(timeInputs()[1], "15:30");
        expect(duration()).toBe("calendar_view.duration_hours_minutes|1|30");
        expect(timeInputs()[0].closest(".calendar-event-row")?.querySelector(".calendar-event-duration")).not.toBeNull();
        await act(async () => { createButton()?.click(); });

        expect(onCommit).toHaveBeenCalledWith("", {
            startDate: "2026-06-05", startTime: "14:00", endTime: "15:30"
        }, TEXT);
    });

    it("lets the days of a draft be changed before it is created", async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        mount(onCommit);

        commitValue(dateInputs()[0], "2026-06-08");
        commitValue(dateInputs()[1], "2026-06-10");
        await act(async () => { createButton()?.click(); });

        expect(onCommit).toHaveBeenCalledWith(
            "", { startDate: "2026-06-08", endDate: "2026-06-10" }, TEXT);
    });

    it("leaves the end date empty for a slot within a single day", () => {
        // A drag within one day of the week view names that day as the end date too.
        act(() => render(
            <GhostPopover
                draft={{ startDate: "2026-06-05", endDate: "2026-06-05", startTime: "09:00", endTime: "09:30" }}
                anchor={null}
                container={container}
                templates={{ offered: [ TEXT ], current: TEXT, onSelect() {}, onMore() {} }}
                onCommit={vi.fn()}
                onCancel={() => {}}
                onDismiss={() => {}}
            />,
            container));

        expect(dateInputs().map((input) => input.value)).toEqual([ "2026-06-05", "" ]);
    });

    it("lets the hours be removed again, making the draft whole-day", async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        mount(onCommit);

        act(() => { document.querySelector<HTMLButtonElement>(".calendar-event-add-time")?.click(); });
        act(() => { document.querySelector<HTMLElement>(".calendar-event-remove-time")?.click(); });

        expect(timeInputs()).toHaveLength(0);
        expect(document.activeElement).toBe(document.querySelector(".calendar-event-add-time"));
        await act(async () => { createButton()?.click(); });
        expect(onCommit).toHaveBeenCalledWith(
            "", { startDate: "2026-06-05", startTime: null, endTime: null }, TEXT);
    });
});
