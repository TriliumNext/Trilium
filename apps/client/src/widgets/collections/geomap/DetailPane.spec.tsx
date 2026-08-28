import $ from "jquery";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import linkContextMenu from "../../../menus/link_context_menu";
import froca from "../../../services/froca";
import link from "../../../services/link";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { useLegacyImperativeHandlers, useNoteContext, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { OTHER_WAYS_TO_OPEN } from "../../EmbeddedNotePane";
import DetailPane, { PaneSelection } from "./DetailPane";
import { GPX_MIME, trackSourceId } from "./GpxTrack";
import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

/** Navigating the tab the map is in, which is a module function rather than a command. */
const openInCurrentNoteContext = vi.fn();
vi.mock("../../../components/note_context", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openInCurrentNoteContext: (...args: unknown[]) => openInCurrentNoteContext(...args)
}));

/**
 * The note's own editor, which has a spec of its own and drags the whole app in with it. What
 * matters here is that the pane mounts it under a context it can read, and tells it to save before
 * going away — so the stand-in listens for exactly what a real editor listens for.
 */
const editorAskedToSave = vi.fn();
vi.mock("../../NoteDetail", () => ({
    default: () => {
        const { note, viewScope } = useNoteContext();
        useTriliumEvent("beforeNoteContextRemove", editorAskedToSave);
        // The text editor puts what it offers the app onto its parent component, and reaches it again
        // from the DOM (see the host test below). Registered here as the real editor registers it.
        useLegacyImperativeHandlers({ loadReferenceLinkTitle: async () => {} });
        return (
            <div
                className="note-detail-stub"
                data-floating-toolbar={String(!!viewScope?.floatingToolbar)}
            >
                {note?.title}
            </div>
        );
    }
}));

/**
 * Whether the reader agreed to the note being taken off the map, and whether it should go from the
 * tree with it. What the dialog itself makes of that is its own spec's business (see confirm.spec).
 */
const confirmDelete = vi.fn();
vi.mock("../../../services/dialog", async (importOriginal) => ({
    default: {
        ...((await importOriginal<{ default: object }>()).default),
        confirmDeleteNoteBoxWithNote: (...args: unknown[]) => confirmDelete(...args)
    }
}));

/** What the pane puts on the clipboard, the writing of it being the browser's business. */
const copied = vi.fn();
vi.mock("../../../services/clipboard_ext", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    copyTextWithToast: (...args: unknown[]) => copied(...args)
}));

// A promoted text field suggests what other notes hold under its name, asked for through the Algolia
// jQuery plugin and answered by the server. Neither is loaded here.
type PluggedIn = { autocomplete(...args: unknown[]): PluggedIn };
($.fn as unknown as PluggedIn).autocomplete = function (this: PluggedIn) { return this; };
server.get = (async () => []) as unknown as typeof server.get;

/** What a marker click hands the handler, and what the pane reads the note out of. */
type Listener = (e?: unknown) => void;

/** How wide the map is in these tests, which is room enough for the pane and then some. */
const MAP_WIDTH = 1200;

/**
 * A map that records what the pane asks of it, standing in for MapLibre. What it has to answer is
 * the hit test: the pane is bound to the map at large, not to the marker layer (see DetailPane).
 */
function fakeMap({ width = MAP_WIDTH, features = [] as unknown[] } = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const eased: unknown[] = [];
    const fitted: unknown[] = [];
    const sources = new Map<string, unknown>();
    let under: unknown[] = features;

    return {
        /** Every camera move the pane has asked for, which is how it holds a marker clear of itself. */
        get eased() { return eased; },
        /** Every fit the pane has asked for, which is how it brings a whole track into view. */
        get fitted() { return fitted; },
        /** Registers a GeoJSON source as a track's layers would have added it, for the pane to read back. */
        addSource(id: string, data: unknown) { sources.set(id, { getData: async () => data }); },
        getSource(id: string) { return sources.get(id); },
        /** A source announcing itself, as MapLibre does — repeatedly, for as long as it lives. */
        fireSourceData(sourceId: string) {
            for (const fn of listeners.get("sourcedata") ?? []) fn({ sourceId });
        },
        /** What the next click will land on: a marker's feature, or nothing at all. */
        setUnderPointer(hit: unknown[]) { under = hit; },
        /** A click on the map, wherever `setUnderPointer` says it landed. */
        click() {
            for (const fn of listeners.get("click") ?? []) fn({ point: { x: 0, y: 0 } });
        },
        on(event: string, fnOrLayer: unknown, fn?: () => void) {
            const key = fn ? `${event}:${fnOrLayer}` : event;
            const handler = (fn ?? fnOrLayer) as Listener;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add(handler);
        },
        off(event: string, fnOrLayer: unknown, fn?: () => void) {
            listeners.get(fn ? `${event}:${fnOrLayer}` : event)?.delete((fn ?? fnOrLayer) as Listener);
        },
        queryRenderedFeatures(_point: unknown, { layers }: { layers: string[] }) {
            return layers.includes(MARKER_LAYER) ? under : [];
        },
        easeTo(options: unknown) { eased.push(options); },
        fitBounds(bounds: unknown, options: unknown) { fitted.push({ bounds, options }); },
        getContainer: () => ({ clientWidth: width, clientHeight: 800 }),
        // Asked for by `trackHitLayers`, which reads the current GPX hit layers off the style.
        getLayersOrder: () => [] as string[]
    };
}

/** A marker of the layer, as MapLibre reports one that was hit. */
function markerFeature(note: FNote, coordinates: [number, number] = [ 2, 1 ]) {
    return { geometry: { type: "Point", coordinates }, properties: { id: note.noteId } };
}

/** A GPX track's hit line, as MapLibre reports one — the note carried in the feature (see GpxTrack),
 *  and which of the file's journeys the line is, where the source says. */
function trackFeature(note: FNote, track?: number) {
    return { geometry: { type: "MultiLineString", coordinates: [] }, properties: { id: note.noteId, ...(track !== undefined ? { track } : {}) } };
}

describe("DetailPane", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);

        // `tabManager` is only built when the app starts, and the pane asks it where the reader is
        // hoisted.
        (appContext as unknown as { tabManager: unknown }).tabManager = {
            getActiveContext: () => undefined,
            getActiveContextNotePath: () => undefined,
            openContextWithNote: async () => undefined
        };
        editorAskedToSave.mockClear();
        onRelocate.mockClear();
        // Nothing is taken off the map unless a test says the reader agreed to it.
        confirmDelete.mockReset();
        confirmDelete.mockResolvedValue(false);
    });

    afterEach(() => {
        (appContext as unknown as { tabManager: unknown }).tabManager = undefined;
        mapComponent = undefined;

        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Stands in for the map's own component, which is what the pane hangs under. */
    let mapComponent: Component | undefined;

    /**
     * Stands in for the map view, which is what owns the selection now (see PaneSelection): the pane
     * asks for changes through `onSelect` and is handed the result back, exactly as GeoView does it.
     * `initialSelection` is the map view opening the pane by hand — on a note it has just created.
     */
    function Harness({ notes, placing, isReadOnly, initialSelection }: {
        notes: FNote[]; placing: boolean; isReadOnly: boolean; initialSelection?: PaneSelection;
    }) {
        const [ selection, setSelection ] = useState<PaneSelection | null>(initialSelection ?? null);
        // Held here for the same reason, the map view owning whether the pane stands over it.
        const [ maximized, setMaximized ] = useState(false);
        return <DetailPane
            notes={notes}
            parentNote={froca.notes["root"] ?? buildNote({ id: "root", title: "root" })}
            placing={placing}
            isReadOnly={isReadOnly}
            selection={selection}
            onSelect={setSelection}
            onRelocate={onRelocate}
            maximized={maximized}
            onMaximizedChange={setMaximized}
        />;
    }

    /** Renders into the same container, so calling it again is a re-render with fresh props. */
    function mount(notes: FNote[], map: ReturnType<typeof fakeMap>, placing = false, isReadOnly = false, initialSelection?: PaneSelection) {
        mapComponent ??= new Component();
        return act(async () => {
            render(
                <ParentComponent.Provider value={mapComponent as Component}>
                    <ParentMap.Provider value={map as never}>
                        <Harness notes={notes} placing={placing} isReadOnly={isReadOnly} initialSelection={initialSelection} />
                    </ParentMap.Provider>
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
    }

    /** Arming the map for the next click to be where the marker goes, which the map owns (index.tsx). */
    const onRelocate = vi.fn();

    /** Lets the pane's note context resolve its path and announce the note it landed on. */
    async function settle() {
        await act(async () => {
            for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
        });
    }

    function pane() {
        return container?.querySelector(".geo-detail-pane") ?? null;
    }

    /**
     * The title row reads the note out of a note context rather than taking one as a prop, so what
     * this asserts is that the pane points that context at the marker clicked.
     */
    it("stands for the marker that was clicked, naming its note", async () => {
        // Hung under the root so there is a path to point the note context at.
        buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
        const note = froca.notes["somewhere"];
        const map = fakeMap();
        await mount([ note ], map);

        // Nothing is selected to begin with, so there is no pane over the map at all.
        expect(pane()).toBeNull();

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        await settle();

        // A field and a picker, not a heading drawn for the occasion.
        expect(pane()?.querySelector<HTMLInputElement>(".title-row input")?.value).toBe("Somewhere");
        expect(pane()?.querySelector<HTMLButtonElement>(".title-row .note-icon")?.disabled).toBe(false);
    });

    /**
     * A GPX track opens the pane the way a marker does. Its note is on the map by being drawn
     * across it — there is no location label for the pane to read, so what this pins down is that
     * the pane neither refuses the note nor closes itself over the label it does not find.
     */
    it("stands for a GPX track that was clicked, which has no location of its own", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikenote", title: "A hike", mime: GPX_MIME } ] });
        const note = froca.notes["hikenote"];
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ trackFeature(note) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.querySelector<HTMLInputElement>(".title-row input")?.value).toBe("A hike");
        // No place to write out, there being no location label to read — and nothing to move the
        // camera for either, this map not carrying the track's source to fit the viewport around.
        expect(map.eased).toEqual([]);
        expect(map.fitted).toEqual([]);
        expect(pane()?.querySelector(".geo-detail-pane-location")).toBeNull();
    });

    /**
     * A track is not a point but a shape, so opening one does not centre a coordinate: the camera
     * is solved for the track's corners — pan and zoom both — held clear of the pane on its side
     * and given a rim of air on the others. The corners are read back off the track's own source,
     * so the pane never parses the file itself.
     */
    it("fits the whole track into what the pane leaves uncovered", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikefit", title: "A hike", mime: GPX_MIME } ] });
        const note = froca.notes["hikefit"];
        const map = fakeMap();
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [ [ [ 24.13, 45.79 ], [ 24.16, 45.96 ] ] ] } },
                { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [ 24.08, 45.89 ] } }
            ]
        });
        await mount([ note ], map);

        map.setUnderPointer([ trackFeature(note) ]);
        await act(async () => map.click());
        await settle();

        expect(map.eased).toEqual([]);
        expect(map.fitted).toEqual([ {
            // The westmost point is the mark's, not the line's: everything the source holds counts.
            bounds: [ [ 24.08, 45.79 ], [ 24.16, 45.96 ] ],
            options: { padding: { top: 60, bottom: 60, left: 60, right: 460 }, maxZoom: 16 }
        } ]);
    });

    /**
     * A track selected the moment it was brought onto the map (see `addGpxTrack` in index.tsx) has
     * no line yet — the note's content is still being fetched, so the source the bounds are read
     * from is not there to be asked. The fit waits for the source to announce itself rather than
     * giving up, and takes only the first announcement: they repeat for as long as the source
     * lives, and a map re-fitted under the reader on each would never stay where it was put.
     */
    it("fits a track whose line arrives after it was selected, and only once", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikelate", title: "A hike", mime: GPX_MIME } ] });
        const note = froca.notes["hikelate"];
        const map = fakeMap();

        // Selected before any source exists, as the map view selects a track it has just imported.
        await mount([ note ], map, false, false, { noteId: note.noteId });
        await settle();
        expect(map.fitted).toEqual([]);

        // The track's layers go up once the content has arrived (see GpxTrack), source first.
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [ { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [ [ [ 24.13, 45.79 ], [ 24.16, 45.96 ] ] ] } } ]
        });
        await act(async () => { map.fireSourceData(trackSourceId(note.noteId)); });

        expect(map.fitted).toEqual([ {
            bounds: [ [ 24.13, 45.79 ], [ 24.16, 45.96 ] ],
            options: { padding: { top: 60, bottom: 60, left: 60, right: 460 }, maxZoom: 16 }
        } ]);

        // Announced again — a repaint, a tile settling — the map stays where it was put.
        await act(async () => { map.fireSourceData(trackSourceId(note.noteId)); });
        expect(map.fitted).toHaveLength(1);
    });

    /**
     * A file may hold several journeys, and the clicked line says which it is (the `track` index,
     * see GpxTrack): only that one is framed. The other journey's ground — and a waypoint hung off
     * in a third place — is exactly what focusing one track is meant to leave out of the frame.
     */
    it("fits only the journey that was clicked, of a file holding several", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hiketwo", title: "Two rides", mime: GPX_MIME } ] });
        const note = froca.notes["hiketwo"];
        const map = fakeMap();
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { id: note.noteId, track: 0 }, geometry: { type: "MultiLineString", coordinates: [ [ [ 24.13, 45.79 ], [ 24.16, 45.96 ] ] ] } },
                { type: "Feature", properties: { id: note.noteId, track: 1 }, geometry: { type: "MultiLineString", coordinates: [ [ [ 25.5, 46.5 ], [ 25.7, 46.7 ] ] ] } },
                { type: "Feature", properties: { id: note.noteId }, geometry: { type: "Point", coordinates: [ 20, 40 ] } }
            ]
        });
        await mount([ note ], map);

        map.setUnderPointer([ trackFeature(note, 1) ]);
        await act(async () => map.click());
        await settle();

        expect(map.fitted).toEqual([ {
            bounds: [ [ 25.5, 46.5 ], [ 25.7, 46.7 ] ],
            options: { padding: { top: 60, bottom: 60, left: 60, right: 460 }, maxZoom: 16 }
        } ]);
    });

    /** The two frames are the same width for a track that crosses no seam, give or take what
     *  floating point does to them, and the raw one is the one that reads west of Greenwich. */
    it("frames a track in the western hemisphere where it stands", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikewest", title: "A ride", mime: GPX_MIME } ] });
        const note = froca.notes["hikewest"];
        const map = fakeMap();
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [ [ [ -80.3, 25.7 ], [ -80.1, 25.9 ] ] ] } }
            ]
        });
        await mount([ note ], map);

        map.setUnderPointer([ trackFeature(note) ]);
        await act(async () => map.click());
        await settle();

        expect(map.fitted).toHaveLength(1);
        const { bounds } = map.fitted[0] as { bounds: [ [ number, number ], [ number, number ] ] };
        expect(bounds).toEqual([ [ -80.3, 25.7 ], [ -80.1, 25.9 ] ]);
    });

    /**
     * A track that crosses the antimeridian holds points on either side of the ±180° seam — 179.9°
     * and -179.9° are a stroll apart on the ground. Read as raw minimum and maximum, they stand a
     * whole world apart instead, and the fit flies out to frame the globe rather than the crossing.
     */
    it("frames a track that crosses the antimeridian, not the world", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikeseam", title: "Across the seam", mime: GPX_MIME } ] });
        const note = froca.notes["hikeseam"];
        const map = fakeMap();
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [ [ [ 179.9, 52.0 ], [ -179.9, 52.2 ] ] ] } }
            ]
        });
        await mount([ note ], map);

        map.setUnderPointer([ trackFeature(note) ]);
        await act(async () => map.click());
        await settle();

        expect(map.fitted).toHaveLength(1);
        const { bounds } = map.fitted[0] as { bounds: [ [ number, number ], [ number, number ] ] };
        const [ [ west, south ], [ east, north ] ] = bounds;
        expect([ south, north ]).toEqual([ 52.0, 52.2 ]);
        // The box is 0.2° of longitude around the seam, however the crossing is written — an east
        // unwrapped past 180°, or a west standing east of its east, either of which fitBounds
        // takes. Measured around the circle so the writing is not prejudged; only a box that goes
        // the long way round fails it.
        expect(((east - west) % 360 + 360) % 360).toBeLessThan(1);
    });

    /**
     * A clicked flag is a place the reader chose, not a request to re-frame the file: it is stood
     * clear of the pane at the zoom they were reading at, exactly as a note marker is — flying out
     * to the whole track would lose the very flag they clicked.
     */
    it("pans to a clicked flag without re-framing the whole file", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "hikeflag", title: "A hike", mime: GPX_MIME } ] });
        const note = froca.notes["hikeflag"];
        const map = fakeMap();
        map.addSource(trackSourceId(note.noteId), {
            type: "FeatureCollection",
            features: [ { type: "Feature", properties: { id: note.noteId }, geometry: { type: "MultiLineString", coordinates: [ [ [ 24.13, 45.79 ], [ 24.16, 45.96 ] ] ] } } ]
        });
        await mount([ note ], map);

        // The click lands on one of the track's marks — a Point feature, the same shape a note's
        // pin answers a hit with.
        map.setUnderPointer([ markerFeature(note, [ 24.16, 45.96 ]) ]);
        await act(async () => map.click());
        await settle();

        expect(map.fitted).toEqual([]);
        expect(map.eased).toEqual([ { center: [ 24.16, 45.96 ], offset: [ -200, 0 ] } ]);
    });

    /**
     * Regression test for a click on a marker whiting out the map and losing its WebGL context.
     *
     * An unbound `useNoteContext` rebinds to whatever context a note switch names. Announced to the
     * map's component, the collection view around the pane rebound to the marker's note and tore the
     * map down mid-click. The pane keeps its own component so its switches reach only its contents.
     */
    it("keeps its own note switches from reaching the map's component", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
        const note = froca.notes["somewhere"];
        const map = fakeMap();
        await mount([ note ], map);

        const heardByTheMap = vi.fn();
        for (const event of [ "noteSwitched", "noteSwitchedAndActivated", "beforeNoteSwitch" ] as const) {
            mapComponent?.registerHandler(event, heardByTheMap);
        }

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        await settle();

        // The pane heard its own switch — it is showing the note — and nothing else did.
        expect(pane()?.querySelector<HTMLInputElement>(".title-row input")?.value).toBe("Somewhere");
        expect(heardByTheMap).not.toHaveBeenCalled();
    });

    /**
     * The icon in the title row is dressed by the hue of whatever carries the colour class around it
     * (see theme-next-{light,dark}.css). The pane stands inside the map's note split, which carries
     * the map note's colour, so without one of its own the marker wore the map's hue.
     */
    it("carries the marker's own colour, and none where it has no colour", async () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "red", title: "Red", "#geolocation": "1,2", "#color": "#ff0000" },
            { id: "plain", title: "Plain", "#geolocation": "3,4" }
        ] });
        const red = froca.notes["red"];
        const plain = froca.notes["plain"];
        const map = fakeMap();
        await mount([ red, plain ], map);

        map.setUnderPointer([ markerFeature(red) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.classList.contains("use-note-color")).toBe(true);
        expect(pane()?.classList.contains("with-hue")).toBe(true);
        expect(pane()?.className).toContain(red.getColorClass());

        // Switching markers is a note switch within a standing pane, so the colour has to follow it.
        map.setUnderPointer([ markerFeature(plain) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.classList.contains("use-note-color")).toBe(false);
        expect(pane()?.classList.contains("with-hue")).toBe(false);
    });

    /** The marker is brought to the middle of what the pane leaves uncovered, not of the map. */
    it("holds the marker it opens for clear of itself", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note, [ 2, 1 ]) ]);
        await act(async () => map.click());

        // Half of what the pane reaches into the map: its width plus the gap it stands off by.
        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);
    });

    it("stands the marker at the zoom the selection names", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();

        await mount([ note ], map, false, false, { noteId: note.noteId, zoom: 15 });
        await settle();

        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ], zoom: 15 } ]);
    });

    /** An embedded map may be narrower than the pane, leaving nowhere to move to. */
    it("leaves the marker where it is on a map the pane covers whole", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ width: 300 });
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ 0, 0 ] } ]);
    });

    /**
     * The way in for a note the map has just created (see `createNoteAt` in index.tsx): no click —
     * the map hands the pane the selection, marked as new, and the pane opens ready for the one
     * thing the note still lacks, a name.
     */
    it("opens on a note it is handed, with the stock name selected to be typed over", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "fresh", title: "new note", "#geolocation": "1,2" } ] });
        const note = froca.notes["fresh"];
        const map = fakeMap();

        // What the title widget asks before taking the focus; nothing in this DOM has a layout to
        // answer it with, so the answer a drawn pane would give is supplied by hand.
        (HTMLElement.prototype as { checkVisibility?: () => boolean }).checkVisibility = () => true;
        // The selecting itself is asserted as a call: happy-dom keeps no faithful selection range —
        // the controlled value write walks the caret to the end regardless of what select() did.
        const select = vi.spyOn(HTMLInputElement.prototype, "select");

        try {
            await mount([ note ], map, false, false, { noteId: note.noteId, isNew: true });
            await settle();

            // Open and held clear of the pane, exactly as if the marker had been clicked.
            expect(pane()).toBeTruthy();
            expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);

            // The caret is in the title with the whole of the stock name selected: naming the
            // place is typing over it, not clearing a field first.
            const title = pane()?.querySelector<HTMLInputElement>(".title-row input");
            expect(title?.value).toBe("new note");
            expect(document.activeElement).toBe(title);
            expect(select.mock.instances).toContain(title);
        } finally {
            select.mockRestore();
        }
    });

    it("clears on a click that misses every marker, and on Escape", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        map.setUnderPointer([]);
        await act(async () => map.click());
        expect(pane()).toBeNull();

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(pane()).toBeNull();
    });


    /** The panel stops key presses reaching the map, which would stop them reaching this too. */
    it("closes on Escape pressed with the focus inside the pane", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        await act(async () => {
            pane()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
        });
        expect(pane()).toBeNull();
    });

    it("leaves the click alone while the map is armed to place something", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map, true);

        // The click belongs to the placement, which is handled where that state lives.
        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(pane()).toBeNull();
        expect(map.eased).toEqual([]);
    });

    /** Removal clears the location and leaves the note in the tree, so the pane cannot wait to be
     *  told the note has gone. */
    it("goes away when its marker leaves the map, whether the note does or not", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        // The note has had its location cleared, which is all that taking a marker off the map does.
        const located = vi.spyOn(note, "getLabelValue").mockReturnValue(null);
        await mount([ note ], map);
        expect(pane()).toBeNull();

        located.mockRestore();
        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        // And the note gone from the collection altogether.
        await mount([], map);
        expect(pane()).toBeNull();
    });

    describe("the ways of opening it", () => {
        async function openPaneFor(note: FNote, map: ReturnType<typeof fakeMap>, isReadOnly = false) {
            await mount([ note ], map, false, isReadOnly);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
        }

        function press(icon: string) {
            container?.querySelector<HTMLButtonElement>(`.tn-embedded-note-actions button.${icon}`)?.click();
        }

        it("opens the note where every note in Trilium is opened", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            // What each of these opens is a path rather than an id, a note being reachable by more
            // than one. Which path that is belongs to the tree, not to the pane, so it is said here
            // instead of built: nothing in a froca raised for a test hangs under the root the real
            // one is searched from.
            const notePath = "root/places/somewhere";
            const bestNotePath = vi.spyOn(note, "getBestNotePathString").mockReturnValue(notePath);
            const goToLinkExt = vi.spyOn(link, "goToLinkExt").mockReturnValue(true);

            try {
                await openPaneFor(note, map);

                press("bx-log-in");
                expect(openInCurrentNoteContext).toHaveBeenCalledWith(expect.anything(), notePath);

                // Latitude first, as a geo URI is written and as the map's own menu hands one over —
                // the note stores it that way round, and the features the map draws do not.
                press("bx-map-alt");
                expect(goToLinkExt).toHaveBeenCalledWith(null, "geo:1,2");
            } finally {
                bestNotePath.mockRestore();
                goToLinkExt.mockRestore();
                openInCurrentNoteContext.mockClear();
            }
        });

        /**
         * The maximize in the header grows the pane over the map rather than handing the note to the
         * quick editor, which has none of what the pane offers — the place under the title, the ways
         * of moving the marker or taking it off the map. Growing the surface would have shrunk what
         * could be done in it.
         *
         * What is pinned here above all is that the note's editor is the very same element on the
         * other side of it: the pane is restyled where it stands, so nothing it holds is torn down
         * and nothing has to be saved and read back to grow it. A pane replaced by a larger one
         * would lose whatever had been typed and not yet saved.
         */
        it("grows over the map without rebuilding what it holds, and comes back down again", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined as never);

            try {
                await openPaneFor(note, map);
                const editorEl = pane()?.querySelector(".note-detail-stub");
                expect(editorEl).toBeTruthy();

                const maximize = () => act(async () => {
                    pane()?.querySelector<HTMLButtonElement>(".tn-overlay-panel-header-actions button.tn-embedded-note-maximize")?.click();
                });

                const body = () => pane()?.querySelector(".geo-detail-pane-body");
                expect(body()?.classList.contains("tn-embedded-note-pane-wide")).toBe(false);

                await maximize();
                expect(pane()?.classList.contains("maximized")).toBe(true);
                // Having a note's width, what it holds is laid out for one: the promoted fields
                // stand side by side as the quick editor shows them, rather than one to a line
                // (see `tn-embedded-note-pane-wide` in EmbeddedNotePane.css).
                expect(body()?.classList.contains("tn-embedded-note-pane-wide")).toBe(true);
                // The same editor, never having been away.
                expect(pane()?.querySelector(".note-detail-stub")).toBe(editorEl);
                // Neither a hand-over to another surface nor a dismissal: the pane is still up, and
                // nothing was asked to save because nothing is closing.
                expect(triggerCommand).not.toHaveBeenCalledWith("openInPopup", expect.anything());
                expect(editorAskedToSave).not.toHaveBeenCalled();

                await maximize();
                expect(pane()?.classList.contains("maximized")).toBe(false);
                expect(pane()?.querySelector(".note-detail-stub")).toBe(editorEl);
            } finally {
                triggerCommand.mockRestore();
            }
        });

        /**
         * The camera waits out a pane that covers the map rather than aiming into it: there is
         * nowhere left to hold the marker clear of, and a move made behind the pane would be a move
         * to somewhere nobody can see — seen all the same, the map sliding while the pane is still
         * growing over it. It is the coming back down that is worth framing for.
         */
        it("leaves the camera alone while it covers the map, and frames again as it comes down", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await openPaneFor(note, map);

            const maximize = () => act(async () => {
                pane()?.querySelector<HTMLButtonElement>(".tn-overlay-panel-header-actions button.tn-embedded-note-maximize")?.click();
            });

            await maximize();
            // Nothing moved for the growing.
            expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);

            await maximize();
            // And the marker is framed clear of the pane again as it comes back down, rather than
            // left wherever it was until something else happens to move the camera.
            expect(map.eased).toEqual([
                { center: [ 2, 1 ], offset: [ -200, 0 ] },
                { center: [ 2, 1 ], offset: [ -200, 0 ] }
            ]);
        });

        /**
         * The rest are gathered behind one button, and are the same ways a link offers anywhere in
         * the app — which is how a split view, the one worth having beside a map, comes to be
         * offered at all: the three buttons this replaced never had one.
         *
         * The pane names them itself, the shared menu wanting an event it cannot be handed before
         * anything is pressed, so what is pinned here is that the two lists stay the same list. Add
         * a fifth way to open a link and this fails until the pane offers it too.
         */
        it("gathers the rest of the ways of opening it, exactly as a link offers them", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await openPaneFor(note, map);

            expect(container?.querySelector(".tn-embedded-note-more")).toBeTruthy();
            expect(OTHER_WAYS_TO_OPEN.map((way) => way.command)).toEqual(
                linkContextMenu.getItems(new MouseEvent("click"))
                    .map((item) => ("command" in item ? item.command : undefined)));
        });
    });

    /**
     * Following a link inside the pane. One that points at another marker of this map moves the
     * selection — the pane switches, the map pans along — instead of navigating the whole tab away
     * from the map; every other link, and every click asking for more than a plain navigation,
     * keeps meaning what it means anywhere in the app.
     */
    describe("following a link inside the pane", () => {
        function twoMarkersAndAStray() {
            buildNote({ id: "root", title: "root", children: [
                { id: "fromhere", title: "From here", "#geolocation": "1,2" },
                { id: "tothere", title: "To there", "#geolocation": "3,4" },
                { id: "offmap", title: "Off the map" }
            ] });
            return [ froca.notes["fromhere"], froca.notes["tothere"], froca.notes["offmap"] ];
        }

        async function openPaneOn(note: FNote, notes: FNote[], map: ReturnType<typeof fakeMap>) {
            await mount(notes, map);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
            await settle();
            openInCurrentNoteContext.mockClear();
        }

        /** A link as the note's content carries one, clicked as the browser reports it. */
        function clickLink(noteId: string, init: MouseEventInit = {}) {
            const anchor = document.createElement("a");
            anchor.setAttribute("href", `#root/${noteId}`);
            pane()?.querySelector(".geo-detail-pane-body")?.appendChild(anchor);

            const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
            // A real left click says `which: 1`, which is what the app's own link handler goes by;
            // the DOM stand-in says 0 for every button, which it reads as no click at all.
            Object.defineProperty(event, "which", { value: 1 });
            return anchor.dispatchEvent(event);
        }

        it("follows a link to another marker by switching the pane, and pans to it", async () => {
            const notes = twoMarkersAndAStray();
            const map = fakeMap();
            await openPaneOn(notes[0], notes, map);
            expect(pane()?.textContent).toContain("From here");
            const easedBefore = map.eased.length;

            let defaultKept = true;
            await act(async () => { defaultKept = clickLink("tothere"); });
            await settle();

            // The pane switched and the map went along; the tab underneath heard nothing of it.
            expect(defaultKept).toBe(false);
            expect(pane()?.textContent).toContain("To there");
            expect(map.eased.length).toBeGreaterThan(easedBefore);
            expect(openInCurrentNoteContext).not.toHaveBeenCalled();
        });

        it("leaves a link alone when its note does not stand on this map", async () => {
            const notes = twoMarkersAndAStray();
            const map = fakeMap();
            await openPaneOn(notes[0], notes, map);

            await act(async () => { clickLink("offmap"); });
            await settle();

            // The click fell through to the app's own handler, and the pane stayed where it was.
            expect(openInCurrentNoteContext).toHaveBeenCalledWith(expect.anything(), "root/offmap", expect.anything());
            expect(pane()?.textContent).toContain("From here");
        });

        it("leaves a modified click to mean a new tab, marker or not", async () => {
            const notes = twoMarkersAndAStray();
            const map = fakeMap();
            const openTabWithNoteWithHoisting = vi.fn();
            (appContext.tabManager as unknown as Record<string, unknown>).openTabWithNoteWithHoisting = openTabWithNoteWithHoisting;
            await openPaneOn(notes[0], notes, map);

            await act(async () => { clickLink("tothere", { ctrlKey: true }); });
            await settle();

            expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("root/tothere", expect.anything());
            expect(pane()?.textContent).toContain("From here");
        });
    });

    describe("the note itself", () => {
        async function openPane(map: ReturnType<typeof fakeMap>) {
            buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
            const note = froca.notes["somewhere"];
            await mount([ note ], map);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
            await settle();
            return note;
        }

        it("is drawn in the pane, by the widget its type calls for", async () => {
            const map = fakeMap();
            await openPane(map);

            // Mounted under the pane's own note context, which is what it reads its note out of.
            expect(pane()?.querySelector(".note-detail-stub")?.textContent).toBe("Somewhere");
        });

        /** A toolbar built for the width of a note does not fit a pane a third that wide. */
        it("is asked for the floating toolbar rather than a bar of its own", async () => {
            const map = fakeMap();
            await openPane(map);

            expect(pane()?.querySelector(".note-detail-stub")?.getAttribute("data-floating-toolbar")).toBe("true");
        });

        /**
         * Regression test for `component.loadReferenceLinkTitle is not a function`, which a marker
         * whose note carried a reference link died on.
         *
         * Everything the text editor asks of the app it asks of a component it finds from its own
         * element — `glob.getComponentByEl(editor.editing.view.getDomRoot())` — while what it offers
         * is put onto the component it was mounted under. The pane mounts it under one of its own, so
         * unless the pane says in the DOM which component that is, the editor arrives at the widget
         * enclosing the map, which answers to none of it.
         */
        it("stands for its own component where the editor looks for one", async () => {
            const map = fakeMap();
            await openPane(map);

            const editorEl = pane()?.querySelector(".note-detail-stub");
            const host = appContext.getComponentByEl(editorEl as HTMLElement);

            // The pane itself is what carries it, and what it carries is the component the editor's
            // own registration landed on — the pane's, not the map's.
            expect(pane()?.getAttribute("data-component-id")).toBeTruthy();
            expect(host).not.toBe(mapComponent);
            expect(typeof host?.loadReferenceLinkTitle).toBe("function");
        });

        /**
         * Switching markers announces a note switch the editor saves on, but closing the pane
         * announces nothing — the widgets are only unmounted — so the pane says it itself.
         */
        it("is told to save before the pane closes", async () => {
            const map = fakeMap();
            await openPane(map);
            expect(editorAskedToSave).not.toHaveBeenCalled();

            await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });

            expect(editorAskedToSave).toHaveBeenCalledWith({ ntxIds: [ "_geo-detail-pane" ] });
            expect(pane()).toBeNull();
        });
    });

    /**
     * The place has a line of its own under the name, and is kept out of the grid of fields: the
     * collection promotes `geolocation` so that a marker can be placed from the tree, but in the
     * pane that field is a box of raw digits standing beside a map of the very place it names.
     */
    it("names the place under the title rather than among the fields", async () => {
        // An id of its own: the froca raised for a test keeps the attributes of every note built
        // under a given id, so reusing one would read back whatever an earlier test placed there.
        buildNote({ id: "root", title: "root", children: [ {
            id: "placeDesVosges",
            title: "Somewhere",
            // What the map writes when a marker is placed, which is a float's worth of decimals.
            "#geolocation": "48.855653506551015,2.36549253686366",
            // As the geo map template promotes it (see hidden_subtree_templates.ts).
            "#label:geolocation": "promoted,single,text"
        } ] });
        const map = fakeMap();
        await mount([ froca.notes["placeDesVosges"] ], map);

        map.setUnderPointer([ markerFeature(froca.notes["placeDesVosges"], [ 2.365, 48.855 ]) ]);
        await act(async () => map.click());
        await settle();

        // Rounded to a stride, which is as finely as anywhere is pointed out on a map.
        const location = pane()?.querySelector<HTMLButtonElement>(".geo-detail-pane-location");
        expect(location?.textContent).toBe("48.855654, 2.365493");
        expect(pane()?.querySelector(".promoted-attribute-cell")).toBeNull();

        // Carried at every digit the note holds, so what is pasted elsewhere is the place itself.
        await act(async () => { location?.click(); });
        expect(copied).toHaveBeenCalledWith("48.855653506551015, 2.365492536863660");

        // Named by the app's own tooltip, as the buttons beneath it are, rather than by the one the
        // browser draws from a `title` — which is what carrying no such attribute leaves.
        expect(location?.getAttribute("title")).toBeNull();
    });

    /**
     * A marker is very often a note whose fields say more about the place than its content does — the
     * grid of them is the quick editor's, standing where the quick editor puts it.
     */
    it("offers the note's own promoted fields, and none where a note promotes none", async () => {
        buildNote({ id: "root", title: "root", children: [
            {
                id: "somewhere",
                title: "Somewhere",
                "#geolocation": "1,2",
                "#label:visited": "promoted,single,text",
                "#visited": "2026-08-04"
            },
            { id: "elsewhere", title: "Elsewhere", "#geolocation": "3,4" }
        ] });
        const map = fakeMap();
        await mount([ froca.notes["somewhere"], froca.notes["elsewhere"] ], map);

        map.setUnderPointer([ markerFeature(froca.notes["somewhere"]) ]);
        await act(async () => map.click());
        await settle();

        const cell = pane()?.querySelector(".promoted-attribute-cell");
        expect(cell?.querySelector("label")?.textContent).toBe("visited");
        expect(cell?.querySelector<HTMLInputElement>("input")?.value).toBe("2026-08-04");

        // Moving between markers is a note switch within the standing pane, so the fields follow it.
        map.setUnderPointer([ markerFeature(froca.notes["elsewhere"], [ 4, 3 ]) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.querySelector(".promoted-attribute-cell")).toBeNull();
    });

    describe("moving the marker", () => {
        function moveButton() {
            return container?.querySelector<HTMLButtonElement>(".tn-embedded-note-actions button.bx-move") ?? null;
        }

        /**
         * The map is armed rather than the marker dragged, and the pane goes away while it waits: the
         * click that names the new place has to land on the map, and the pane covers the part of it
         * nearest the marker.
         */
        it("arms the map for the next click and stands down", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
            await settle();

            await act(async () => { moveButton()?.click(); });

            // The arming belongs to the map, which alone knows what the next click on it is for.
            expect(onRelocate).toHaveBeenCalledWith(note.noteId);
            expect(pane()).toBeNull();
            // Going away this way is still a close, so whatever was being written is saved first.
            expect(editorAskedToSave).toHaveBeenCalledWith({ ntxIds: [ "_geo-detail-pane" ] });
        });

        it("is not offered at all on a map that cannot be edited", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map, false, true);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());

            expect(pane()).toBeTruthy();
            expect(moveButton()).toBeNull();
        });

        /**
         * A track has no marker to put somewhere else: it is on the map by being drawn across it,
         * and its place is the line its file holds. The button used to be offered and only wrote a
         * location onto the note, planting a stray pin while the line stayed where it was.
         */
        it("is not offered for a GPX track, which has no marker to move", async () => {
            buildNote({ id: "root", title: "root", children: [ { id: "hikemove", title: "A hike", mime: GPX_MIME } ] });
            const note = froca.notes["hikemove"];
            const map = fakeMap();

            await mount([ note ], map);
            map.setUnderPointer([ trackFeature(note) ]);
            await act(async () => map.click());
            await settle();

            // The rest of the row stands: only the one offer that cannot mean anything is gone.
            expect(pane()).toBeTruthy();
            expect(container?.querySelector(".tn-embedded-note-actions button.bx-log-in")).toBeTruthy();
            expect(moveButton()).toBeNull();
        });
    });

    describe("taking the marker off the map", () => {
        function removeButton() {
            return container?.querySelector<HTMLButtonElement>(".tn-embedded-note-actions button.bx-trash") ?? null;
        }

        /**
         * Asked first, and only then does the note's location go — the note itself staying where it
         * is in the tree — the pane going with the marker, there being nothing left to stand for.
         */
        it("clears the note's location and stands down, the reader having agreed", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });

            try {
                await mount([ note ], map);
                map.setUnderPointer([ markerFeature(note) ]);
                await act(async () => map.click());

                await act(async () => { removeButton()?.click(); });
                expect(setLabel).toHaveBeenCalledWith(note.noteId, "geolocation", "");

                // What the server would send back, which is the note carrying nowhere to be drawn.
                vi.spyOn(note, "getLabelValue").mockReturnValue(null);
                await mount([ note ], map);
                expect(pane()).toBeNull();
            } finally {
                setLabel.mockRestore();
            }
        });

        /** Turned down at the dialog, the marker stays exactly where it was. */
        it("leaves the marker alone where the reader changed their mind", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            confirmDelete.mockResolvedValue(false);

            try {
                await mount([ note ], map);
                map.setUnderPointer([ markerFeature(note) ]);
                await act(async () => map.click());

                await act(async () => { removeButton()?.click(); });

                expect(setLabel).not.toHaveBeenCalled();
                expect(pane()).toBeTruthy();
            } finally {
                setLabel.mockRestore();
            }
        });

        it("is not offered at all on a map that cannot be edited", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map, false, true);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());

            // The ways of reading the note stay; the one that writes it does not.
            expect(pane()).toBeTruthy();
            expect(container?.querySelector(".tn-embedded-note-actions button.bx-log-in")).toBeTruthy();
            expect(removeButton()).toBeNull();
        });

        /**
         * A track's line is drawn from its own file rather than from a location written on it, so
         * there is no taking it off the map and keeping it. The button is named for what it really
         * does, and the dialog is told there is nothing to offer a choice about.
         */
        it("asks about a GPX track as a deletion, there being nothing else it could be", async () => {
            buildNote({ id: "root", title: "root", children: [ { id: "hikegone", title: "A hike", mime: GPX_MIME } ] });
            const note = froca.notes["hikegone"];
            const map = fakeMap();

            await mount([ note ], map);
            map.setUnderPointer([ trackFeature(note) ]);
            await act(async () => map.click());
            await settle();

            await act(async () => { removeButton()?.click(); });

            expect(confirmDelete).toHaveBeenCalledWith(
                note.title,
                { noteId: note.noteId, branchId: "root_hikegone" },
                expect.objectContaining({ mustDeleteNote: true })
            );
        });
    });

    it("keeps clicks and key presses from reaching the map underneath", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        const onMouseDown = vi.fn();
        const onKeyDown = vi.fn();
        container?.addEventListener("mousedown", onMouseDown);
        container?.addEventListener("keydown", onKeyDown);

        pane()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        pane()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));

        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    /*
     * A phone shows the marker as a dialog over the whole screen rather than as a pane beside the
     * map (see MarkerSheet). A pane holding a whole note takes most of the screen there whatever is
     * done to it, so the maximize that would give it the rest has nothing left to give — and the
     * camera, which holds a marker clear of the pane, has no uncovered half to hold it in.
     */
    describe("on a phone", () => {
        beforeEach(() => { window.glob.device = "mobile"; });
        afterEach(() => { window.glob.device = "desktop"; });

        async function openSheetFor(note: FNote, map: ReturnType<typeof fakeMap>) {
            await mount([ note ], map);
            map.setUnderPointer([ markerFeature(note, [ 2, 1 ]) ]);
            await act(async () => map.click());
            // The dialog goes up first and reads its note out of the context after, so what it
            // holds is drawn a turn later than the pane's is.
            await act(async () => {});
        }

        const sheet = () => document.querySelector(".modal.geo-detail-sheet");

        it("shows the marker as a dialog rather than as a pane over the map", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            await openSheetFor(note, fakeMap());

            expect(pane()).toBeNull();
            expect(sheet()).toBeTruthy();
            // The same contents either way: the note, and what may be done with the marker.
            expect(sheet()?.querySelector(".note-detail-stub")).toBeTruthy();
            expect(sheet()?.querySelector(".geo-detail-pane-location")).toBeTruthy();
        });

        it("offers no maximize, the dialog already having the screen", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            await openSheetFor(note, fakeMap());

            expect(document.querySelector(".tn-embedded-note-maximize")).toBeNull();
        });

        /* Tinted by the marker's own colour as the pane is, the dialog being the same note shown
           another way (see the `.geo-detail-sheet.with-hue` rules in theme-next-{light,dark}.css). */
        it("carries the marker's own colour", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2", "#color": "#ff0000" });
            await openSheetFor(note, fakeMap());

            expect(sheet()?.className).toContain(note.getColorClass());
        });

        it("leaves the camera alone, there being no pane to hold the marker clear of", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await openSheetFor(note, map);

            expect(map.eased).toEqual([]);
        });
    });
});
