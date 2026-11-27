import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InkTextBox } from "./ink_document";
import TextBoxLayer from "./TextBoxLayer";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

describe("TextBoxLayer", () => {
    const host = document.createElement("div");
    const surface = document.createElement("div");
    document.body.append(host, surface);
    afterEach(() => act(() => render(null, host)));

    function renderLayer(props: { noteId: string, boxes: InkTextBox[], isAdding?: boolean, onChange?: (boxes: InkTextBox[]) => void }) {
        const surfaceRef = { current: surface };
        act(() => render(
            <TextBoxLayer
                layerRef={createRef()}
                surfaceRef={surfaceRef}
                noteId={props.noteId}
                boxes={props.boxes}
                isAdding={props.isAdding ?? false}
                isInteractive
                toWorld={(x, y) => ({ x, y })}
                getZoom={() => 1}
                takeOrder={() => 0}
                onChange={props.onChange ?? (() => {})}
                onSelect={() => {}}
            />, host));
    }

    function press(type: "pointerdown" | "pointerup", pointerId: number, x: number, y: number) {
        act(() => {
            surface.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y, button: 0, bubbles: true }));
        });
    }

    it("adds a box on a tap of the paper, and leaves a drag or a pinch to the surface", () => {
        const onChange = vi.fn();
        renderLayer({ noteId: "a", boxes: [], isAdding: true, onChange });

        press("pointerdown", 1, 10, 10);
        press("pointerup", 1, 60, 10);
        press("pointerdown", 1, 10, 10);
        press("pointerdown", 2, 80, 80);
        press("pointerup", 1, 10, 10);
        press("pointerup", 2, 80, 80);
        expect(onChange).not.toHaveBeenCalled();

        press("pointerdown", 1, 40, 50);
        press("pointerup", 1, 42, 51);
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange.mock.lastCall?.[0]).toMatchObject([ { x: 42, y: 51, html: "" } ]);
    });

    it("does not carry the selection over to a box of the same ID in another note", () => {
        const box = { id: "rnote1", order: 0, html: "<p>A</p>", x: 0, y: 0, width: 100 };
        renderLayer({ noteId: "a", boxes: [ box ] });
        const first = host.querySelector<HTMLElement>(".handwriting-text-box");
        expect(first).not.toBeNull();
        act(() => {
            first?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(host.querySelector(".handwriting-text-box")?.classList.contains("selected")).toBe(true);

        renderLayer({ noteId: "b", boxes: [ { ...box, html: "<p>B</p>" } ] });
        const second = host.querySelector(".handwriting-text-box");
        expect(second?.textContent).toContain("B");
        expect(second?.classList.contains("selected")).toBe(false);
    });
});
