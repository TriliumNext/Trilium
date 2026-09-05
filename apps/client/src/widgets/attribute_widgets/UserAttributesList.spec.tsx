import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import UserAttributesDisplay from "./UserAttributesList";

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

/** A note carrying the given labels, each defined and promoted. */
function noteWith(labels: Record<string, string[]>) {
    return {
        noteId: "card1",
        getAttributeDefinitions: () => Object.keys(labels).map((name) => ({
            name: `label:${name}`,
            getDefinition: () => ({ isPromoted: true, labelType: "text" })
        })),
        getLabels: (name: string) => (labels[name] ?? []).map((value) => ({ value })),
        getRelations: () => []
    } as unknown as FNote;
}

const NOTE = noteWith({ dueDate: [ "2026-01-01" ], owner: [ "Ada" ], stage: [ "Doing" ] });

describe("UserAttributesDisplay", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.body.appendChild(document.createElement("div"));
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("draws every defined attribute, in the order the definitions stand in", () => {
        draw();

        expect(values()).toEqual([ "2026-01-01", "Ada", "Doing" ]);
    });

    it("draws only what it is told to, in the order it is given them", () => {
        draw({ shownAttributes: [ "stage", "dueDate" ] });

        expect(values()).toEqual([ "Doing", "2026-01-01" ]);
    });

    it("draws nothing where nothing is to be shown", () => {
        draw({ shownAttributes: [] });

        expect(container.querySelector(".user-attributes")).toBeNull();
    });

    /** The values of one attribute belong together wherever the attribute is placed. */
    it("keeps the values of one attribute together", () => {
        const note = noteWith({ tag: [ "red", "green" ], owner: [ "Ada" ] });

        draw({ note, shownAttributes: [ "owner", "tag" ] });

        expect(values()).toEqual([ "Ada", "red", "green" ]);
    });

    it("leaves out what it is told to ignore, whichever way it is ordered", () => {
        draw({ ignoredAttributes: [ "stage" ], shownAttributes: [ "stage", "owner" ] });

        expect(values()).toEqual([ "Ada" ]);
    });

    /** The reader arranges the attributes while the items are on screen. */
    it("draws them afresh when what is to be shown changes", () => {
        draw({ shownAttributes: [ "owner" ] });
        expect(values()).toEqual([ "Ada" ]);

        draw({ shownAttributes: [ "stage", "owner" ] });

        expect(values()).toEqual([ "Doing", "Ada" ]);
    });

    function draw({ note = NOTE, ignoredAttributes, shownAttributes }: {
        note?: FNote, ignoredAttributes?: string[], shownAttributes?: string[]
    } = {}) {
        act(() => {
            render(
                <UserAttributesDisplay
                    note={note}
                    ignoredAttributes={ignoredAttributes}
                    shownAttributes={shownAttributes}
                />,
                container);
        });
    }

    /** What each attribute reads as, less the name that leads it. */
    function values() {
        return [ ...container.querySelectorAll(".user-attribute") ]
            .map((element) => element.textContent?.split(": ").at(-1));
    }
});
