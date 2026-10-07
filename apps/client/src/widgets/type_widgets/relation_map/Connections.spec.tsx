import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import type { ClientRelation } from "./api";
import Connections, { type PendingRelation } from "./Connections";
import type { Box } from "./geometry";
import { useHoveredBox } from "./RelationMap";
import { noteIdToId } from "./utils";

describe("relation map Connections", () => {
    let container: HTMLElement | undefined;
    const onContextMenu = vi.fn();

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    const boxes = new Map<string, Box>([
        [ "a", { x: 0, y: 0, width: 100, height: 40 } ],
        [ "b", { x: 300, y: 0, width: 100, height: 40 } ],
        [ "c", { x: 300, y: 300, width: 100, height: 40 } ]
    ]);
    const relations: ClientRelation[] = [
        relation("ab", "a", "b", "uniDirectional", "author"),
        relation("bc", "b", "c", "inverse", "parentOf"),
        relation("ca", "c", "a", "biDirectional", "sibling")
    ];

    /** Renders boxes `a`, `b` and `c` with the relations above, highlighting those of the hovered box. */
    function mount(pending: PendingRelation | null = null) {
        buildNote({ id: "a", title: "A", "#color": "red" });
        buildNote({ id: "b", title: "B" });
        container = document.createElement("div");
        document.body.appendChild(container);

        function Harness() {
            const canvasRef = useRef<HTMLDivElement>(null);
            const hoveredNoteId = useHoveredBox(canvasRef);
            return (
                <div ref={canvasRef} className="canvas">
                    <Connections
                        relations={relations}
                        inverseRelations={{ parentOf: "childOf", sibling: "sibling" }}
                        boxes={boxes}
                        hoveredNoteId={hoveredNoteId}
                        hoveredRelationId={null}
                        pending={pending}
                        onHoverRelation={() => {}}
                        onContextMenu={onContextMenu}
                    />
                    {[ "a", "b", "c" ].map((noteId) => (
                        <div id={noteIdToId(noteId)} className="note-box"><span className="title" /></div>
                    ))}
                </div>
            );
        }
        act(() => render(<Harness />, container as HTMLElement));

        const canvas = container.querySelector(".canvas");
        if (!canvas) throw new Error("canvas not rendered");
        return canvas;
    }

    const connection = (id: string) => container?.querySelector<SVGGElement>(`[data-connection-id="${id}"]`);
    const labels = () => [ ...container?.querySelectorAll<HTMLElement>(".connection-label") ?? [] ];

    it("draws each relation with its arrowheads and labels, and opens its context menu", () => {
        mount();

        expect([ "ab", "bc", "ca" ].map((id) => connection(id)?.querySelectorAll(".relation-map-arrow").length))
            .toEqual([ 1, 2, 2 ]);
        expect(labels().map((label) => label.textContent)).toEqual([ "author", "parentOf", "childOf", "sibling" ]);

        act(() => { labels()[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
        expect(onContextMenu.mock.calls.at(-1)?.[0]).toBe(relations[0]);
    });

    it("lights the relations of the hovered box in its color and fades the others", () => {
        const canvas = mount();
        const classesOf = (id: string) => [ ...connection(id)?.classList ?? [] ].filter((name) => name !== "relation-map-connection");
        const hover = (element: Element | null | undefined) => act(() => {
            element?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });

        hover(canvas.querySelector(`#${noteIdToId("a")} .title`));
        expect([ classesOf("ab"), classesOf("bc"), classesOf("ca") ]).toEqual([ [ "lit" ], [ "faded" ], [ "lit" ] ]);
        expect(connection("ab")?.style.getPropertyValue("--relation-map-lit-color")).toBe("red");
        expect(labels()[0].classList.contains("lit")).toBe(true);

        hover(canvas.querySelector(`#${noteIdToId("b")}`));
        expect(classesOf("ab")).toEqual([ "lit" ]);
        expect(connection("ab")?.style.getPropertyValue("--relation-map-lit-color")).toBe("");

        act(() => { canvas.dispatchEvent(new MouseEvent("mouseleave")); });
        expect([ classesOf("ab"), classesOf("bc") ]).toEqual([ [], [] ]);
    });

    it("draws a relation being created toward the pointer", () => {
        mount({ sourceNoteId: "a", pointer: { x: 250, y: 20 } });

        expect(connection("pending")?.querySelector("path")?.getAttribute("d")).toBe("M 103 20 Q 176.5 20 250 20");
    });
});

function relation(attributeId: string, sourceNoteId: string, targetNoteId: string, type: ClientRelation["type"], name: string): ClientRelation {
    return { attributeId, sourceNoteId, targetNoteId, type, name, render: true };
}
