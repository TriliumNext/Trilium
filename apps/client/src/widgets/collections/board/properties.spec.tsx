import { Modal as BootstrapModal } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type { PromotedAttribute } from "../promoted_attributes";
import BoardApi from "./api";
import BoardProperties from "./properties";

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

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
            onClick={() => onChange([ "type:canvas:application/json" ])}
        />
    )
}));

// The card is tested in its own spec; what this dialog decides is the words it passes and where
// onChange writes.
vi.mock("../../react/PromotedAttributesCard", () => ({
    default: ({ heading, instruction, note, settings, onChange }: {
        heading: string, instruction: string, note: FNote,
        settings: { name: string }[] | undefined,
        onChange: (attributes: PromotedAttribute[]) => void
    }) => (
        <div
            className="attributes-stub"
            data-heading={heading}
            data-instruction={instruction}
            data-note={note.noteId}
            data-settings={settings?.map((setting) => setting.name).join(",")}
            onClick={() => onChange([ { name: "dueDate", hidden: true } as PromotedAttribute ])}
        />
    )
}));

describe("Board properties", () => {
    let container: HTMLElement;
    let stored: string[][];
    let storedAttributes: PromotedAttribute[][];
    let toggled: [ string, boolean ][];
    /** What the board shows, which the General card reads from the note's own labels. */
    let shownOnBoard: Record<string, boolean>;

    beforeEach(() => {
        stored = [];
        storedAttributes = [];
        toggled = [];
        shownOnBoard = { enableInboxColumn: false, includeArchived: true };
        container = document.createElement("div");
        document.body.appendChild(container);

        const board = {
            noteId: "board1",
            isLabelTruthy: (name: string) => !!shownOnBoard[name],
            getLabelValue: (name: string) => shownOnBoard[name] ? "true" : "false",
            getLabel: () => undefined,
            hasLabel: (name: string) => name in shownOnBoard
        } as unknown as FNote;

        const api = {
            setInboxEnabled: async (enabled: boolean) => { toggled.push([ "inbox", enabled ]); },
            setArchivedShown: async (shown: boolean) => { toggled.push([ "archived", shown ]); },
            getCardTemplateIds: () => [ "type:text:text/html" ],
            setCardTemplateIds: async (ids: string[]) => { stored.push(ids); },
            getStoredPromotedAttributes: () => [ { name: "dueDate" }, { name: "owner" } ],
            setPromotedAttributes: async (attributes: PromotedAttribute[]) => {
                storedAttributes.push(attributes);
            }
        } as unknown as BoardApi;

        act(() => {
            render(
                <BoardProperties
                    api={api}
                    note={board}
                    shown
                    onClose={() => {}}
                />,
                container);
        });
    });

    afterEach(() => {
        // Unmounted before Bootstrap is disposed: a modal Bootstrap still believes is shown traps
        // the focus of every later test, and its teardown waits on a transition happy-dom never
        // runs.
        render(null, container);
        container.remove();

        const modal = document.querySelector<HTMLElement>(".board-properties-dialog");
        if (modal) {
            BootstrapModal.getInstance(modal)?.dispose();
            modal.remove();
        }

        document.querySelector(".modal-backdrop")?.remove();
        document.body.classList.remove("modal-open");
    });

    it("holds the card templates, named and explained in the board's own words", () => {
        const card = dialog()?.querySelector<HTMLElement>(".templates-stub");

        expect(dialog()?.querySelector(".modal-title")?.textContent)
            .toContain("board_view.properties-title");
        expect(card?.dataset.heading).toBe("board_view.card-templates");
        expect(card?.dataset.instruction).toBe("board_view.card-templates-hint");
        // Filed under the board, and read from what the board offers now.
        expect(card?.dataset.note).toBe("board1");
        expect(card?.dataset.newName).toBe("board_view.new-template-name");
        expect(card?.dataset.templates).toBe("type:text:text/html");
    });

    describe("what the board shows", () => {
        /** Both were on the board's own menu; the inbox column is now offered only here. */
        it("draws a segment for each, reading what the board's labels say", () => {
            const rows = general()?.querySelectorAll(".tn-card-section") ?? [];

            expect(rows.length).toBe(2);
            expect(toggleAt(0)?.classList.contains("on")).toBe(false);
            expect(toggleAt(1)?.classList.contains("on")).toBe(true);
        });

        it("asks the board to show each of them", () => {
            act(() => { toggleAt(0)?.click(); });
            act(() => { toggleAt(1)?.click(); });

            expect(toggled).toEqual([ [ "inbox", true ], [ "archived", false ] ]);
        });

        function general() {
            return dialog()?.querySelector<HTMLElement>(".board-properties-general");
        }

        function toggleAt(index: number) {
            return general()?.querySelectorAll<HTMLElement>(".switch-button")[index];
        }
    });

    it("holds the promoted attributes, in the board's own words and from its own config", () => {
        const card = dialog()?.querySelector<HTMLElement>(".attributes-stub");

        expect(card?.dataset.heading).toBe("board_view.promoted-attributes");
        expect(card?.dataset.instruction).toBe("board_view.promoted-attributes-hint");
        expect(card?.dataset.note).toBe("board1");
        expect(card?.dataset.settings).toBe("dueDate,owner");
    });

    it("writes the order and what is hidden back to the board", () => {
        act(() => { dialog()?.querySelector<HTMLElement>(".attributes-stub")?.click(); });

        expect(storedAttributes).toEqual([ [ { name: "dueDate", hidden: true } ] ]);
    });

    it("writes what the card answers with back to the board", () => {
        act(() => { dialog()?.querySelector<HTMLElement>(".templates-stub")?.click(); });

        expect(stored).toEqual([ [ "type:canvas:application/json" ] ]);
    });

    function dialog() {
        return document.querySelector<HTMLElement>(".board-properties-dialog");
    }
});
