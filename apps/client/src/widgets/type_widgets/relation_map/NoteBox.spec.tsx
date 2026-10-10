import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import FAttribute from "../../../entities/fattribute";
import cssClassManager from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import noteAttributeCache from "../../../services/note_attribute_cache";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import type RelationMapApi from "./api";
import { NoteBox } from "./NoteBox";

describe("relation map NoteBox", () => {
    let container: HTMLElement | undefined;
    let component: Component;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        component = new Component();
        buildNote({ id: "boxnote", title: "Specification", "#iconClass": "bx bx-bug" });
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    const onResize = vi.fn();

    function Harness({ selected, isReadOnly }: { selected: boolean; isReadOnly: boolean }) {
        const mapApiRef = useRef<RelationMapApi>(null);
        return <NoteBox noteId="boxnote" x={10} y={20} mapApiRef={mapApiRef} selected={selected} isReadOnly={isReadOnly} onPointerDown={() => {}} onResize={onResize} />;
    }

    async function mount(selected = false, isReadOnly = false) {
        await act(async () => {
            render(
                <ParentComponent.Provider value={component}>
                    <Harness selected={selected} isReadOnly={isReadOnly} />
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
        await settle();
    }

    async function settle() {
        await act(async () => {
            for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve));
        });
    }

    const box = () => container?.querySelector<HTMLElement>(".note-box") ?? null;

    it("shows the note's icon and title as a card, not as a link, and reports its size", async () => {
        await mount();

        expect(box()?.classList.contains("tn-note-card")).toBe(true);
        expect(box()?.querySelector(".note-box-icon")?.classList.contains("bx-bug")).toBe(true);
        expect(box()?.querySelector(".note-box-title")?.textContent).toBe("Specification");
        expect(box()?.querySelector("a")).toBeNull();
        expect(onResize).toHaveBeenCalledWith("boxnote", { width: 0, height: 0 });
    });

    it("offers a handle to draw a relation from only on a map that can be edited", async () => {
        await mount();
        expect(box()?.querySelector(".endpoint")).not.toBeNull();

        await mount(false, true);
        expect(box()).not.toBeNull();
        expect(box()?.querySelector(".endpoint")).toBeNull();
    });

    it("follows the note's colour and the selection", async () => {
        await mount();
        const coloured = cssClassManager.createClassForColor("#ff0000");
        expect(box()?.className).not.toContain(coloured);

        await addColor("#ff0000");
        await mount(true);

        expect(box()?.className).toContain(coloured);
        expect(box()?.classList.contains("with-hue")).toBe(true);
        expect(box()?.classList.contains("selected")).toBe(true);

        await mount(false);
        expect(box()?.classList.contains("selected")).toBe(false);
        expect(box()?.className).toContain(coloured);
    });

    /** Adds a `#color` label to the note and announces it, as a sync or the color picker would. */
    async function addColor(value: string) {
        const attributeId = utils.randomString(12);
        const noteId = "boxnote";
        const attribute = new FAttribute(froca, {
            noteId, attributeId, type: "label", name: "color", value, position: 0, isInheritable: false
        });
        froca.attributes[attributeId] = attribute;
        froca.notes[noteId].attributes.push(attributeId);
        noteAttributeCache.attributes[noteId] = [ ...(noteAttributeCache.attributes[noteId] ?? []), attribute ];

        const entity = { attributeId, noteId, type: "label", name: "color", value, isDeleted: false };
        const loadResults = new LoadResults([ {
            entityName: "attributes", entityId: attributeId, entity, hash: "", isSynced: true, isErased: false
        } ]);
        loadResults.addAttribute(attributeId, "someOtherComponent");

        await act(async () => {
            await component.handleEvent("entitiesReloaded", { loadResults });
        });
        await settle();
    }
});
