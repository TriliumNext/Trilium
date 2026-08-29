/**
 * The ghost pin that follows the pointer while the map is armed for placement (see GhostPin.tsx):
 * a translucent copy of the very pin the click will produce, so the map shows what it is offering
 * before it is taken up on it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import GhostPin from "./GhostPin";
import { ParentMap } from "./map";
import { DEFAULT_MARKER_COLOR } from "./Markers";

vi.mock("../../../services/icon_glyphs", () => ({
    renderIconImage: vi.fn(async () => "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
}));

/** A map that hands out pointer events, which is all the ghost asks of one. */
function fakeMap() {
    const listeners = new Map<string, Set<(e?: unknown) => void>>();
    return {
        on(event: string, fn: (e?: unknown) => void) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(fn);
        },
        off(event: string, fn: (e?: unknown) => void) {
            listeners.get(event)?.delete(fn);
        },
        listenerCount(event: string) {
            return listeners.get(event)?.size ?? 0;
        },
        /** The pointer moving across the map, as MapLibre reports it. */
        moveTo(x: number, y: number) {
            for (const fn of listeners.get("mousemove") ?? []) fn({ point: { x, y } });
        },
        /** The pointer leaving the canvas — for the edge of the map or anything standing over it. */
        leave() {
            for (const fn of listeners.get("mouseout") ?? []) fn();
        }
    };
}

describe("GhostPin", () => {
    let container: HTMLElement | undefined;
    /** What the pin was last drawn from, captured on its way to becoming an image. */
    let lastSvgBlob: Blob | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        lastSvgBlob = undefined;

        // The pin is drawn by handing an SVG blob to an <img> and waiting for it to load, which no
        // DOM stand-in actually does — but here the image also has to be a real element, since the
        // ghost puts it in the document.
        vi.stubGlobal("Image", function ImageStub() {
            const image = document.createElement("img");
            Object.defineProperty(image, "src", {
                set: () => { setTimeout(() => image.onload?.(new Event("load"))); }
            });
            return image;
        });
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: (blob: Blob) => {
                lastSvgBlob = blob;
                return "blob:pin";
            },
            revokeObjectURL: () => {}
        });
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.unstubAllGlobals();
    });

    function mount(map: ReturnType<typeof fakeMap>, note?: FNote, parentNote?: FNote) {
        return act(async () => {
            render(
                <ParentMap.Provider value={map as never}>
                    <GhostPin
                        note={note}
                        parentNote={parentNote ?? buildNote({ title: "The map" })} />
                </ParentMap.Provider>,
                container as HTMLElement
            );
        });
    }

    /** Drains the awaits in drawMarkerImage (icon render → svg decode). */
    async function settle() {
        for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
    }

    it("waits for the pointer, rides under it, and goes when it leaves the map", async () => {
        const map = fakeMap();
        await mount(map);

        // Hidden at first: the map does not say where the pointer is until it moves.
        const ghost = container?.querySelector<HTMLElement>(".geo-ghost-pin");
        expect(ghost).toBeTruthy();
        expect(ghost?.classList.contains("visible")).toBe(false);

        map.moveTo(40, 60);
        expect(ghost?.classList.contains("visible")).toBe(true);
        expect(ghost?.style.transform).toBe("translate(40px, 60px)");

        map.moveTo(41, 61);
        expect(ghost?.style.transform).toBe("translate(41px, 61px)");

        map.leave();
        expect(ghost?.classList.contains("visible")).toBe(false);
    });

    it("wears the pin a new note will be given", async () => {
        const { renderIconImage } = await import("../../../services/icon_glyphs");
        const map = fakeMap();

        await mount(map);
        await act(async () => { await settle(); });

        // The image the symbol layer would stamp, in the colour and icon a created note gets.
        expect(container?.querySelector(".geo-ghost-pin img")).toBeTruthy();
        expect(renderIconImage).toHaveBeenCalledWith("bx bx-pin", expect.anything());
        expect(await lastSvgBlob?.text()).toContain(`fill="${DEFAULT_MARKER_COLOR}"`);
    });

    it("wears what the map would give a new note, ahead of the pin", async () => {
        const { renderIconImage } = await import("../../../services/icon_glyphs");
        // Copied onto every note created under the map (see copyChildAttributes in core), so the
        // marker the click drops is what the ghost has to offer.
        const parent = buildNote({
            title: "The map", "#child:iconClass": "bx bx-store", "#child:color": "green" });
        const map = fakeMap();

        await mount(map, undefined, parent);
        await act(async () => { await settle(); });

        expect(renderIconImage).toHaveBeenCalledWith("bx bx-store", expect.anything());
        expect(await lastSvgBlob?.text()).toContain(`fill="green"`);
    });

    it("wears the moved note's own colour and icon", async () => {
        const { renderIconImage } = await import("../../../services/icon_glyphs");
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2", "#color": "red", "#iconClass": "bx bx-star" });
        const map = fakeMap();

        await mount(map, note);
        await act(async () => { await settle(); });

        expect(container?.querySelector(".geo-ghost-pin img")).toBeTruthy();
        // The class comes through whole, as getIcon gives it — family and all (see drawMarkerImage).
        expect(renderIconImage).toHaveBeenCalledWith("tn-icon bx bx-star", expect.anything());
        expect(await lastSvgBlob?.text()).toContain(`fill="red"`);
    });

    it("lets go of the map when it is disarmed", async () => {
        const map = fakeMap();
        await mount(map);
        expect(map.listenerCount("mousemove")).toBe(1);
        expect(map.listenerCount("mouseout")).toBe(1);

        await act(async () => {
            render(null, container as HTMLElement);
        });

        expect(map.listenerCount("mousemove")).toBe(0);
        expect(map.listenerCount("mouseout")).toBe(0);
    });
});
