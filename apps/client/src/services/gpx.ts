/**
 * Reads a GPX file into the numbers a preview can show — how far it goes, how much it climbs, when
 * it was travelled and what it is made of — and into the lines the map draws (see
 * {@link readTrackLines}). Pure parsing and arithmetic over the XML — nothing here touches the map
 * or the app, so the whole module is unit-testable.
 */

/** What marks a note as a GPX track: the mime its file carries. */
export const GPX_MIME = "application/gpx+xml";

export interface GpxElevationSample {
    /** Metres travelled from the start of the track to this point. */
    distance: number;
    /** Metres of elevation at that point. */
    elevation: number;
}

/** One of the journeys a GPX file holds — a track or a route — as a listing shows it. */
export interface GpxJourney {
    kind: "track" | "route";
    /** What the file calls this journey, where it names one. */
    name?: string;
    /** Metres along this journey's lines alone. */
    distance: number;
}

/** A named place the file marks beside its lines — only what a listing shows of one. */
export interface GpxWaypoint {
    name?: string;
    /** The `<desc>`, kept only where it says more than the name — tools often write the name into
     *  both, and a listing that repeats each name twice says nothing. */
    description?: string;
    /** Metres, when the waypoint carries one. */
    elevation?: number;
}

export interface GpxStats {
    /** What the file calls itself (its metadata, else its first track or route) — which may well
     *  differ from the note's title, typically a file name. */
    name?: string;
    description?: string;
    trackCount: number;
    routeCount: number;
    segmentCount: number;
    /** Track and route points that carry a readable position. */
    pointCount: number;
    /** The file's tracks and routes in file order, each with the metres it draws — split at leaps
     *  the same way the map splits them (see {@link readTrackLines}), so a track whose recording
     *  jumped a kilometre lists as the separate runs the map flags, under the one name they share. */
    journeys: GpxJourney[];
    /** The file's waypoints that carry a readable position, in file order. */
    waypoints: GpxWaypoint[];
    /** Metres travelled, summed within each segment and route. The jumps between segments are not
     *  counted: a track is split exactly where it stopped being recorded, so whatever ground lies
     *  between two segments was not travelled on this track. */
    distance: number;
    /** Absent when no point carries an elevation. */
    elevation?: {
        min: number;
        max: number;
        gain: number;
        loss: number;
        /** The track flattened to elevation-over-distance, decimated for drawing. */
        profile: GpxElevationSample[];
    };
    /** Absent when no track point carries a timestamp. Read from track points alone: a track was
     *  recorded, so its times are a journey — a route was planned, and the times its points carry
     *  (when tools write any, as the GPX spec's own sample does) say when each point was authored,
     *  which totalled up would report a "journey" of months. */
    time?: {
        start: Date;
        end: Date;
        /** Milliseconds from the first timestamp to the last. */
        duration: number;
    };
}

/**
 * The numbers a GPX file amounts to, or `null` for input that is not XML at all. A file that
 * parses but holds no points comes back with zeroed counts — whether that is worth showing is the
 * caller's call.
 */
export function parseGpxStats(xml: string): GpxStats | null {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xml, "application/xml");
    } catch {
        return null;
    }
    // Browsers report a broken document as a document containing the error, not by throwing.
    if (doc.querySelector("parsererror")) {
        return null;
    }

    const root = doc.documentElement;
    const journeys = readJourneys(doc);

    const stats: GpxStats = {
        name: readMetadataOrFirst(root, "name"),
        description: readMetadataOrFirst(root, "desc"),
        trackCount: doc.querySelectorAll("trk").length,
        routeCount: doc.querySelectorAll("rte").length,
        segmentCount: doc.querySelectorAll("trkseg").length,
        pointCount: journeys.reduce((count, journey) => count + journey.segments.reduce((n, segment) => n + segment.length, 0), 0),
        journeys: [],
        waypoints: readWaypoints(doc),
        distance: 0
    };

    const profile: GpxElevationSample[] = [];
    let min = Infinity;
    let max = -Infinity;
    let gain = 0;
    let loss = 0;
    let start = Infinity;
    let end = -Infinity;

    for (const journey of journeys) {
        let journeyDistance = 0;

        for (const segment of journey.segments) {
            // The reference an elevation change is measured against, reset per segment: climbing
            // that happened in the gap between two segments was not climbed on this track.
            let anchor: number | undefined;

            for (const [ index, point ] of segment.entries()) {
                if (index > 0) {
                    journeyDistance += haversine(segment[index - 1], point);
                }

                if (point.elevation !== undefined) {
                    profile.push({ distance: stats.distance + journeyDistance, elevation: point.elevation });
                    min = Math.min(min, point.elevation);
                    max = Math.max(max, point.elevation);

                    // Gain and loss accumulate through a hysteresis window rather than point to
                    // point: GPS elevation jitters by a few metres either way, and summing every
                    // wobble reports a mountain climbed on a walk around the block.
                    if (anchor === undefined) {
                        anchor = point.elevation;
                    } else if (point.elevation - anchor >= ELEVATION_NOISE_M) {
                        gain += point.elevation - anchor;
                        anchor = point.elevation;
                    } else if (anchor - point.elevation >= ELEVATION_NOISE_M) {
                        loss += anchor - point.elevation;
                        anchor = point.elevation;
                    }
                }

                if (point.time !== undefined) {
                    start = Math.min(start, point.time);
                    end = Math.max(end, point.time);
                }
            }
        }

        stats.journeys.push({ kind: journey.kind, ...(journey.name ? { name: journey.name } : {}), distance: journeyDistance });
        stats.distance += journeyDistance;
    }

    if (profile.length > 0) {
        stats.elevation = { min, max, gain, loss, profile: decimate(profile) };
    }
    if (start <= end) {
        stats.time = { start: new Date(start), end: new Date(end), duration: end - start };
    }

    return stats;
}

/** One of the journeys a GPX file holds — a `<trk>` or a `<rte>` — as the map draws it. */
export interface GpxTrackLines {
    /** What the file calls this track or route, where it names one. */
    name?: string;
    /** One line per segment of a track, kept apart where the recording stopped; a route is one line. */
    lines: [number, number][][];
}

/**
 * The lines a GPX file draws, one entry per journey — a file may hold several, and each is flagged,
 * named and focused for itself (see GpxTrack and the pane's camera in DetailPane), where flattening
 * them strung one journey's flags across another's ground.
 *
 * A journey is a track or a route, but not always whole: a track whose recording leaps is split at
 * the leap (see {@link splitAtJumps}), since the runs either side of it read on the map as the
 * separate lines they are. The entries share the track's name.
 *
 * Points that name no readable position are dropped. A line of one point is kept: it draws nothing,
 * but it is still where a journey began or ended, which is what the marks are placed from. A file
 * whose points sit outside any track or route is not one the GPX schema allows, but it used to draw
 * as a single line here and there is no reason to stop drawing it — the fallback is only reached
 * when the reading above it found nothing, so a well-formed file never takes it.
 */
export function readTrackLines(doc: Document): GpxTrackLines[] {
    const tracks: GpxTrackLines[] = [];

    for (const container of doc.querySelectorAll("trk, rte")) {
        const lines = container.localName === "rte"
            ? [ readCoordinates(container.querySelectorAll("rtept")) ]
            : [ ...container.querySelectorAll("trkseg") ].map((segment) => readCoordinates(segment.querySelectorAll("trkpt")));

        const name = childText(container, "name")?.trim() || undefined;
        for (const run of splitAtJumps(lines.filter((line) => line.length > 0), ([ lon, lat ]) => ({ lat, lon }))) {
            tracks.push({ name, lines: run });
        }
    }

    if (tracks.length === 0) {
        const points = readCoordinates(doc.querySelectorAll("trkpt, rtept"));
        if (points.length > 0) {
            tracks.push({ lines: [ points ] });
        }
    }

    return tracks;
}

/**
 * How far a track may leap between two of its segments and still be one journey, in metres.
 *
 * A pause resumes more or less where it stopped — a traffic light, a lunch, a lost signal — and
 * two runs a stroll apart are one line to the eye as well as one journey in fact. A leap of
 * kilometres is a drive nobody logged: the runs either side of it draw as separate lines, and a
 * journey whose start flag stands on one line and end flag on another reads as a relationship
 * between two places that nothing on the map connects.
 */
const JOURNEY_JUMP_M = 1000;

/** One track's segments grouped into contiguous runs, split wherever the recording leapt further
 *  than {@link JOURNEY_JUMP_M} — each run one journey's worth of lines. Generic over the point,
 *  since the map splits bare coordinates and the stats split points carrying elevation and time —
 *  and both must split at the same places, or the preview would list journeys the map does not
 *  draw. */
function splitAtJumps<T>(lines: T[][], positionOf: (point: T) => { lat: number; lon: number }): T[][][] {
    const runs: T[][][] = [];
    let current: T[][] = [];

    for (const line of lines) {
        const lastLine = current[current.length - 1];
        const previous = lastLine?.[lastLine.length - 1];
        if (previous && haversine(positionOf(previous), positionOf(line[0])) > JOURNEY_JUMP_M) {
            runs.push(current);
            current = [];
        }
        current.push(line);
    }

    if (current.length > 0) {
        runs.push(current);
    }
    return runs;
}

/**
 * The `[lng, lat]` GeoJSON wants, for each element that carries a readable pair. One that cannot
 * say where it is is skipped rather than defaulted: falling back to zero put it in the Gulf of
 * Guinea and ran the line out to it and back.
 */
export function readCoordinates(points: Iterable<Element>): [number, number][] {
    const coordinates: [number, number][] = [];

    for (const point of points) {
        const lat = parseFloat(point.getAttribute("lat") ?? "");
        const lon = parseFloat(point.getAttribute("lon") ?? "");
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        coordinates.push([ lon, lat ]);
    }

    return coordinates;
}

/** How much a point's elevation must move, in metres, before it counts as climbing rather than as
 *  the few metres of jitter GPS elevation always carries. */
const ELEVATION_NOISE_M = 5;

/** How many buckets the elevation profile is decimated into for drawing. Each bucket keeps its
 *  lowest and its highest point, so a decimated profile can double this in samples — plenty for a
 *  chart, while a summit or a dip is never averaged away. */
const PROFILE_BUCKETS = 250;

const EARTH_RADIUS_M = 6371000;

interface GpxPoint {
    lat: number;
    lon: number;
    /** Metres, from the point's `<ele>` child when it carries a readable one. */
    elevation?: number;
    /** Epoch milliseconds, from the point's `<time>` child when it carries a readable one. */
    time?: number;
}

/** A journey's points still grouped by segment, which is what the stats walk. */
interface GpxJourneyPoints {
    kind: "track" | "route";
    name?: string;
    segments: GpxPoint[][];
}

/**
 * The point runs a GPX file is made of, one entry per journey with the track's segments kept
 * apart — grouped and split exactly the way {@link readTrackLines} groups the drawn lines: a track
 * whose recording leaps further than {@link JOURNEY_JUMP_M} between segments is split at the leap,
 * so the runs the stats list are the very ones the map flags. Includes the same fallback for
 * schema-less files whose points sit outside any track or route.
 */
function readJourneys(doc: Document): GpxJourneyPoints[] {
    const journeys: GpxJourneyPoints[] = [];

    for (const container of doc.querySelectorAll("trk, rte")) {
        const kind = container.localName === "rte" ? "route" : "track";
        const segments = (kind === "route"
            ? [ readPoints(container.querySelectorAll("rtept"), { withTime: false }) ]
            : [ ...container.querySelectorAll("trkseg") ].map((segment) => readPoints(segment.querySelectorAll("trkpt")))
        ).filter((segment) => segment.length > 0);

        const name = childText(container, "name")?.trim();
        for (const run of splitAtJumps(segments, (point) => point)) {
            journeys.push({ kind, ...(name ? { name } : {}), segments: run });
        }
    }

    if (journeys.length === 0) {
        const points = readPoints(doc.querySelectorAll("trkpt, rtept"));
        if (points.length > 0) {
            journeys.push({ kind: "track", segments: [ points ] });
        }
    }

    return journeys;
}

/**
 * Each point that carries a readable position; one that cannot say where it is is skipped.
 * `withTime: false` leaves the timestamps unread — what a route's points carry is authoring
 * time, not travel time (see the note on {@link GpxStats.time}).
 */
function readPoints(elements: Iterable<Element>, { withTime = true } = {}): GpxPoint[] {
    const points: GpxPoint[] = [];

    for (const element of elements) {
        const lat = parseFloat(element.getAttribute("lat") ?? "");
        const lon = parseFloat(element.getAttribute("lon") ?? "");
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const point: GpxPoint = { lat, lon };

        const elevation = parseFloat(childText(element, "ele") ?? "");
        if (Number.isFinite(elevation)) {
            point.elevation = elevation;
        }

        if (withTime) {
            const time = Date.parse(childText(element, "time") ?? "");
            if (Number.isFinite(time)) {
                point.time = time;
            }
        }

        points.push(point);
    }

    return points;
}

/** The file's waypoints as a listing shows them, skipping any that cannot say where they are. */
function readWaypoints(doc: Document): GpxWaypoint[] {
    const waypoints: GpxWaypoint[] = [];

    for (const element of doc.querySelectorAll("wpt")) {
        const [ point ] = readPoints([ element ], { withTime: false });
        if (!point) continue;

        const waypoint: GpxWaypoint = {};
        const name = childText(element, "name")?.trim();
        if (name) {
            waypoint.name = name;
        }
        const description = childText(element, "desc")?.trim();
        if (description && description !== name) {
            waypoint.description = description;
        }
        if (point.elevation !== undefined) {
            waypoint.elevation = point.elevation;
        }
        waypoints.push(waypoint);
    }

    return waypoints;
}

/** What the file calls the given field: its metadata's (kept directly on the root in GPX 1.0,
 *  which had no `<metadata>`), else its first track's or route's. */
function readMetadataOrFirst(root: Element, name: string): string | undefined {
    for (const container of [ childNamed(root, "metadata"), root, childNamed(root, "trk"), childNamed(root, "rte") ]) {
        const text = container && childText(container, name)?.trim();
        if (text) {
            return text;
        }
    }
    return undefined;
}

/**
 * A direct child's text, matched by local name so a namespaced document reads the same as a bare
 * one — and only a direct child, so a `<time>` buried in a point's `<extensions>` (heart rate and
 * the like travel there) is not mistaken for the point's own. Exported for the map, which reads a
 * waypoint's `<name>` the same way to title its mark (see GpxTrack).
 */
export function childText(element: Element, name: string): string | undefined {
    return childNamed(element, name)?.textContent ?? undefined;
}

function childNamed(element: Element, name: string): Element | undefined {
    for (const child of element.children) {
        if (child.localName === name) {
            return child;
        }
    }
    return undefined;
}

/** The great-circle metres between two points, which is what "distance travelled" sums. */
function haversine(a: GpxPoint, b: GpxPoint): number {
    const toRadians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRadians;
    const dLon = (b.lon - a.lon) * toRadians;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(a.lat * toRadians) * Math.cos(b.lat * toRadians) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * The profile thinned to what a chart can use, by keeping each bucket's lowest and highest sample
 * rather than every Nth: a stride would average a summit away, and a chart of thousands of points
 * buys no more pixels than one of hundreds. The first and last samples always survive, so the
 * profile still spans the whole track.
 */
function decimate(profile: GpxElevationSample[]): GpxElevationSample[] {
    if (profile.length <= PROFILE_BUCKETS * 2) {
        return profile;
    }

    const out: GpxElevationSample[] = [ profile[0] ];
    const bucketSize = profile.length / PROFILE_BUCKETS;

    for (let bucket = 0; bucket < PROFILE_BUCKETS; bucket++) {
        const from = Math.max(1, Math.floor(bucket * bucketSize));
        const to = Math.min(profile.length - 1, Math.floor((bucket + 1) * bucketSize));

        let lowest = -1;
        let highest = -1;
        for (let i = from; i < to; i++) {
            if (lowest < 0 || profile[i].elevation < profile[lowest].elevation) lowest = i;
            if (highest < 0 || profile[i].elevation > profile[highest].elevation) highest = i;
        }

        if (lowest >= 0) {
            for (const index of lowest === highest ? [ lowest ] : [ Math.min(lowest, highest), Math.max(lowest, highest) ]) {
                out.push(profile[index]);
            }
        }
    }

    out.push(profile[profile.length - 1]);
    return out;
}
