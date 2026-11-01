import { describe, expect, it } from "vitest";

import { parseGpxStats, readTrackLines } from "./gpx";

/** One degree of longitude on the equator, which the distance assertions are stated in. */
const DEGREE_M = (Math.PI / 180) * 6371000;

function gpx(body: string) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">${body}</gpx>`;
}

describe("readTrackLines", () => {
    function read(body: string) {
        return readTrackLines(new DOMParser().parseFromString(gpx(body), "application/xml"));
    }

    it("keeps a paused track whole, and splits one whose recording leapt", () => {
        const tracks = read(`
            <trk><name>Sunday</name>
                <trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg>
                <trkseg><trkpt lat="0" lon="0.011"/><trkpt lat="0" lon="0.02"/></trkseg>
                <trkseg><trkpt lat="0" lon="1"/><trkpt lat="0" lon="1.01"/></trkseg>
            </trk>
        `);

        // The second segment resumes ~110 m on — a pause, one journey still, its segments kept
        // apart within it. The third leaps ~110 km — a drive nobody logged — and what follows is a
        // journey of its own, keeping the track's name.
        expect(tracks).toEqual([
            { name: "Sunday", lines: [ [ [ 0, 0 ], [ 0.01, 0 ] ], [ [ 0.011, 0 ], [ 0.02, 0 ] ] ] },
            { name: "Sunday", lines: [ [ [ 1, 0 ], [ 1.01, 0 ] ] ] }
        ]);
    });

    it("reads each track and route as a journey of its own, named where the file names one", () => {
        const tracks = read(`
            <trk><name>Out</name><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>
            <trk><trkseg><trkpt lat="2" lon="2"/></trkseg></trk>
            <rte><name>Planned</name><rtept lat="3" lon="3"/></rte>
        `);

        expect(tracks).toEqual([
            { name: "Out", lines: [ [ [ 1, 1 ] ] ] },
            { name: undefined, lines: [ [ [ 2, 2 ] ] ] },
            { name: "Planned", lines: [ [ [ 3, 3 ] ] ] }
        ]);
    });
});

describe("parseGpxStats", () => {
    it("counts the pieces and sums the distance within segments, not across the gaps", () => {
        const stats = parseGpxStats(gpx(`
            <wpt lat="1" lon="1"/>
            <wpt lon="broken"/>
            <trk><name>Morning ride</name>
                <trkseg>
                    <trkpt lat="0" lon="0"/>
                    <trkpt lat="0" lon="0.01"/>
                    <trkpt lat="0" lon="0.02"/>
                </trkseg>
                <trkseg>
                    <trkpt lat="0" lon="1"/>
                    <trkpt lat="0" lon="1.01"/>
                </trkseg>
            </trk>
            <rte>
                <rtept lat="0" lon="2"/>
                <rtept lat="0" lon="2.01"/>
            </rte>
        `));

        expect(stats).not.toBeNull();
        expect(stats).toMatchObject({
            trackCount: 1,
            routeCount: 1,
            segmentCount: 2,
            pointCount: 7,
            name: "Morning ride"
        });
        // The waypoint without a position is not counted.
        expect(stats?.waypoints).toHaveLength(1);
        // 0.02° within the first segment, 0.01° within the second, 0.01° along the route — and
        // nothing for the ~1° gaps between them, which were not travelled.
        expect(stats?.distance).toBeCloseTo(0.04 * DEGREE_M, -1);
        expect(stats?.elevation).toBeUndefined();
        expect(stats?.time).toBeUndefined();

        // Each journey also answers for itself — the track split at its ~1° leap into the two runs
        // the map would flag, sharing the name, and the route alone.
        expect(stats?.journeys).toHaveLength(3);
        expect(stats?.journeys[0]).toMatchObject({ kind: "track", name: "Morning ride" });
        expect(stats?.journeys[0].distance).toBeCloseTo(0.02 * DEGREE_M, -1);
        expect(stats?.journeys[1]).toMatchObject({ kind: "track", name: "Morning ride" });
        expect(stats?.journeys[1].distance).toBeCloseTo(0.01 * DEGREE_M, -1);
        expect(stats?.journeys[2].kind).toBe("route");
        expect(stats?.journeys[2].name).toBeUndefined();
        expect(stats?.journeys[2].distance).toBeCloseTo(0.01 * DEGREE_M, -1);
    });

    it("keeps a track one journey across a stroll of a gap, and splits it at a leap", () => {
        const nearGap = parseGpxStats(gpx(`<trk>
            <trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg>
            <trkseg><trkpt lat="0" lon="0.003"/><trkpt lat="0" lon="0.004"/></trkseg>
        </trk>`));
        // ~220 m between the segments: a pause, not a journey's end.
        expect(nearGap?.journeys).toHaveLength(1);
        expect(nearGap?.journeys[0].distance).toBeCloseTo(0.002 * DEGREE_M, -1);

        const farGap = parseGpxStats(gpx(`<trk><name>Commute</name>
            <trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg>
            <trkseg><trkpt lat="0" lon="0.03"/><trkpt lat="0" lon="0.031"/></trkseg>
        </trk>`));
        // ~3 km between them: two runs, sharing the track's name — as the map flags them.
        expect(farGap?.journeys.map((journey) => journey.name)).toEqual([ "Commute", "Commute" ]);
        expect(farGap?.journeys[0].distance).toBeCloseTo(0.001 * DEGREE_M, -1);
        expect(farGap?.journeys[1].distance).toBeCloseTo(0.001 * DEGREE_M, -1);
    });

    it("reads elevation extremes and accumulates gain/loss through the noise window", () => {
        const track = [ 100, 102, 100, 110, 108, 120, 90 ]
            .map((elevation, i) => `<trkpt lat="0" lon="${i * 0.001}"><ele>${elevation}</ele></trkpt>`)
            .join("");
        const stats = parseGpxStats(gpx(`<trk><trkseg>${track}</trkseg></trk>`));

        // The ±2 m wobbles sit inside the 5 m hysteresis window and count for nothing; the real
        // climbs (100→110→120) and the drop to 90 do.
        expect(stats?.elevation).toMatchObject({ min: 90, max: 120, gain: 20, loss: 30 });

        const profile = stats?.elevation?.profile ?? [];
        expect(profile).toHaveLength(7);
        expect(profile[0]).toEqual({ distance: 0, elevation: 100 });
        expect(profile[6].elevation).toBe(90);
        // Distance along the profile grows monotonically.
        for (let i = 1; i < profile.length; i++) {
            expect(profile[i].distance).toBeGreaterThan(profile[i - 1].distance);
        }
    });

    it("does not carry the elevation anchor across a segment gap", () => {
        const stats = parseGpxStats(gpx(`<trk>
            <trkseg>
                <trkpt lat="0" lon="0"><ele>100</ele></trkpt>
                <trkpt lat="0" lon="0.001"><ele>110</ele></trkpt>
            </trkseg>
            <trkseg>
                <trkpt lat="0" lon="1"><ele>500</ele></trkpt>
                <trkpt lat="0" lon="1.001"><ele>510</ele></trkpt>
            </trkseg>
        </trk>`));

        // 10 m climbed in each segment; the 390 m between them happened off the record.
        expect(stats?.elevation).toMatchObject({ gain: 20, loss: 0, min: 100, max: 510 });
    });

    it("reads the travel time from track points alone — not from extensions, not from routes", () => {
        const stats = parseGpxStats(gpx(`<trk><trkseg>
            <trkpt lat="0" lon="0"><time>2024-06-01T10:00:00Z</time></trkpt>
            <trkpt lat="0" lon="0.01"><extensions><time>1999-01-01T00:00:00Z</time></extensions></trkpt>
            <trkpt lat="0" lon="0.02"><time>2024-06-01T11:30:00Z</time></trkpt>
        </trkseg></trk>
        <rte>
            <rtept lat="0" lon="1"><time>2001-06-02T03:26:55Z</time></rtept>
            <rtept lat="0" lon="1.01"><time>2001-11-28T21:05:28Z</time></rtept>
        </rte>`));

        // The route's timestamps say when its points were authored, months apart (as in the GPX
        // spec's own fells_loop sample) — counting them would report a journey of half a year.
        expect(stats?.time?.start.toISOString()).toBe("2024-06-01T10:00:00.000Z");
        expect(stats?.time?.end.toISOString()).toBe("2024-06-01T11:30:00.000Z");
        expect(stats?.time?.duration).toBe(90 * 60 * 1000);
    });

    it("reports no time at all for a routes-only file, however timestamped", () => {
        const stats = parseGpxStats(gpx(`<rte>
            <rtept lat="0" lon="0"><time>2001-06-02T03:26:55Z</time></rtept>
            <rtept lat="0" lon="0.01"><time>2001-11-28T21:05:28Z</time></rtept>
        </rte>`));
        expect(stats?.time).toBeUndefined();
    });

    it("prefers the metadata name and description over the first track's", () => {
        const stats = parseGpxStats(gpx(`
            <metadata><name>The file</name><desc>All of it</desc></metadata>
            <trk><name>First track</name><desc>Only part</desc><trkseg><trkpt lat="0" lon="0"/></trkseg></trk>
        `));
        expect(stats).toMatchObject({ name: "The file", description: "All of it" });
    });

    it("reads the name a GPX 1.0 file keeps directly on the root, having no metadata", () => {
        const stats = parseGpxStats(`<?xml version="1.0"?>
<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
    <name>Fells loop</name><desc>A ramble</desc>
    <wpt lat="42.4" lon="-71.1"><name>Crossing</name></wpt>
</gpx>`);
        expect(stats).toMatchObject({ name: "Fells loop", description: "A ramble", waypoints: [ { name: "Crossing" } ] });
    });

    it("lists the waypoints — a desc kept only where it says more than the name", () => {
        const stats = parseGpxStats(gpx(`
            <wpt lat="1" lon="1"><name>5236BRIDGE</name><desc>Bridge</desc><ele>89.9</ele></wpt>
            <wpt lat="2" lon="2"><name>5066</name><desc>5066</desc></wpt>
            <wpt lat="3" lon="3"/>
        `));
        expect(stats?.waypoints).toEqual([
            { name: "5236BRIDGE", description: "Bridge", elevation: 89.9 },
            // The desc repeating the name is dropped; a bare point still counts as a waypoint.
            { name: "5066" },
            {}
        ]);
    });

    it("reads points sitting outside any segment or route, as the map does", () => {
        const stats = parseGpxStats(gpx(`<trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/>`));
        expect(stats?.pointCount).toBe(2);
        expect(stats?.distance).toBeCloseTo(0.01 * DEGREE_M, -1);
        expect(stats?.journeys).toHaveLength(1);
        expect(stats?.journeys[0].kind).toBe("track");
    });

    it("decimates a long profile while keeping its ends and its extremes", () => {
        const points = Array.from({ length: 2000 }, (_, i) => {
            // A gentle slope with one sharp summit in the middle of a bucket.
            const elevation = i === 1111 ? 9999 : 100 + i * 0.01;
            return `<trkpt lat="0" lon="${i * 0.0001}"><ele>${elevation}</ele></trkpt>`;
        }).join("");
        const stats = parseGpxStats(gpx(`<trk><trkseg>${points}</trkseg></trk>`));

        const profile = stats?.elevation?.profile ?? [];
        expect(profile.length).toBeLessThan(600);
        expect(profile[0].elevation).toBe(100);
        expect(profile[profile.length - 1].elevation).toBeCloseTo(100 + 1999 * 0.01, 5);
        // The summit survives decimation.
        expect(profile.some((sample) => sample.elevation === 9999)).toBe(true);
        for (let i = 1; i < profile.length; i++) {
            expect(profile[i].distance).toBeGreaterThanOrEqual(profile[i - 1].distance);
        }
    });

    it("returns zeroed stats for well-formed XML with no points, and null for junk", () => {
        expect(parseGpxStats(gpx(""))).toMatchObject({ pointCount: 0, waypoints: [], distance: 0 });
        expect(parseGpxStats("this is not xml at all <")).toBeNull();
    });
});
