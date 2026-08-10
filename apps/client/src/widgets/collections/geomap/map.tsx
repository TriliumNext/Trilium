import "maplibre-gl/dist/maplibre-gl.css";

import { AttributionControl, type ErrorEvent as MapErrorEvent, Map as MapLibreGLMap, MapMouseEvent, type Point, type RequestTransformFunction, ScaleControl, type StyleSpecification, type TransformStyleFunction } from "maplibre-gl";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { getMeasurementSystem } from "../../../utils/formatters";
import { useElementSize, useSyncedRef, useTriliumOption } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import { DEFAULT_RASTER_MAX_ZOOM, type MapLayer } from "./map_layer";

export interface GeoMouseEvent {
    latlng: { lat: number; lng: number };
    originalEvent: MouseEvent;
    /** Where the event landed in the container, for hit-testing against the rendered layers. */
    point: Point;
}

export const ParentMap = createContext<MapLibreGLMap | null>(null);

/** The zoom a map opens at where no view has been saved: far enough out to see the whole world. */
export const DEFAULT_ZOOM = 2;

/**
 * Whether the map's style has finished loading, and so whether a source or a layer can be added to it.
 *
 * Offered here rather than left to each child to work out, because neither of the two things MapLibre
 * says about it can be asked after the fact. `style.load` fires once per style, so a child that mounts
 * late — one waiting on the note's content to be fetched, say — attaches its listener to an event that
 * has already gone by. And `isStyleLoaded()` is no fallback, since it answers for the tiles as much as
 * for the style: it stays false while they are still arriving, and forever on a map whose tile server
 * is slow or refuses us. A child that misses both never gets to add anything at all.
 *
 * Latched beside the map's own creation instead (see below), where the event cannot be missed, and
 * handed down as context so a child that mounts at any time reads the same answer.
 */
export const MapStyleLoaded = createContext(false);

interface MapProps {
    apiRef?: RefObject<MapLibreGLMap | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: { lat: number; lng: number } | [number, number];
    zoom: number;
    layerData: MapLayer;
    viewportChanged: (coordinates: { lat: number; lng: number }, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: GeoMouseEvent) => void;
    scale: boolean;
}

export function toGeoMouseEvent(e: MapMouseEvent): GeoMouseEvent {
    return {
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        originalEvent: e.originalEvent,
        point: e.point
    };
}

/** Where the fonts a label is drawn from come from, matching what the vector styles ask for. */
const GLYPHS_URL = "https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf";

/** Builds the style that can be applied synchronously: the raster style spec, a vector style URL
 * or the vector fallback style used as a placeholder until the real style loads asynchronously. */
function buildSyncStyle(layerData: MapLayer): StyleSpecification | string {
    if (layerData.type === "vector") {
        return typeof layerData.style === "string"
            ? layerData.style
            : layerData.styleFallback;
    }

    return {
        version: 8,
        // Text on a map is drawn from glyphs the style has to name, and a raster style is built here
        // rather than downloaded, so nothing else names them for it. Without this every symbol layer
        // over a raster map loses its text and only its text: the marker titles and the count inside
        // a cluster's bubble go silently missing, while the pins and the bubbles themselves are
        // drawn as usual. The vector styles point at the same place (see their own `glyphs`).
        glyphs: GLYPHS_URL,
        sources: {
            "raster-tiles": {
                type: "raster",
                tiles: [ toMapLibreUrl(layerData.url) ],
                // The size the tiles are drawn at, which is also the size they are designed at: a
                // raster tile carries its labels and its road widths in the picture, sized for this.
                // Taking the level below and drawing it at 128 would be sharper on a fine screen —
                // Leaflet's `detectRetina` did exactly that — but it halves the cartography with it,
                // and a map whose every label is half-size reads as one zoom further out. A server
                // with real `@2x` tiles is the only way to have both, which is what `{r}` is for.
                tileSize: 256,
                // Where the server's own tiles stop. Past it MapLibre stretches the deepest one it
                // has rather than asking for a level that does not exist, which is a blurry map
                // rather than a blank one.
                maxzoom: layerData.maxZoom ?? DEFAULT_RASTER_MAX_ZOOM,
                attribution: layerData.attribution
            }
        },
        layers: [
            {
                id: "raster-layer",
                type: "raster",
                source: "raster-tiles"
            }
        ]
    };
}

/**
 * A tile URL as MapLibre spells it.
 *
 * The user guide sends anyone wanting a custom map to Leaflet Providers, whose URLs are written in
 * Leaflet's templates. `{r}` is where a server that draws tiles twice over wants `@2x` put, and
 * MapLibre asks for the same thing under the name `{ratio}` — it knows nothing of `{r}`, so the
 * three characters went out in the request and the server was asked for a tile named after a letter.
 *
 * This is the one way a raster map is sharp on a fine screen and still the map it was drawn as: an
 * `@2x` tile is twice the picture of the same ground, with the labels drawn twice the size to match.
 * Nothing can be done for a server that has no such tiles — OpenStreetMap answers 400 — which is why
 * this is left to the URL to ask for rather than done to every map.
 */
function toMapLibreUrl(url: string) {
    return url.replaceAll("{r}", "{ratio}");
}

function toCenter(coordinates: { lat: number; lng: number } | [number, number]): [number, number] {
    return Array.isArray(coordinates)
        ? [ coordinates[1], coordinates[0] ]
        : [ coordinates.lng, coordinates.lat ];
}

export default function Map({ coordinates, zoom, layerData, viewportChanged, children, onClick, scale, apiRef, containerRef: _containerRef }: MapProps) {
    // State rather than a ref: the children below read the map off the context, so its creation has
    // to produce a render or they would only ever see the null it started as.
    const [ map, setMap ] = useState<MapLibreGLMap | null>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => map);
    // What the style this map was last given was made of, which is how the sources and layers on it
    // that are its own are told from the ones a child added. See `keepAdditions`.
    const appliedStyle = useRef<StyleContents>();
    // Whether there is no map to be had here at all — see the catch below.
    const [ unsupported, setUnsupported ] = useState(false);
    // See MapStyleLoaded.
    const [ styleLoaded, setStyleLoaded ] = useState(false);
    // The same answer again as a ref, so applyStyle can read it from whichever closure it is
    // called in, and the style applyStyle is holding until it turns true.
    const styleLoadedRef = useRef(false);
    const pendingStyle = useRef<StyleSpecification | string | null>(null);

    /**
     * Puts a style on the map, carrying what the children added to the last one across — or, while
     * the style already there has not finished loading, holds it instead.
     *
     * MapLibre swaps styles by diffing the new one against the current one, which is what keeps the
     * painted map on screen through the switch. But it cannot diff against a style that is still
     * loading — and every style still is for at least a frame, since even one handed over as plain
     * JSON is only taken up on the next animation frame. Rather than wait that frame out, MapLibre
     * gives up: "Unable to perform style diff" on the console, the whole style torn down, and the
     * map blinking blank until the replacement and its tiles arrive. The vector styles here import
     * asynchronously and routinely resolve inside that first frame, so the blink was a matter of
     * which of the two won.
     *
     * Held styles are applied by the `style.load` listener below, where the diff cannot lose the
     * race. Only the latest is kept — a style overtaken before it was ever applied is a style
     * nobody asked to see.
     */
    function applyStyle(mapInstance: MapLibreGLMap, style: StyleSpecification | string) {
        if (!styleLoadedRef.current) {
            pendingStyle.current = style;
            return;
        }
        mapInstance.setStyle(style, { transformStyle: keepAdditions(appliedStyle.current) });
        appliedStyle.current = typeof style === "string" ? undefined : styleContents(style);
    }

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        const initialStyle = buildSyncStyle(layerData);
        appliedStyle.current = typeof initialStyle === "string" ? undefined : styleContents(initialStyle);

        let mapInstance: MapLibreGLMap;
        try {
            mapInstance = createMap(containerRef.current, initialStyle, toCenter(coordinates), zoom);
        } catch (e) {
            // MapLibre draws through WebGL and has no other way to draw, so a context it cannot get
            // is the end of it: the constructor throws rather than firing the "error" event handled
            // below, and nothing here is ever built. This is not the tile server being unreachable —
            // it is a browser with WebGL turned off, or one whose GPU is unavailable and which will
            // not fall back to software rendering. Say so where the map would have been, since an
            // empty container explains nothing.
            console.warn(`Geo map: ${summarizeMapError(e).message}`);
            setUnsupported(true);
            return;
        }
        setUnsupported(false);

        // Listened for here, in the same breath as the map is built, rather than in an effect of its
        // own: a style begins loading inside the constructor and `style.load` fires once, so a
        // listener attached even one render later can already be too late. Never unlatched — a style
        // that has loaded is followed only by another style loading, and each of those fires again.
        // Also where a style that arrived too early to be applied gets its turn — see applyStyle.
        mapInstance.on("style.load", () => {
            styleLoadedRef.current = true;
            setStyleLoaded(true);

            const held = pendingStyle.current;
            if (held) {
                pendingStyle.current = null;
                applyStyle(mapInstance, held);
            }
        });

        // The attribution stands at the foot of the map beside its scale, rather than in the corner
        // where the zoom buttons now are (see MapToolbar): a bar of buttons is reached for, and it
        // would otherwise sit on top of a line of small print that is itself made of links. On
        // mobile the foot is fully spoken for, so it stands at the head instead — in the leading
        // corner, the trailing one being the detail pane's whenever a marker is open.
        mapInstance.addControl(new AttributionControl(), isMobile() ? "top-left" : "bottom-left");

        // An error MapLibre finds no listener for goes to `console.error` with the stack of the
        // fetch that failed, and a tile server answering 403 fails once per tile: a screenful of
        // identical stacks, none of which says anything the first one did not. Listening takes that
        // over, and what is left is one warning per distinct failure, with no stack on it.
        const reported = new Set<string>();
        mapInstance.on("error", ({ error }: MapErrorEvent) => {
            const { key, message } = summarizeMapError(error);
            if (reported.has(key)) return;
            reported.add(key);
            console.warn(`Geo map: ${message}`);
        });

        // No navigation control of MapLibre's own: the zoom buttons are Trilium's (see MapToolbar),
        // dressed as the image viewer's zoom controls are. No compass either — nothing
        // here persists a bearing, so the button would offer to undo a rotation the map never
        // remembers.
        setMap(mapInstance);

        return () => {
            mapInstance.remove();
            setMap(null);
            setStyleLoaded(false);
            styleLoadedRef.current = false;
            pendingStyle.current = null;
        };
    }, []);

    // React to layer changes. Also runs after the initial map creation, which for the synchronous
    // styles re-applies the style the map was built with (a diff with nothing in it) but loads the
    // asynchronous vector styles for the first time.
    useEffect(() => {
        if (!map) return;

        let cancelled = false;

        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                // Guard against the layer changing again or the map being torn down while the
                // style was still loading.
                if (cancelled) return;
                applyStyle(map, asyncStyle);
            });
        } else {
            applyStyle(map, buildSyncStyle(layerData));
        }

        return () => {
            cancelled = true;
            // A style still being held is this run's; the run for the next layer brings its own.
            pendingStyle.current = null;
        };
    }, [ map, layerData ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!map) return;
        map.setCenter(toCenter(coordinates));
        map.setZoom(zoom);
    }, [ map, coordinates, zoom ]);

    // Viewport callback. MapLibre fires "moveend" for every camera change, including zooming.
    useEffect(() => {
        if (!map) return;

        const updateFn = () => {
            const center = map.getCenter();
            viewportChanged({ lat: center.lat, lng: center.lng }, map.getZoom());
        };
        map.on("moveend", updateFn);

        return () => {
            map.off("moveend", updateFn);
        };
    }, [ map, viewportChanged ]);

    useEffect(() => {
        if (!onClick || !map) return;

        const handler = (e: MapMouseEvent) => onClick(toGeoMouseEvent(e));
        map.on("click", handler);
        return () => { map.off("click", handler); };
    }, [ map, onClick ]);

    // Scale. Miles or kilometres follow the formatting locale, which the option is read for: the
    // unit is resolved inside the effect, so the control has to be rebuilt when that option changes.
    const [ formattingLocale ] = useTriliumOption("formattingLocale");
    useEffect(() => {
        if (!scale || !map) return;
        const scaleControl = new ScaleControl({ unit: getMeasurementSystem() });
        map.addControl(scaleControl);

        return () => {
            // Unless the map has taken it off already, which is what going away amounts to: a map
            // being removed hands every control it holds its notice and forgets them all. This
            // cleanup still runs afterwards — the effect that built the map was written first, so
            // its own cleanup, `map.remove()`, goes first — and MapLibre's `removeControl` asks the
            // control to take itself off whether the map still holds it or not. Told twice, the
            // control reaches for the map it has already let go of, and switching away from a geo
            // map threw where nobody could catch it.
            if (map.hasControl(scaleControl)) {
                map.removeControl(scaleControl);
            }
        };
    }, [ map, scale, formattingLocale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        map?.resize();
    }, [ map, size?.width, size?.height ]);

    // The container stays in place either way: it is what the effect above is handed, so taking it
    // away would leave nothing to build the map in should the component be mounted again.
    return (
        <div
            ref={containerRef}
            className={`geo-map-container ${layerData.isDarkTheme ? "dark" : ""}`}
        >
            {unsupported
                ? <NoItems icon="bx bx-error-circle" text={t("geo-map.webgl-unavailable")} />
                : (
                    <ParentMap.Provider value={map}>
                        <MapStyleLoaded.Provider value={styleLoaded}>
                            {children}
                        </MapStyleLoaded.Provider>
                    </ParentMap.Provider>
                )}
        </div>
    );
}

/**
 * How far the view is leaned over, followed as it changes — by the tilt button, or by Ctrl and a
 * drag, which MapLibre honours without being asked.
 *
 * Read by anything whose answer differs between a flat map and a leaned-over one: which view the
 * tilt button should offer (see {@link MapToolbar} — a tilt entered by hand is as much a 3D view as
 * one the button gave), and whether the buildings are worth standing up (see {@link Buildings}).
 */
export function useMapPitch(map: MapLibreGLMap | null) {
    const [ pitch, setPitch ] = useState<number | null>(null);

    useEffect(() => {
        if (!map) return;

        const report = () => setPitch(map.getPitch());
        // The map may have been tilted between being built and being listened to.
        report();

        map.on("pitch", report);
        return () => { map.off("pitch", report); };
    }, [ map ]);

    return pitch;
}

/**
 * Builds the map itself.
 *
 * Separate from the effect that calls it so that the throw it is wrapped in covers the constructor
 * and nothing else: everything the effect goes on to do is on a map that exists.
 */
function createMap(container: HTMLDivElement, style: StyleSpecification | string, center: [number, number], zoom: number) {
    return new MapLibreGLMap({
        container,
        style,
        center,
        zoom,
        minZoom: 2,
        // No explicit maxBounds: a bounds whose longitude range spans the full world
        // (-180..180) crashes MapLibre — the east edge wraps to -180, collapsing the range
        // to zero width and making the constrain zoom infinite (a singular-matrix null
        // deref). With renderWorldCopies disabled, MapLibre itself constrains panning to a
        // single world (substituting an almost-full-world longitude range that avoids the
        // collapse) and clamps latitude to the Mercator limit, which is the Leaflet-parity
        // behavior we want.
        renderWorldCopies: false,
        // Added by hand by the caller, in the corner opposite the one MapLibre keeps it in.
        attributionControl: false,
        transformRequest: withReferrer
    });
}

/**
 * Names the app to a tile server, which `Referrer-Policy: no-referrer` otherwise keeps from it —
 * OpenStreetMap answers an anonymous request with a refusal drawn into the tile, served as HTTP 200
 * so that nothing here ever sees an error. Given per request, so the rest of the page keeps the
 * policy it is served with; `strict-origin` names no note and says nothing to an insecure server.
 *
 * Nothing to send where the app has no http(s) origin: desktop puts the header back by hand (see
 * `services/referer.ts`), and iOS on `capacitor://` has nowhere to do that yet.
 */
const withReferrer: RequestTransformFunction = (url) => ({ url, referrerPolicy: "strict-origin" });

/** An HTTP failure as MapLibre reports one: what {@link summarizeMapError} reads off an `AJAXError`. */
interface HttpFailure {
    status: number;
    statusText?: string;
    url: string;
}

function isHttpFailure(error: unknown): error is HttpFailure {
    return (
        typeof error === "object" && error !== null &&
        typeof (error as HttpFailure).status === "number" &&
        typeof (error as HttpFailure).url === "string"
    );
}

/**
 * Says in one line what went wrong, and under what to count it as already said.
 *
 * A tile that cannot be fetched is not an error about that tile: the tile server is unreachable, or
 * refuses us, and every other tile it is asked for will fail the same way. The key therefore names
 * the server and the status rather than the URL, so the hundred tiles behind the first one are
 * recognised as the same failure and stay quiet — the URL is still in the message, as an example of
 * what was asked for.
 */
export function summarizeMapError(error: unknown): { key: string; message: string } {
    if (isHttpFailure(error)) {
        const host = hostOf(error.url);
        const status = [ String(error.status), error.statusText ].filter(Boolean).join(" ");
        return {
            key: `${error.status} ${host}`,
            message: `${host} answered ${status} — could not load ${error.url}`
        };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { key: message, message };
}

/** The server a URL names, or the URL itself where it names none. */
function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** What a style is made of, by name — all {@link keepAdditions} needs of the one it is given. */
export interface StyleContents {
    sources: Set<string>;
    layers: Set<string>;
}

/**
 * The names of everything in a style, taken now rather than held onto.
 *
 * MapLibre shallow-copies the style it is handed and goes on to change what it made of it, so a
 * style kept as an object is not necessarily the style that was applied by the time it is read back.
 * The names are all that is wanted anyway.
 */
export function styleContents(style: StyleSpecification): StyleContents {
    return {
        sources: new Set(Object.keys(style.sources)),
        layers: new Set(style.layers.map((layer) => layer.id))
    };
}

/**
 * Carries whatever was put on the outgoing style over to the incoming one.
 *
 * A style is a world of its own, and switching one takes every source and layer on the map with it —
 * including those that were never the style's to begin with. The markers and the GPX tracks live on
 * the style because a map has nowhere else to put them, so switching between a light and a dark map
 * took every marker off it and put them back only once the new style had loaded, which is a network
 * away. Handed over here instead, they are part of the incoming style before it is ever applied, and
 * so are never off the map at all.
 *
 * What was added is what the outgoing style has and the style we applied did not, which is why the
 * latter has to be known: everything else in the outgoing style is the old map itself, and carrying
 * that over would leave it drawn on top of the new one. The additions go last, so they stay above
 * the map rather than under it.
 *
 * An addition that drew from the outgoing style's *own* source is the exception, and is dropped
 * rather than handed on: there is nothing to hand it: see the note where that is decided below.
 *
 * Note that the images a layer draws with are not part of a style and do not come across (see
 * `Markers`, which puts them back on `style.load`) — and that MapLibre applies this whether it can
 * turn one style into the other or has to build the new one from scratch, so nothing here depends on
 * which of the two it chooses.
 *
 * @param applied the style this map was last given, or `undefined` where it is not known — a style
 *                named by URL, whose contents we never see. Nothing is carried over then, and the
 *                additions are put back on `style.load` as they were before.
 */
export function keepAdditions(applied: StyleContents | undefined): TransformStyleFunction {
    return (previous, next) => {
        if (!applied || !previous) return next;

        const sources = { ...next.sources };
        for (const [ id, source ] of Object.entries(previous.sources)) {
            if (!applied.sources.has(id) && !(id in sources)) {
                sources[id] = source;
            }
        }

        const nextLayers = new Set(next.layers.map((layer) => layer.id));
        const layers = [ ...next.layers ];
        for (const layer of previous.layers) {
            if (applied.layers.has(layer.id) || nextLayers.has(layer.id)) continue;
            // An addition drawing from a source that is not in the incoming style and was not
            // carried across either — which means it drew from the outgoing style's own, as the 3D
            // buildings do (see Buildings). Nothing can be done for it here: the source is the map
            // that has just gone, and carrying that over would leave the old map drawn on top of
            // the new one. It has to be left behind rather than handed on broken, because MapLibre
            // validates the whole style before applying any of it — one layer naming a source that
            // is not there and the switch is refused outright, leaving the map on the style the
            // reader has just asked to leave.
            if ("source" in layer && layer.source && !(layer.source in sources)) continue;
            layers.push(layer);
        }

        return { ...next, sources, layers };
    };
}
