import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Capture the latest props handed to the (mocked) inner Map component so tests can drive its
// callbacks (viewportChanged, onClick, onContextMenu) and render its children (the NoteWrappers)
// without instantiating the heavy Leaflet engine.
const mapState: { props: Record<string, any> | undefined } = { props: undefined };

vi.mock("./map", () => ({
    default: function MapMock(props: Record<string, any>) {
        mapState.props = props;
        // Mirror the real component: expose the container ref + an api so the drag callback can run.
        if (props.containerRef && !props.containerRef.current) {
            const div = document.createElement("div");
            props.containerRef.current = div;
        }
        if (props.apiRef && !props.apiRef.current) {
            props.apiRef.current = {
                containerPointToLatLng: vi.fn(() => ({ lat: 10, lng: 20 }))
            };
        }
        return <div className="map-mock">{props.children}</div>;
    }
}));

// Marker / GpxTrack render nothing meaningful but capture their props so we can assert wiring.
const markerCalls: Record<string, any>[] = [];
const gpxCalls: Record<string, any>[] = [];
vi.mock("./marker", () => ({
    default: function MarkerMock(props: Record<string, any>) {
        markerCalls.push(props);
        return <div className="marker-mock" />;
    },
    GpxTrack: function GpxTrackMock(props: Record<string, any>) {
        gpxCalls.push(props);
        return <div className="gpx-mock" />;
    }
}));

vi.mock("./api", () => ({
    createNewNote: vi.fn(async () => undefined),
    moveMarker: vi.fn(async () => undefined)
}));

vi.mock("./context_menu", () => ({
    default: vi.fn(),
    openMapContextMenu: vi.fn()
}));

// Render a thin pass-through so the geomap's collection-properties children actually mount,
// without dragging in the book/search-only gating of the real component.
vi.mock("../../note_bars/CollectionProperties", () => ({
    default: ({ rightChildren }: { rightChildren?: import("preact").ComponentChildren }) => (
        <div className="collection-properties-mock">
            <div className="right">{rightChildren}</div>
        </div>
    )
}));

vi.mock("../../../services/toast", () => ({
    default: {
        showPersistent: vi.fn(),
        closePersistent: vi.fn()
    }
}));

vi.mock("../../../services/branches", () => ({
    default: {
        cloneNoteToParentNote: vi.fn(async () => undefined)
    }
}));

// divIcon is the only Leaflet symbol used directly by index.tsx (in buildIcon).
vi.mock("leaflet", () => ({
    divIcon: vi.fn((opts: unknown) => ({ __divIcon: true, opts }))
}));

vi.mock("leaflet/dist/images/marker-icon.png", () => ({ default: "marker-icon.png" }));
vi.mock("leaflet/dist/images/marker-shadow.png", () => ({ default: "marker-shadow.png" }));

import { divIcon } from "leaflet";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import froca from "../../../services/froca";
import branches from "../../../services/branches";
import server from "../../../services/server";
import toast from "../../../services/toast";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import type { ViewModeProps } from "../interface";
import { createNewNote, moveMarker } from "./api";
import openContextMenu, { openMapContextMenu } from "./context_menu";
import GeoView from "./index";

// --- Harness --------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
const parent = new Component();

async function renderGeo(props: Partial<ViewModeProps<any>> & { note: ReturnType<typeof buildNote> }) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    container = target;
    const fullProps: ViewModeProps<any> = {
        notePath: "root/" + props.note.noteId,
        noteIds: [],
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "screen",
        onReady: vi.fn(),
        ...props
    };
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={null}>
                    <GeoView {...fullProps} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            target
        );
    });
    // Let the froca.getNotes effect (and any resulting re-render) settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return target;
}

function fireTrilium(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

/** Drain several macrotask hops so deeply chained async effects (froca → blob → server) settle. */
async function flushMany(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
}

beforeEach(() => {
    vi.useRealTimers();
    mapState.props = undefined;
    markerCalls.length = 0;
    gpxCalls.length = 0;
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, {
        put: vi.fn(async () => undefined),
        upload: vi.fn(async () => undefined),
        get: vi.fn(async () => "")
    });
    Object.assign(ws, { logError: vi.fn() });
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
});

afterEach(async () => {
    if (container) {
        await act(async () => { render(null, container as HTMLDivElement); });
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("GeoView - rendering & defaults", () => {
    it("renders the geo-view shell with default coordinates/zoom and a built-in layer", async () => {
        const note = buildNote({ id: "g1", title: "Geo" });
        const root = await renderGeo({ note });

        const view = root.querySelector(".geo-view");
        expect(view).toBeTruthy();
        // Not in note-placement mode initially.
        expect(view?.className).not.toContain("placing-note");

        const props = mapState.props;
        expect(props).toBeDefined();
        // Default coordinates/zoom are applied (so Map mounts).
        expect(props?.zoom).toBe(2);
        expect(Array.isArray(props?.coordinates)).toBe(true);
        // Default (built-in) layer data resolves.
        expect(props?.layerData?.name).toBeTruthy();
        // No map:scale label → scale off.
        expect(props?.scale).toBe(false);
    });

    it("respects an explicit viewConfig (center/zoom) over the defaults", async () => {
        const note = buildNote({ id: "g2", title: "Geo" });
        const root = await renderGeo({
            note,
            viewConfig: { view: { center: [ 1, 2 ], zoom: 7 } }
        });
        expect(root.querySelector(".geo-view")).toBeTruthy();
        const props = mapState.props;
        expect(props?.zoom).toBe(7);
        expect(props?.coordinates).toEqual([ 1, 2 ]);
    });

    it("enables scale when the map:scale label is set", async () => {
        const note = buildNote({ id: "g3", title: "Geo", "#map:scale": "true" });
        await renderGeo({ note });
        expect(mapState.props?.scale).toBe(true);
    });
});

describe("GeoView - layer data resolution", () => {
    it("returns a custom raster layer when map:style is an http URL", async () => {
        const note = buildNote({ id: "gl1", title: "Geo", "#map:style": "https://tiles.example/{z}/{x}/{y}.png" });
        await renderGeo({ note });
        const layer = mapState.props?.layerData;
        expect(layer?.name).toBe("Custom");
        expect(layer?.type).toBe("raster");
        expect(layer?.url).toBe("https://tiles.example/{z}/{x}/{y}.png");
    });

    it("uses a built-in named layer when map:style matches a known key", async () => {
        const note = buildNote({ id: "gl2", title: "Geo", "#map:style": "openstreetmap" });
        await renderGeo({ note });
        expect(mapState.props?.layerData?.name).toBe("OpenStreetMap");
    });

    it("falls back to the default layer for an unknown map:style", async () => {
        const note = buildNote({ id: "gl3", title: "Geo", "#map:style": "totally-unknown" });
        await renderGeo({ note });
        // Default layer name resolves (whatever it is) and is not "Custom".
        expect(mapState.props?.layerData?.name).toBeTruthy();
        expect(mapState.props?.layerData?.name).not.toBe("Custom");
    });
});

describe("GeoView - viewport persistence", () => {
    it("schedules a saveConfig when the viewport changes and a viewConfig exists", async () => {
        const saveConfig = vi.fn();
        const note = buildNote({ id: "gv1", title: "Geo" });
        await renderGeo({ note, saveConfig, viewConfig: { view: { center: [ 0, 0 ], zoom: 3 } } });

        await act(async () => {
            mapState.props?.viewportChanged({ lat: 5, lng: 6 }, 9);
        });
        // useSpacedUpdate fires after its interval; advance real time.
        await act(async () => { await new Promise((r) => setTimeout(r, 5100)); });
        expect(saveConfig).toHaveBeenCalled();
    }, 10000);

    it("creates a fresh viewConfig object when none was provided and still persists", async () => {
        const saveConfig = vi.fn();
        const note = buildNote({ id: "gv2", title: "Geo" });
        await renderGeo({ note, saveConfig, viewConfig: undefined });

        await act(async () => {
            mapState.props?.viewportChanged({ lat: 1, lng: 1 }, 4);
        });
        // viewportChanged lazily creates `viewConfig = {}`, so the spaced update then persists it.
        await act(async () => { await new Promise((r) => setTimeout(r, 5100)); });
        expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({
            view: { center: { lat: 1, lng: 1 }, zoom: 4 }
        }));
    }, 10000);
});

describe("GeoView - read-only handling", () => {
    it("passes editable markers and an unlocked context menu when not read-only", async () => {
        const note = buildNote({ id: "gr1", title: "Geo", children: [ { id: "m-edit", title: "Marker", "#geolocation": "12.5,34.5" } ] });
        await renderGeo({ note, noteIds: [ "m-edit" ] });

        const marker = markerCalls.at(-1);
        expect(markerCalls.length).toBeGreaterThan(0);
        expect(marker?.draggable).toBe(true);
        // editable → onDragged wired, onClick not.
        expect(typeof marker?.onDragged).toBe("function");
        expect(marker?.onClick).toBeUndefined();

        // The context-menu callback should pass editable=true.
        mapState.props?.onContextMenu({ originalEvent: { pageX: 1, pageY: 2 }, latlng: { lat: 0, lng: 0 } });
        expect(openMapContextMenu).toHaveBeenCalledWith(note, expect.anything(), true);
    });

    it("passes non-editable markers and a locked context menu when read-only", async () => {
        const note = buildNote({ id: "gr2", title: "Geo", "#readOnly": "true", children: [ { id: "m-ro", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "m-ro" ] });

        const marker = markerCalls.at(-1);
        expect(markerCalls.length).toBeGreaterThan(0);
        expect(marker?.draggable).toBe(false);
        // non-editable → onClick wired, onDragged not.
        expect(typeof marker?.onClick).toBe("function");
        expect(marker?.onDragged).toBeUndefined();

        mapState.props?.onContextMenu({ originalEvent: { pageX: 0, pageY: 0 }, latlng: { lat: 0, lng: 0 } });
        expect(openMapContextMenu).toHaveBeenCalledWith(note, expect.anything(), false);
    });
});

describe("GeoView - note placement (geoMapCreateChildNote)", () => {
    it("enters placement mode on the event, then a map click creates a new note", async () => {
        const note = buildNote({ id: "gp1", title: "Geo" });
        const root = await renderGeo({ note });

        fireTrilium("geoMapCreateChildNote", undefined);
        expect(toast.showPersistent).toHaveBeenCalled();
        expect(root.querySelector(".geo-view")?.className).toContain("placing-note");

        // A click while in placement mode creates a note and closes the toast.
        await act(async () => {
            await mapState.props?.onClick({ latlng: { lat: 3, lng: 4 } });
        });
        expect(createNewNote).toHaveBeenCalledTimes(1);
        expect(toast.closePersistent).toHaveBeenCalledWith("geo-new-note");
        // Returns to normal mode.
        expect(root.querySelector(".geo-view")?.className).not.toContain("placing-note");
    });

    it("leaves placement mode without creating a note when Escape is pressed", async () => {
        const note = buildNote({ id: "gp2", title: "Geo" });
        const root = await renderGeo({ note });

        fireTrilium("geoMapCreateChildNote", undefined);
        expect(root.querySelector(".geo-view")?.className).toContain("placing-note");

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(root.querySelector(".geo-view")?.className).not.toContain("placing-note");
        expect(toast.closePersistent).toHaveBeenCalledWith("geo-new-note");
    });

    it("does nothing on a map click while not in placement mode", async () => {
        const note = buildNote({ id: "gp3", title: "Geo" });
        await renderGeo({ note });
        await act(async () => {
            await mapState.props?.onClick({ latlng: { lat: 0, lng: 0 } });
        });
        expect(createNewNote).not.toHaveBeenCalled();
    });

    it("ignores non-Escape keypresses while in placement mode", async () => {
        const note = buildNote({ id: "gp4", title: "Geo" });
        const root = await renderGeo({ note });
        fireTrilium("geoMapCreateChildNote", undefined);
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        });
        expect(root.querySelector(".geo-view")?.className).toContain("placing-note");
    });
});

describe("GeoView - deleteFromMap event", () => {
    it("removes a marker by clearing its geolocation", async () => {
        const note = buildNote({ id: "gd1", title: "Geo" });
        await renderGeo({ note });
        fireTrilium("deleteFromMap", { noteId: "someNote" });
        expect(moveMarker).toHaveBeenCalledWith("someNote", null);
    });
});

describe("GeoView - ToggleReadOnlyButton", () => {
    it("renders a toggle button in the collection properties and flips read-only on click", async () => {
        const attrs = await import("../../../services/attributes");
        const spy = vi.spyOn(attrs.default, "setBooleanWithInheritance").mockResolvedValue(undefined as never);
        const note = buildNote({ id: "gt1", title: "Geo" });
        const root = await renderGeo({ note });

        const rightArea = root.querySelector(".collection-properties-mock .right");
        const buttons = Array.from(rightArea?.querySelectorAll("button") ?? []);
        expect(buttons.length).toBeGreaterThan(0);

        // The first button is the read-only toggle (ActionButton).
        buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(spy).toHaveBeenCalledWith(note, "readOnly", true);
    });
});

describe("GeoView - NoteWrapper variants", () => {
    it("renders a GpxTrack for a gpx note and fetches its XML", async () => {
        const note = buildNote({ id: "gx-parent", title: "Geo" });
        const gpxNote = buildNote({ id: "gpx1", title: "Track" });
        gpxNote.mime = "application/gpx+xml";
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue("<gpx></gpx>");
        await renderGeo({ note, noteIds: [ "gpx1" ] });

        // useNoteBlob → server.get for the open endpoint → GpxTrack renders.
        // The async chain (getNotes → setNotes → useNoteBlob → getBlob → setBlob → server.get)
        // needs several macrotask hops to settle.
        await flushMany();
        expect(server.get).toHaveBeenCalledWith("notes/gpx1/open", undefined, true);
        expect(gpxCalls.length).toBeGreaterThan(0);
        expect(gpxCalls.at(-1)?.gpxXmlString).toBe("<gpx></gpx>");
        // No plain marker for the gpx note.
        expect(markerCalls.length).toBe(0);
    });

    it("decodes a Uint8Array gpx response into a string", async () => {
        const note = buildNote({ id: "gx2-parent", title: "Geo" });
        const gpxNote = buildNote({ id: "gpx2", title: "Track" });
        gpxNote.mime = "application/gpx+xml";
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue(new TextEncoder().encode("<gpx2/>"));
        await renderGeo({ note, noteIds: [ "gpx2" ] });
        await flushMany();
        expect(gpxCalls.at(-1)?.gpxXmlString).toBe("<gpx2/>");
    });

    it("renders nothing for a note without a geolocation and not gpx", async () => {
        const note = buildNote({ id: "gn-parent", title: "Geo" });
        buildNote({ id: "plain", title: "Plain" });
        await renderGeo({ note, noteIds: [ "plain" ] });
        expect(markerCalls.length).toBe(0);
        expect(gpxCalls.length).toBe(0);
    });

    it("renders a marker with parsed coordinates for a geolocated note", async () => {
        const note = buildNote({ id: "gm-parent", title: "Geo" });
        buildNote({ id: "loc", title: "Loc", "#geolocation": "45.1,-3.2" });
        await renderGeo({ note, noteIds: [ "loc" ] });
        expect(markerCalls.length).toBeGreaterThan(0);
        expect(markerCalls.at(-1)?.coordinates).toEqual([ 45.1, -3.2 ]);
    });
});

describe("GeoView - NoteMarker interactions", () => {
    it("opens the note in a popup when a read-only marker is clicked", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => undefined as never);
        const note = buildNote({ id: "mkc-parent", title: "Geo", "#readOnly": "true", children: [ { id: "mk-click", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "mk-click" ] });

        markerCalls.at(-1)?.onClick?.();
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "mk-click" });
    });

    it("opens in a new tab on middle mouse button down", async () => {
        const openInNewTab = vi.fn();
        Object.assign(appContext, {
            tabManager: {
                getActiveContext: vi.fn(() => ({ hoistedNoteId: "h1" })),
                openInNewTab
            }
        });
        const note = buildNote({ id: "mkm-parent", title: "Geo", children: [ { id: "mk-mid", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "mk-mid" ] });

        markerCalls.at(-1)?.onMouseDown?.({ button: 1 });
        expect(openInNewTab).toHaveBeenCalledWith("mk-mid", "h1");
    });

    it("ignores non-middle mouse buttons", async () => {
        const openInNewTab = vi.fn();
        Object.assign(appContext, {
            tabManager: {
                getActiveContext: vi.fn(() => ({ hoistedNoteId: "h1" })),
                openInNewTab
            }
        });
        const note = buildNote({ id: "mkl-parent", title: "Geo", children: [ { id: "mk-left", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "mk-left" ] });

        markerCalls.at(-1)?.onMouseDown?.({ button: 0 });
        expect(openInNewTab).not.toHaveBeenCalled();
    });

    it("persists a drag of an editable marker", async () => {
        const note = buildNote({ id: "mkd-parent", title: "Geo", children: [ { id: "mk-drag", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "mk-drag" ] });

        markerCalls.at(-1)?.onDragged?.({ lat: 9, lng: 8 });
        expect(moveMarker).toHaveBeenCalledWith("mk-drag", { lat: 9, lng: 8 });
    });

    it("opens the per-note context menu with the editable flag", async () => {
        const note = buildNote({ id: "mkcm-parent", title: "Geo", children: [ { id: "mk-cm", title: "Marker", "#geolocation": "1,2" } ] });
        await renderGeo({ note, noteIds: [ "mk-cm" ] });

        const evt = { originalEvent: { pageX: 5, pageY: 6 } };
        markerCalls.at(-1)?.onContextMenu?.(evt);
        expect(openContextMenu).toHaveBeenCalledWith("mk-cm", evt, true);
    });

    it("builds a DivIcon for the marker", async () => {
        const note = buildNote({ id: "mki-parent", title: "Geo", children: [ { id: "mk-icon", title: "Marker", "#geolocation": "1,2", "#iconClass": "bx bx-star" } ] });
        await renderGeo({ note, noteIds: [ "mk-icon" ] });
        expect(divIcon).toHaveBeenCalled();
        expect((markerCalls.at(-1)?.icon as any)?.__divIcon).toBe(true);
    });
});

describe("GeoView - drag & drop note placement", () => {
    function dropEvent(data: unknown[]) {
        const e = new Event("drop", { bubbles: true }) as DragEvent & { dataTransfer: any };
        e.dataTransfer = { getData: () => JSON.stringify(data) };
        Object.assign(e, { clientX: 100, clientY: 200, preventDefault: () => {} });
        return e;
    }

    it("moves an existing child marker when dropped onto the map", async () => {
        const note = buildNote({ id: "dd-parent", title: "Geo", children: [ { id: "dd-child", title: "Child" } ] });
        const root = await renderGeo({ note, noteIds: [] });
        const containerEl = mapState.props?.containerRef?.current as HTMLElement;
        expect(containerEl).toBeTruthy();

        await act(async () => {
            containerEl.dispatchEvent(dropEvent([ { noteId: "dd-child" } ]));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
        expect(moveMarker).toHaveBeenCalledWith("dd-child", { lat: 10, lng: 20 });
        expect(root).toBeTruthy();
    });

    it("clones a non-child note then moves it", async () => {
        const note = buildNote({ id: "dd2-parent", title: "Geo" });
        buildNote({ id: "outsider", title: "Outsider" });
        await renderGeo({ note, noteIds: [] });
        const containerEl = mapState.props?.containerRef?.current as HTMLElement;

        await act(async () => {
            containerEl.dispatchEvent(dropEvent([ { noteId: "outsider" } ]));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(branches.cloneNoteToParentNote).toHaveBeenCalledWith("outsider", "outsider");
        expect(moveMarker).toHaveBeenCalledWith("outsider", { lat: 10, lng: 20 });
    });

    it("does not move or clone when the map is read-only (drag callback short-circuits)", async () => {
        const note = buildNote({ id: "dd-ro-parent", title: "Geo", "#readOnly": "true", children: [ { id: "dd-ro-child", title: "Child" } ] });
        await renderGeo({ note, noteIds: [] });
        const containerEl = mapState.props?.containerRef?.current as HTMLElement;

        await act(async () => {
            containerEl.dispatchEvent(dropEvent([ { noteId: "dd-ro-child" } ]));
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
        expect(moveMarker).not.toHaveBeenCalled();
    });
});

describe("GeoView - hideLabels branch coverage", () => {
    it("omits the title label on markers and adds the archived class when map:hideLabels is set", async () => {
        const note = buildNote({
            id: "hl-parent",
            title: "Geo",
            "#map:hideLabels": "true",
            children: [ { id: "hl-marker", title: "Hidden", "#geolocation": "1,2", "#archived": "true", "#color": "red" } ]
        });
        await renderGeo({ note, noteIds: [ "hl-marker" ] });
        // A DivIcon is still constructed; its html is built with an empty title + archived wrapper class.
        expect(divIcon).toHaveBeenCalled();
        const lastIconOpts = (divIcon as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as { html: string };
        expect(lastIconOpts.html).toContain("archived");
        // hideLabels → the title-label span is empty.
        expect(lastIconOpts.html).toContain(`<span class="title-label"></span>`);
    });

    it("omits the start-icon title on a gpx track when map:hideLabels is set", async () => {
        const note = buildNote({ id: "hl-gpx-parent", title: "Geo", "#map:hideLabels": "true" });
        const gpxNote = buildNote({ id: "hl-gpx", title: "TrackTitle" });
        gpxNote.mime = "application/gpx+xml";
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue("<gpx/>");
        await renderGeo({ note, noteIds: [ "hl-gpx" ] });
        await flushMany();
        expect(gpxCalls.length).toBeGreaterThan(0);
        // The GPX options carry markers built without the note title (hidden labels).
        const opts = gpxCalls.at(-1)?.options;
        expect(opts?.markers).toBeDefined();
        // The start icon's html should not embed the track title when labels are hidden.
        expect((opts?.markers?.startIcon as any)?.opts?.html ?? "").not.toContain("TrackTitle");
    });
});
