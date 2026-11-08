import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import { buildNote } from "../../../test/easy-froca";
import type AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import { ParentComponent } from "../../react/react_utils";
import useColTableEditing from "./col_editing";

describe("useColTableEditing", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
        }
    });

    function mount() {
        const showAttributeDetail = vi.fn();
        const parent = {} as Record<string, Function>;
        const note = buildNote({ title: "Collection", "#label:status": "promoted,single,text" });

        function Probe() {
            useColTableEditing(
                { current: null },
                { showAttributeDetail } as unknown as AttributeDetailWidget,
                note,
                { current: undefined }
            );
            return null;
        }

        const host = document.createElement("div");
        container = host;
        document.body.appendChild(host);
        act(() => render(
            <ParentComponent.Provider value={parent as unknown as Component}>
                <Probe />
            </ParentComponent.Provider>,
            host
        ));
        return { parent, showAttributeDetail };
    }

    it("offers the multiple values toggle when adding or editing a column", () => {
        const { parent, showAttributeDetail } = mount();
        const column = { getField: () => "labels.status" };

        parent.addNewTableColumnCommand({});
        parent.addNewTableColumnCommand({ columnToEdit: column });

        expect(showAttributeDetail).toHaveBeenCalledTimes(2);
        for (const [ opts ] of showAttributeDetail.mock.calls) {
            expect(opts.hideMultiplicity).toBeFalsy();
        }
        expect(showAttributeDetail.mock.calls[1][0].attribute.name).toBe("label:status");
    });
});
