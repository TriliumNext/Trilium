/**
 * The marker preview, which is the app's own note tooltip drawn into a MapLibre popup.
 *
 * The notes are drawn into one symbol layer rather than an element apiece, so none of the tooltip
 * service's element-hovering applies: what has to be got right here is reading the note behind the
 * pixel under the pointer, and keeping the preview up long enough to be reached and read.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { ParentMap } from "./map";
import { MARKER_HEIGHT, MARKER_LAYER } from "./Markers";
import Tooltips from "./Tooltips";

/** What a note's preview renders to, standing in for the shared tooltip renderer. */
const renderTooltip = vi.fn(async (note: FNote | null) =>
    note ? `<h5 class="note-tooltip-title">${note.title}</h5><p>Body of ${note.title}</p>` : undefined);

vi.mock("../../../services/note_tooltip", () => ({ renderTooltip: (note: FNote | null) => renderTooltip(note) }));

/**
 * The popup MapLibre would draw, recording what it was shown and whether it is up. Hoisted because
 * the module mock below it is, and the mock is what hands the class to the component — and the
 * preview's pretended size lives with it, because the hoisted block cannot reach anything outside
 * itself.
 */
const { FakePopup, PREVIEW_WIDTH } = vi.hoisted(() => {
    /** A preview about the size the app renders one at, for the placement arithmetic below. */
    const PREVIEW_WIDTH = 500;
    const PREVIEW_HEIGHT = 120;

    class FakePopup {
        static open: FakePopup[] = [];

        html = "";
        lngLat: unknown;
        element: HTMLElement | null = null;
        options: { anchor?: string; offset?: [ number, number ] };

        constructor(options: object) {
            this.options = options;
        }

        setLngLat(lngLat: unknown) { this.lngLat = lngLat; return this; }

        setHTML(html: string) {
            this.html = html;
            if (this.element) this.element.innerHTML = html;
            return this;
        }

        setOffset(offset: [ number, number ]) {
            this.options.offset = offset;
            return this;
        }

        addTo() {
            // Rebuilt on every opening, as MapLibre rebuilds it — which is why the listeners that
            // keep the preview open have to be bound per opening.
            this.element = document.createElement("div");
            this.element.innerHTML = this.html;
            // The size the placement is measured against, which happy-dom's layoutless elements
            // would otherwise report as nothing at all.
            Object.defineProperty(this.element, "offsetWidth", { value: PREVIEW_WIDTH, configurable: true });
            Object.defineProperty(this.element, "offsetHeight", { value: PREVIEW_HEIGHT, configurable: true });
            document.body.appendChild(this.element);
            FakePopup.open.push(this);
            return this;
        }

        getElement() { return this.element; }

        remove() {
            this.element?.remove();
            this.element = null;
            FakePopup.open = FakePopup.open.filter((popup) => popup !== this);
            return this;
        }
    }

    return { FakePopup, PREVIEW_WIDTH, PREVIEW_HEIGHT };
});

vi.mock("maplibre-gl", () => ({ Popup: FakePopup }));

/**
 * A map that delegates events — per layer or map-wide — and answers the questions the placement
 * asks: where a coordinate projects to, and how big the map is. Both are settable per test, since
 * the placement is chosen from exactly those two answers and the preview's size.
 */
function fakeMap({ width = 800, height = 800, point = { x: 400, y: 300 } } = {}) {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    const key = (event: string, layer: string) => `${event}:${layer}`;
    // The two shapes MapLibre's `on`/`off` take: with a layer between event and listener, and without.
    const unpack = (layerOrFn: string | ((e: unknown) => void), fn?: (e: unknown) => void) =>
        typeof layerOrFn === "function" ? { layer: "", fn: layerOrFn } : { layer: layerOrFn, fn };

    return {
        on(event: string, layerOrFn: string | ((e: unknown) => void), maybeFn?: (e: unknown) => void) {
            const { layer, fn } = unpack(layerOrFn, maybeFn);
            if (!fn) return;
            const listenersForKey = listeners.get(key(event, layer)) ?? new Set();
            listeners.set(key(event, layer), listenersForKey.add(fn));
        },
        off(event: string, layerOrFn: string | ((e: unknown) => void), maybeFn?: (e: unknown) => void) {
            const { layer, fn } = unpack(layerOrFn, maybeFn);
            if (!fn) return;
            listeners.get(key(event, layer))?.delete(fn);
        },
        /** A click landing anywhere on the map — a marker, a track or bare ground alike. */
        click() {
            for (const fn of listeners.get(key("click", "")) ?? []) fn({});
        },
        project: () => ({ ...point }),
        getContainer: () => ({ clientWidth: width, clientHeight: height }),
        /** The pointer coming to rest on a marker, as MapLibre reports it. */
        hover(note: FNote) {
            const feature = {
                geometry: { type: "Point", coordinates: [ 1, 2 ] },
                properties: { id: note.noteId, name: note.title }
            };
            for (const fn of listeners.get(key("mousemove", MARKER_LAYER)) ?? []) fn({ features: [ feature ] });
        },
        /** The pointer leaving every marker. */
        leave() {
            for (const fn of listeners.get(key("mouseleave", MARKER_LAYER)) ?? []) fn({});
        },
        get listenerCount() {
            return [ ...listeners.values() ].reduce((total, set) => total + set.size, 0);
        }
    };
}

/** Drains the promise chain in `show` (note read → preview rendered) without moving the clock. */
async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    });
}

/** Moves the clock on and lets whatever that started finish. */
async function advance(ms: number) {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await flush();
}

/** The preview currently on screen, or `undefined` where there is none. */
function shownPreview() {
    return FakePopup.open[0]?.element?.textContent ?? undefined;
}

describe("Tooltips", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        FakePopup.open = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.useRealTimers();
        renderTooltip.mockClear();
    });

    /** Mounts — or, called again, re-renders — the component. `selectedNoteId` is the marker the
     *  detail pane stands for and `paneMaximized` whether that pane covers the map, as the map view
     *  passes the two of them down. */
    function mount(map: ReturnType<typeof fakeMap>, selectedNoteId: string | null = null, paneMaximized = false) {
        return act(async () => {
            render(
                <ParentMap.Provider value={map as never}>
                    <Tooltips selectedNoteId={selectedNoteId} paneMaximized={paneMaximized} />
                </ParentMap.Provider>,
                container as HTMLElement
            );
        });
    }

    it("shows the note's preview once the pointer has rested on its marker", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        // A marker merely passed over is not a note worth reading.
        await advance(100);
        expect(shownPreview()).toBeUndefined();
        expect(renderTooltip).not.toHaveBeenCalled();

        // A marker rested on is read at once — but shown only once the full wait is up, so the
        // round trip hides inside the wait instead of stretching it.
        await advance(200);
        expect(renderTooltip).toHaveBeenCalled();
        expect(shownPreview()).toBeUndefined();

        await advance(200);
        expect(shownPreview()).toContain("Body of Somewhere");
        // Drawn in the shape the app's tooltip styles are written against.
        expect(FakePopup.open[0]?.html).toContain(`class="tooltip note-tooltip show"`);
        expect(FakePopup.open[0]?.html).toContain(`class="note-tooltip-content"`);
        // `.tooltip-inner` is `pre-line`, so a line break laid out between the tags is a blank line
        // drawn in the preview — one above it and one below, 43px of nothing. The rendered note
        // brings no newline of its own here, so the wrapper is where any of them would come from.
        expect(FakePopup.open[0]?.html).not.toContain("\n");
    });

    /**
     * The theme tints a preview through `.note-tooltip.with-hue`, off the hue carried by the note's
     * own colour class — so a preview built by hand has to wear that class or it is drawn plain,
     * however the note is coloured. The previews the tooltip service puts up get it for free (see
     * the template in note_tooltip.ts), which is what made this the odd one out.
     */
    it("tints the preview with the note's colour", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2", "#color": "#ff0000" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(FakePopup.open[0]?.html).toContain(note.getColorClass());
        expect(note.getColorClass()).toContain("with-hue");
    });

    it("draws an uncoloured note's preview plain", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        // No trailing space where the colour class would have gone.
        expect(FakePopup.open[0]?.html).toContain(`class="tooltip note-tooltip show"`);
    });

    /**
     * `mouseenter` fires on entering the layer, not on entering a marker, so a pointer dragged from
     * one pin straight onto the next never leaves it — the first note's preview used to stay up over
     * the second, which is why the move is what is watched.
     */
    it("swaps the preview when the pointer moves straight from one marker to another", async () => {
        const first = buildNote({ title: "Here", "#geolocation": "1,2" });
        const second = buildNote({ title: "There", "#geolocation": "3,4" });
        const map = fakeMap();
        await mount(map);

        map.hover(first);
        await advance(500);
        expect(shownPreview()).toContain("Body of Here");

        // The pointer crosses onto the second marker without ever leaving the layer.
        map.hover(second);
        // The first note's preview goes at once rather than standing there wrong for as long as the
        // second takes to read.
        await flush();
        expect(shownPreview()).toBeUndefined();

        await advance(500);
        expect(shownPreview()).toContain("Body of There");
        expect(FakePopup.open).toHaveLength(1);
    });

    it("stays up while the pointer is on it, and closes once the pointer leaves it", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        const element = FakePopup.open[0]?.element;

        // The preview sits a little away from the pin, so reaching it means leaving the marker.
        map.leave();
        await act(async () => { element?.dispatchEvent(new Event("mouseenter")); });
        await advance(2000);
        expect(shownPreview()).toContain("Body of Somewhere");

        await act(async () => { element?.dispatchEvent(new Event("mouseleave")); });
        await advance(500);
        expect(shownPreview()).toBeUndefined();
    });

    /*
     * Placement is taken over from MapLibre (see placePreview in Tooltips): left to itself it
     * swings the preview beside a pin standing near the map's edge, vertically centred on it —
     * lying across the pin's title and reading as attached to nothing. The preview stays above
     * the pin instead and slides sideways; only a pin too near the top has it open downwards.
     */

    it("stands above the pin, centred on it, where there is room", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);

        const popup = FakePopup.open[0];
        expect(popup?.options.anchor).toBe("bottom");
        // Straight up, past the whole pin standing on its coordinate.
        expect(popup?.options.offset).toEqual([ 0, -(MARKER_HEIGHT + 8) ]);
    });

    it("slides sideways at the map's edge instead of swinging beside the pin", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        // A pin forty pixels from the left edge, where MapLibre's own placement would go beside it.
        const map = fakeMap({ point: { x: 40, y: 300 } });
        await mount(map);

        map.hover(note);
        await advance(500);

        const popup = FakePopup.open[0];
        expect(popup?.options.anchor).toBe("bottom");
        // Slid right exactly far enough for the preview's left edge to stand its air off the map's:
        // half its width past the pin, less the forty pixels the pin already stands in.
        expect(popup?.options.offset).toEqual([ 8 + PREVIEW_WIDTH / 2 - 40, -(MARKER_HEIGHT + 8) ]);
    });

    it("opens below a pin standing too near the top, past its title", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ point: { x: 400, y: 60 } });
        await mount(map);

        map.hover(note);
        await advance(500);

        const popup = FakePopup.open[0];
        expect(popup?.options.anchor).toBe("top");
        // Below the point, and below the title hanging under it too.
        expect(popup?.options.offset).toEqual([ 0, 18 + 8 ]);
    });

    it("slides out from under the detail pane while one is up", async () => {
        const selected = buildNote({ title: "Open in the pane", "#geolocation": "5,6" });
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        // A pin standing in the map's trailing 400 pixels, which the pane covers while it is up
        // (see PANE_REACH); a preview left there would be shown to nobody.
        const map = fakeMap({ width: 1200, point: { x: 1000, y: 300 } });
        await mount(map, selected.noteId);

        map.hover(note);
        await advance(500);

        const popup = FakePopup.open[0];
        expect(popup?.options.anchor).toBe("bottom");
        // Slid left until its right edge stands its air short of the pane, not merely of the map.
        expect(popup?.options.offset).toEqual([ (1200 - 8 - 400) - PREVIEW_WIDTH / 2 - 1000, -(MARKER_HEIGHT + 8) ]);
    });

    /**
     * A pane grown over the map leaves nowhere for a preview to be slid to, and the markers it would
     * preview are behind it. Nothing is shown at all rather than shown somewhere out of sight — and
     * a preview already up is taken down as the pane grows, rather than left standing over it.
     */
    it("shows nothing at all while the detail pane covers the map", async () => {
        const selected = buildNote({ title: "Open in the pane", "#geolocation": "5,6" });
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ width: 1200, point: { x: 1000, y: 300 } });
        await mount(map, selected.noteId);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        // The pane grows over the map with the preview still up.
        await mount(map, selected.noteId, true);
        expect(shownPreview()).toBeUndefined();

        // And nothing the pointer does while it is grown brings one back.
        renderTooltip.mockClear();
        map.hover(note);
        await advance(500);
        expect(shownPreview()).toBeUndefined();
        expect(renderTooltip).not.toHaveBeenCalled();
    });

    it("centres on the pin where the map is too narrow to slide within", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ width: 400, point: { x: 200, y: 300 } });
        await mount(map);

        map.hover(note);
        await advance(500);

        // Overflowing both edges evenly is the best a map narrower than the preview can do.
        expect(FakePopup.open[0]?.options.offset).toEqual([ 0, -(MARKER_HEIGHT + 8) ]);
    });

    /**
     * A click is always something being done — a marker opened into the pane, a place chosen — and
     * the preview must not stand over the result. A preview whose marker was clicked used to stand
     * exactly where the pane then opened, and one still on its way landed on top of it.
     */
    it("dismisses the preview, up or still on its way, when the map is clicked", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        await act(async () => { map.click(); });
        expect(shownPreview()).toBeUndefined();

        // A preview already being read when the click lands never arrives at all.
        map.hover(note);
        await advance(300);
        expect(renderTooltip).toHaveBeenCalledTimes(2);
        await act(async () => { map.click(); });
        await advance(1000);
        expect(shownPreview()).toBeUndefined();
    });

    it("never previews the marker the detail pane already stands for", async () => {
        const selected = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const other = buildNote({ title: "Elsewhere", "#geolocation": "3,4" });
        const map = fakeMap();
        await mount(map, selected.noteId);

        // The pane beside it already says everything the preview would — the note is not even read.
        map.hover(selected);
        await advance(1000);
        expect(shownPreview()).toBeUndefined();
        expect(renderTooltip).not.toHaveBeenCalled();

        // Every other marker keeps its preview while the pane is up.
        map.hover(other);
        await advance(500);
        expect(shownPreview()).toContain("Body of Elsewhere");
    });

    /**
     * Not every selection is made by a click on the map: a note just created is opened into the
     * pane by the code that created it. The selection changing is a dismissal in itself.
     */
    it("takes the preview down when its marker is selected without a click", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        await mount(map, note.noteId);
        expect(shownPreview()).toBeUndefined();
    });

    it("closes the preview when the pointer leaves the marker without reaching it", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        map.leave();
        await advance(500);
        expect(shownPreview()).toBeUndefined();
    });

    /** Reading a note is asynchronous, so a marker skimmed past is usually left before it lands. */
    it("drops a preview whose marker was left before it finished rendering", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        let release: (() => void) | undefined;
        renderTooltip.mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => { release = resolve; });
            return "<p>Body of Somewhere</p>";
        });

        map.hover(note);
        await advance(500);
        expect(renderTooltip).toHaveBeenCalled();

        map.leave();
        await act(async () => { release?.(); });
        await flush();

        expect(shownPreview()).toBeUndefined();
    });

    it("takes its listeners and any open preview with it when it goes away", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        await act(async () => { render(null, container as HTMLElement); });

        expect(FakePopup.open).toHaveLength(0);
        expect(map.listenerCount).toBe(0);
    });
});
