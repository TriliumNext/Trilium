/**
 * What a map's coordinates are: places on the Earth, or pixels on an image.
 *
 * MapLibre knows only longitude and latitude, so everything on the map is held in `[lng, lat]`
 * whichever it is. A {@link MapSpace} converts at the edge, where a position is read off a note's
 * label or written back onto one: a geo map stores `#geolocation` and `#geoShape` in degrees, an
 * image map `#imagePosition` and `#imageShape` in the image's own pixels (see {@link imageSpace}).
 */

import { GEO_LOCATION_ATTRIBUTE, GEO_SHAPE_ATTRIBUTE, IMAGE_POSITION_ATTRIBUTE, IMAGE_SHAPE_ATTRIBUTE } from "@triliumnext/commons";
import { MercatorCoordinate } from "maplibre-gl";
import { createContext } from "preact";

import type { Bounds } from "./coordinates";
import { CIRCLE_SEGMENTS, type GeoShape, parseGeoShape, readShape, serializeGeoShape, shapeRing, writeShape } from "./shapes";

export interface MapSpace {
    kind: "geo" | "image";
    /** The label a marker note stores its position in. */
    locationAttribute: string;
    /** The label a shape note stores its geometry in. */
    shapeAttribute: string;
    /** A position label's value as `[lng, lat]`, or `null` where it names none. */
    parseLocation(value: string | null | undefined): [number, number] | null;
    /** A `[lng, lat]` position as its label value. */
    serializeLocation(point: [number, number]): string;
    /** A `[lng, lat]` position as it is shown, or with `full` as it is copied. */
    formatLocation(point: [number, number], full?: boolean): string;
    /** A shape label's value in `[lng, lat]`, or `null` where it spells none. */
    parseShape(value: string | null | undefined): GeoShape | null;
    /** A shape in `[lng, lat]` as its label value. */
    serializeShape(shape: GeoShape): string;
}

/** Note-like enough to read a label from, which is all the helpers below need. */
interface LabelSource {
    getLabelValue(name: string): string | null;
}

export const geoSpace: MapSpace = {
    kind: "geo",
    locationAttribute: GEO_LOCATION_ATTRIBUTE,
    shapeAttribute: GEO_SHAPE_ATTRIBUTE,
    parseLocation,
    serializeLocation: ([ lng, lat ]) => [ lat, lng ].join(","),
    formatLocation: (point, full) => formatLocation(point, full ? FULL_PRECISION : undefined),
    parseShape: (value) => value ? parseGeoShape(value) : null,
    serializeShape: serializeGeoShape
};

/** The space a map is drawn in, handed down by the view so every layer reads the same one. */
export const MapSpaceContext = createContext<MapSpace>(geoSpace);

/** Where the note stands on a map in this space, as `[lng, lat]`, or `null` for nowhere. */
export function locationOf(note: LabelSource, space: MapSpace) {
    return space.parseLocation(note.getLabelValue(space.locationAttribute));
}

/** The shape the note draws on a map in this space, or `null` for none. */
export function shapeOf(note: LabelSource, space: MapSpace) {
    return space.parseShape(note.getLabelValue(space.shapeAttribute));
}

/**
 * Whether the note is drawn on the map as a shape, which is what a readable geometry label means.
 * Asked wherever a shape is offered something different from a marker, such as having no pin to
 * move (see DetailPane and ContextMenus).
 */
export function isShapeNote(note: LabelSource, space: MapSpace): boolean {
    return !!shapeOf(note, space);
}

/** `lat,lng` as the label stores it, as the `[lng, lat]` GeoJSON wants, or `null` if unreadable. */
export function parseLocation(location: string | null | undefined): [number, number] | null {
    if (!location) return null;

    const [ lat, lng ] = location.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return [ lng, lat ];
}

/**
 * A place as it is written and as the label stores it — latitude first — from the `[lng, lat]`
 * {@link parseLocation} yields and MapLibre reports.
 *
 * Six decimals name a spot to within a stride, which is as fine as anything is pointed out on a map.
 * The full stored value is worth having when it is being carried somewhere else, so what is copied
 * asks for every digit rather than what was read.
 */
export function formatLocation([ lng, lat ]: [number, number], precision = 6) {
    return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

/** Enough decimals to give back whatever a geo label holds, the map writing a float's worth. */
const FULL_PRECISION = 15;

/** The natural size of the image an image map is drawn over. */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * Where the image stands in MapLibre's world: its top-left corner, and how much of the world its
 * longer side spans, both in Mercator units (the world being 0–1 each way).
 *
 * Half the world, in the middle, leaves a quarter of it on every side for the camera's bounds (see
 * {@link ImageSpace.maxBounds}), and keeps the image clear of the ±180° seam, which `boundsOf` and
 * MapLibre's own bounds both treat specially.
 */
const IMAGE_ORIGIN = 0.25;
const IMAGE_EXTENT = 0.5;

/** How far past the image the camera can be taken, as a share of the image's longer side. */
const IMAGE_MARGIN = 0.25;

/** How many zoom levels past the image's own resolution the camera can go. */
const IMAGE_OVERZOOM = 2;

/** The decimals a pixel coordinate keeps: a hundredth of a pixel is finer than any click lands. */
const PIXEL_DECIMALS = 2;

export interface ImageSpace extends MapSpace {
    kind: "image";
    /** The image's corners as an image source wants them: top-left, top-right, bottom-right,
     *  bottom-left. */
    corners: [[number, number], [number, number], [number, number], [number, number]];
    /** The box the image fills, for the camera to be fitted to. */
    bounds: Bounds;
    /** The box the camera is kept inside: the image and a margin around it. */
    maxBounds: Bounds;
    /** The deepest zoom worth having: a few levels past the one that draws a pixel per pixel. */
    maxZoom: number;
}

/**
 * The space of a map drawn over an image of the given size, which stores pixels measured from the
 * image's top-left corner, `x` to the right and `y` downwards.
 *
 * The image is laid onto MapLibre's world in Mercator units rather than degrees. Mercator units are
 * what MapLibre draws in, so a pixel maps to them linearly and the image is drawn without the
 * stretching that latitude would put on it. MapTiler's image viewer places its images the same way.
 */
export function imageSpace({ width, height }: ImageSize): ImageSpace {
    const longerSide = Math.max(width, height);
    const unitsPerPixel = IMAGE_EXTENT / longerSide;

    function toLngLat([ x, y ]: [number, number]): [number, number] {
        const { lng, lat } = new MercatorCoordinate(
            IMAGE_ORIGIN + x * unitsPerPixel,
            IMAGE_ORIGIN + y * unitsPerPixel
        ).toLngLat();
        return [ lng, lat ];
    }

    function toPixel([ lng, lat ]: [number, number]): [number, number] {
        const { x, y } = MercatorCoordinate.fromLngLat({ lng, lat });
        return [
            roundPixel((x - IMAGE_ORIGIN) / unitsPerPixel),
            roundPixel((y - IMAGE_ORIGIN) / unitsPerPixel)
        ];
    }

    const margin = longerSide * IMAGE_MARGIN;
    const [ west, north ] = toLngLat([ -margin, -margin ]);
    const [ east, south ] = toLngLat([ width + margin, height + margin ]);
    const topLeft = toLngLat([ 0, 0 ]);
    const bottomRight = toLngLat([ width, height ]);

    return {
        kind: "image",
        locationAttribute: IMAGE_POSITION_ATTRIBUTE,
        shapeAttribute: IMAGE_SHAPE_ATTRIBUTE,
        corners: [ topLeft, toLngLat([ width, 0 ]), bottomRight, toLngLat([ 0, height ]) ],
        bounds: [ [ topLeft[0], bottomRight[1] ], [ bottomRight[0], topLeft[1] ] ],
        maxBounds: [ [ west, south ], [ east, north ] ],
        // MapLibre's world is 512 pixels across at zoom 0, and doubles with each level.
        maxZoom: Math.log2(longerSide / (IMAGE_EXTENT * 512)) + IMAGE_OVERZOOM,

        parseLocation(value) {
            const point = parsePixel(value);
            return point && toLngLat(point);
        },
        serializeLocation: (point) => toPixel(point).join(","),
        formatLocation(point, full) {
            const [ x, y ] = toPixel(point);
            return full ? `${x}, ${y}` : `${Math.round(x)}, ${Math.round(y)}`;
        },

        parseShape(value) {
            const written = value ? readShape(value) : null;
            if (!written) return null;

            if (written.type === "circle") {
                const [ centerPixel ] = written.points;
                const center = toLngLat(centerPixel);
                return {
                    type: "circle",
                    center,
                    // Exact at the centre, which is all a radius in meters can be on a flat image.
                    radiusMeters: written.radius * unitsPerPixel
                        / MercatorCoordinate.fromLngLat({ lng: center[0], lat: center[1] }).meterInMercatorCoordinateUnits(),
                    ring: pixelCircle(centerPixel, written.radius).map(toLngLat)
                };
            }

            return { type: written.type, coordinates: written.points.map(toLngLat) };
        },

        serializeShape(shape) {
            if (shape.type === "circle") {
                // Read back off the ring rather than the radius in meters, so a circle keeps the
                // size it was drawn at wherever on the image it stands.
                const ring = shapeRing(shape).map(toPixel);
                const center = meanPoint(ring);
                const radius = ring.reduce((sum, point) => sum + Math.hypot(point[0] - center[0], point[1] - center[1]), 0) / ring.length;
                return writeShape({ type: "circle", points: [ center.map(roundPixel) as [number, number] ], radius: roundPixel(radius) });
            }

            return writeShape({ type: shape.type, points: shape.coordinates.map(toPixel) });
        }
    };
}

/** `x,y` as an image label stores it, or `null` if unreadable. */
function parsePixel(value: string | null | undefined): [number, number] | null {
    if (!value) return null;

    const [ x, y ] = value.split(",", 2).map((part) => parseFloat(part));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return [ x, y ];
}

function roundPixel(value: number) {
    return Number(value.toFixed(PIXEL_DECIMALS));
}

/** A circle on the image as a ring of pixels, without the closing repeat. */
function pixelCircle([ x, y ]: [number, number], radius: number): [number, number][] {
    const ring: [number, number][] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const angle = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
        ring.push([ x + radius * Math.cos(angle), y + radius * Math.sin(angle) ]);
    }
    return ring;
}

function meanPoint(points: [number, number][]): [number, number] {
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point[0];
        y += point[1];
    }
    return [ x / points.length, y / points.length ];
}
