import { Modal as BootstrapModal } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import type { CalendarViewData } from "./api";
import CalendarProperties from "./CalendarProperties";

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));
// The settings dropdown's definitions translate through i18next directly, at import.
vi.mock("i18next", async (importOriginal) => ({
    ...await importOriginal<typeof import("i18next")>(),
    t: (key: string) => key
}));

/** What the stubbed card reports on the next click. */
let reported: string[] = [];

// TemplateSelectionCard is tested in its own spec. What this dialog decides is the labels it
// passes and where onChange writes.
vi.mock("../../react/TemplateSelectionCard", () => ({
    default: ({ heading, instruction, note, newTemplateName, templates, onChange }: {
        heading: string, instruction: string, note: FNote, newTemplateName?: string,
        templates: string[], onChange: (templates: string[]) => void
    }) => (
        <div
            className="templates-stub"
            data-heading={heading}
            data-instruction={instruction}
            data-note={note.noteId}
            data-new-name={newTemplateName}
            data-templates={templates.join(",")}
            onClick={() => onChange(reported)}
        />
    )
}));

// PromotedAttributesCard is tested in its own spec. These tests check the props the dialog passes
// and where onChange writes.
vi.mock("../../react/PromotedAttributesCard", () => ({
    default: ({
        heading, instruction, settings, drawnByCollection, itemNotes, unarrangedHidden, omitDrawn,
        onChange
    }: {
        heading: string, instruction: string, settings?: { name: string }[],
        drawnByCollection?: string[], itemNotes?: FNote[], unarrangedHidden?: boolean,
        omitDrawn?: boolean,
        onChange: (attributes: { name: string, hidden: boolean }[]) => void
    }) => (
        <div
            className="attributes-stub"
            data-heading={heading}
            data-instruction={instruction}
            data-settings={settings?.map((setting) => setting.name).join(",")}
            data-drawn={drawnByCollection?.join(",")}
            data-items={itemNotes?.map((item) => item.noteId).join(",")}
            data-unarranged-hidden={String(!!unarrangedHidden)}
            data-omit-drawn={String(!!omitDrawn)}
            onClick={() => onChange([
                { name: "mood", hidden: false }, { name: "where", hidden: true }
            ])}
        />
    )
}));

describe("CalendarProperties", () => {
    let container: HTMLElement;
    let saved: CalendarViewData[];
    const calendar = buildNote({
        id: "calendar1", title: "Calendar", "#calendar:startDate": "myStart",
        children: [ { id: "event1", title: "Fair", "#startDate": "2025-05-05" } ]
    }) as unknown as FNote;

    function draw(viewConfig: CalendarViewData | undefined, note = calendar) {
        act(() => {
            render(
                <CalendarProperties
                    note={note}
                    eventNoteIds={[ "event1" ]}
                    viewConfig={viewConfig}
                    saveConfig={(config) => saved.push(config)}
                    onClose={() => {}}
                />,
                container);
        });
        return document.querySelector<HTMLElement>(".calendar-properties-dialog .templates-stub");
    }

    beforeEach(() => {
        saved = [];
        reported = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        // Unmounted before Bootstrap is disposed: a modal Bootstrap still believes is shown traps
        // the focus of every later test.
        render(null, container);
        container.remove();

        const modal = document.querySelector<HTMLElement>(".calendar-properties-dialog");
        if (modal) {
            BootstrapModal.getInstance(modal)?.dispose();
            modal.remove();
        }

        document.querySelector(".modal-backdrop")?.remove();
        document.body.classList.remove("modal-open");
    });

    it("holds the event templates, offering text until the calendar has its own", () => {
        const card = draw(undefined);

        expect(document.querySelector(".calendar-properties-dialog .modal-title")?.textContent)
            .toContain("calendar_view.properties-title");
        expect(card?.dataset.heading).toBe("calendar_view.event_templates");
        expect(card?.dataset.instruction).toBe("calendar_view.event_templates_hint");
        expect(card?.dataset.note).toBe("calendar1");
        expect(card?.dataset.newName).toBe("calendar_view.new_template_name");
        expect(card?.dataset.templates).toBe("type:text:text/html");

        expect(draw({ templates: [ "note:mine" ] })?.dataset.templates).toBe("note:mine");
    });

    it("repeats the settings dropdown's calendar settings in a General card, above the templates", () => {
        draw(undefined);
        const general = document.querySelector(".calendar-properties-dialog .calendar-properties-general");
        const titles = [ ...general?.querySelectorAll(".tn-card-option-title") ?? [] ]
            .map((title) => title.textContent);

        expect(titles).toEqual([
            "book_properties_config.hide-weekends",
            "book_properties_config.display-week-numbers",
            "book_properties_config.hide-routine-events",
            "calendar_view.time_slots",
            "calendar_view.slot_duration",
            "calendar_view.slot_label_interval"
        ]);
        expect(general?.compareDocumentPosition(document.querySelector(".templates-stub") as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("holds which notes the calendar gathers in a card of their own, after General", () => {
        draw(undefined);
        const dialog = document.querySelector(".calendar-properties-dialog");
        const general = dialog?.querySelector(".calendar-properties-general");
        const included = dialog?.querySelector(".collection-included-notes");
        const titles = [ ...included?.querySelectorAll(".tn-card-option-title") ?? [] ]
            .map((title) => title.textContent);

        expect(included?.querySelector(".tn-card-heading")?.textContent)
            .toContain("book_properties.included_notes");
        expect(titles).toEqual([
            "book_properties.include_archived_notes",
            "book_properties_config.max-nesting-depth"
        ]);
        const depth = [ ...included?.querySelectorAll(".tn-card-option-label") ?? [] ].at(-1);
        expect(depth?.querySelector(".tn-card-option-description")?.textContent)
            .toBe("book_properties_config.max-nesting-depth-description");
        expect(general?.compareDocumentPosition(included as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        const attributes = document.querySelector(".attributes-stub");
        expect(included?.compareDocumentPosition(attributes as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    /** On a phone the new-event form is itself a dialog, opened before this one from its template field. */
    it("lists the event attributes, which start hidden, and stores them beside the rest", () => {
        draw({ template: "type:text:text/html", promotedAttributes: [ { name: "mood" } ] });
        const card = document.querySelector<HTMLElement>(
            ".calendar-properties-dialog .attributes-stub");

        expect(card?.dataset.heading).toBe("calendar_view.event_attributes");
        expect(card?.dataset.instruction).toBe("calendar_view.event_attributes_hint");
        expect(card?.dataset.settings).toBe("mood");
        expect(card?.dataset.unarrangedHidden).toBe("true");
        expect(card?.dataset.omitDrawn).toBe("true");
        // The calendar draws the date labels itself, custom names included, so the card omits them.
        expect(card?.dataset.drawn?.split(",")).toEqual([
            "startDate", "endDate", "startTime", "endTime", "recurrence", "myStart"
        ]);
        expect(card?.dataset.items).toBe("event1");

        act(() => card?.click());
        expect(saved).toEqual([ {
            template: "type:text:text/html",
            promotedAttributes: [ { name: "mood" }, { name: "where", hidden: true } ]
        } ]);
    });

    it("mentions the #calendar:displayedAttributes label when the calendar has one", () => {
        const labelled = buildNote({
            title: "Labelled", "#calendar:displayedAttributes": "mood"
        }) as unknown as FNote;
        draw(undefined, labelled);

        expect(document.querySelector<HTMLElement>(".attributes-stub")?.dataset.instruction)
            .toBe("calendar_view.event_attributes_overridden");
    });

    it("opens over the dialog already open rather than closing it", () => {
        const sheet = document.createElement("div");
        sheet.className = "modal";
        document.body.appendChild(sheet);
        glob.activeDialog = $(sheet);

        try {
            draw(undefined);
            expect(glob.activeDialog?.[0]).toBe(sheet);
        } finally {
            glob.activeDialog = null;
            sheet.remove();
        }
    });

    it("stores what the card reports beside the rest of the config, and refuses an empty list", () => {
        const card = draw({ templates: [ "type:text:text/html" ], template: "type:text:text/html" });
        expect(card).not.toBeNull();

        reported = [ "type:canvas:application/json", "note:mine" ];
        act(() => card?.click());
        expect(saved).toEqual([ {
            templates: [ "type:canvas:application/json", "note:mine" ],
            template: "type:text:text/html"
        } ]);

        reported = [];
        act(() => card?.click());
        expect(saved).toHaveLength(1);
    });
});
