/**
 * The Nominatim geocoder: the request it makes, what it makes of the answer, and the rate its usage
 * policy holds it to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nominatim as provider } from "./nominatim";

/** The locale the app is running in, which a test can settle for itself. */
let language = "pt_br";

vi.mock("../../../services/i18n", () => ({ getCurrentLanguage: () => language }));

/** One entry as Nominatim's `jsonv2` answer carries it. */
function place(overrides: Record<string, unknown> = {}) {
    return {
        place_id: 240109189,
        name: "Berlin",
        osm_type: "relation",
        osm_id: 62422,
        display_name: "Berlin, Germany",
        boundingbox: [ "52.3382448", "52.6755087", "13.0883450", "13.7611609" ],
        lat: "52.5170365",
        lon: "13.3888599",
        ...overrides
    };
}

function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const fetchMock = vi.fn(async (_url: string) => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: "",
        json: async () => body
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** Answers each request in turn, for a search that makes more than one (see the two passes). */
function respondInTurn(bodies: unknown[]) {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string) => ({
        ok: true,
        status: 200,
        statusText: "",
        json: async () => bodies[Math.min(call++, bodies.length - 1)]
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** Runs a search, letting the rate limiter's wait elapse rather than sitting through it. */
async function search(query: string, options?: Parameters<typeof provider.search>[1]) {
    const results = provider.search(query, options);
    await vi.runAllTimersAsync();
    return results;
}

function requestedUrl(fetchMock: ReturnType<typeof respondWith>, call = 0) {
    return new URL(fetchMock.mock.calls[call][0]);
}

beforeEach(() => {
    vi.useFakeTimers();
    language = "pt_br";
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Nominatim geocoding", () => {
    it("asks Nominatim for the query, capped, in the language the app runs in", async () => {
        const fetchMock = respondWith([]);

        await search("berlin");

        const url = requestedUrl(fetchMock);
        expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
        expect(url.searchParams.get("q")).toBe("berlin");
        expect(url.searchParams.get("format")).toBe("jsonv2");
        expect(Number(url.searchParams.get("limit"))).toBeGreaterThan(0);
        // Written as a language tag rather than as Trilium's own locale id.
        expect(url.searchParams.get("accept-language")).toBe("pt-br");
    });

    it("takes the places from the answer, and leaves out any without a readable position", async () => {
        respondWith([
            place(),
            place({ place_id: 2, display_name: "Nowhere", lat: "not a number" }),
            place({ place_id: 3, display_name: undefined }),
            place({
                place_id: 4, name: undefined, display_name: "Paris, France", lat: "48.8566", lon: "2.3522",
                boundingbox: [ "not", "a", "box", "at all" ], osm_type: "node", osm_id: 17807753
            })
        ]);

        expect(await search("anywhere")).toEqual([
            {
                // What OSM calls it, not what Nominatim numbered it.
                id: "R62422", label: "Berlin, Germany", name: "Berlin", lat: 52.5170365, lng: 13.3888599,
                // Written south-north-west-east by Nominatim, and read as MapLibre frames one.
                bounds: [ [ 13.088345, 52.3382448 ], [ 13.7611609, 52.6755087 ] ],
                icon: undefined, address: undefined, outline: expect.any(Function)
            },
            // Named by the leading part of its label, Nominatim having named it nothing itself, and
            // framed by nothing: its extent is unreadable, and a node has no boundary to fetch.
            {
                id: "N17807753", label: "Paris, France", name: "Paris", lat: 48.8566, lng: 2.3522,
                bounds: undefined, icon: undefined, address: undefined, outline: undefined
            }
        ]);
    });

    it("names a house by its street and number, which is what it has instead of a name", async () => {
        // As Nominatim answers for a plain address: no name of its own, and a label led by the number.
        respondWith([ place({
            name: "", osm_type: "way", osm_id: 90,
            display_name: "25, Lankwitzer Straße, Mariendorf, Berlin, 12107, Deutschland",
            address: {
                house_number: "25", road: "Lankwitzer Straße", suburb: "Mariendorf",
                city: "Berlin", state: "Berlin", postcode: "12107",
                country: "Deutschland", country_code: "DE"
            }
        }) ]);

        const [ house ] = await search("lankwitzer strasse 25");
        expect(house.name).toBe("Lankwitzer Straße 25");
        expect(house.address).toEqual({
            street: "Lankwitzer Straße 25", locality: "Berlin", region: "Berlin",
            country: "Deutschland", countryCode: "de"
        });
    });

    it("asks for the address in parts", async () => {
        const fetchMock = respondWith([]);
        await search("berlin");
        expect(requestedUrl(fetchMock).searchParams.get("addressdetails")).toBe("1");
    });

    it("carries the kind of place through, for the icon it is drawn with", async () => {
        respondWith([
            place({ category: "shop", type: "supermarket", addresstype: "shop" }),
            place({ osm_id: 62423, display_name: "Berlin, Germany, the city", category: "boundary", type: "administrative", addresstype: "city" })
        ]);

        const [ shop, city ] = await search("berlin");
        expect(shop.icon).toBe("bx bx-cart");
        expect(city.icon).toBe("bx bx-buildings");
    });

    it("reports a refused request rather than answering with no places", async () => {
        respondWith([], { ok: false, status: 429 });

        // The expectation is attached before the timers run, so the rejection is never loose.
        const refused = expect(provider.search("berlin")).rejects.toThrow("429");
        await vi.runAllTimersAsync();
        await refused;
    });

    it("asks what the map is showing first, then the wider world", async () => {
        const inSibiu = place({ osm_type: "node", osm_id: 1, name: "Jumbo", display_name: "Jumbo, Sibiu, Romania" });
        const inTheUnitedStates = place({ osm_type: "node", osm_id: 2, name: "Jumbo", display_name: "Jumbo, Ohio, USA" });
        const fetchMock = respondInTurn([ [ inSibiu ], [ inTheUnitedStates, inSibiu ] ]);

        const results = await search("jumbo", { viewport: [ [ 23, 45 ], [ 25, 47 ] ] });

        // Restricted to the view first: a viewbox alone is only a nudge next to how well known a
        // place is, so a shop in Sibiu would otherwise stay under every Jumbo in the United States.
        const nearby = requestedUrl(fetchMock, 0).searchParams;
        // Two opposite corners, longitude first, as Nominatim reads a preferred area.
        expect(nearby.get("viewbox")).toBe("23,45,25,47");
        expect(nearby.get("bounded")).toBe("1");

        // Then unrestricted, so a place nowhere near the map is still found.
        const elsewhere = requestedUrl(fetchMock, 1).searchParams;
        expect(elsewhere.get("viewbox")).toBe("23,45,25,47");
        expect(elsewhere.get("bounded")).toBeNull();

        // What is at hand comes first, and is not offered twice for being in both answers.
        expect(results.map((result) => result.label)).toEqual([
            "Jumbo, Sibiu, Romania",
            "Jumbo, Ohio, USA"
        ]);
    });

    it("searches the town around a view of one neighbourhood, not the neighbourhood alone", async () => {
        const fetchMock = respondWith([]);

        // A few streets of Sibiu, some 500 m across.
        await search("jumbo", { viewport: [ [ 24.147, 45.796 ], [ 24.153, 45.800 ] ] });

        const [ west, south, east, north ] = (requestedUrl(fetchMock).searchParams.get("viewbox") ?? "")
            .split(",").map(Number);

        // Grown about the same middle rather than shifted off it.
        expect((west + east) / 2).toBeCloseTo(24.15, 4);
        expect((south + north) / 2).toBeCloseTo(45.798, 4);

        // Wide enough to hold the town: a degree of latitude is about 111 km, so 25 km either way of
        // the middle is a little over 0.2 degrees.
        expect(north - south).toBeGreaterThan(0.4);
        // Longitude is shorter this far north, so the box is wider in degrees than it is tall.
        expect(east - west).toBeGreaterThan(north - south);
    });

    it("offers a place once, however many ways the two passes name it", async () => {
        const shop = { osm_type: "node", osm_id: 5, name: "Jumbo", display_name: "Jumbo, Sibiu, Romania" };
        const fetchMock = respondInTurn([
            // Nominatim's own numbering differs between the instances the public service runs behind,
            // so the same shop comes back under two place ids.
            [ place({ ...shop, place_id: 111 }) ],
            [
                place({ ...shop, place_id: 222 }),
                // The building around the shop: another OSM object under the same name and address.
                place({ ...shop, place_id: 333, osm_type: "way", osm_id: 6 })
            ]
        ]);

        const results = await search("jumbo", { viewport: [ [ 23, 45 ], [ 25, 47 ] ] });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(results.map((result) => result.id)).toEqual([ "N5" ]);
    });

    it("does not go looking further afield where the view already fills the list", async () => {
        const local = Array.from({ length: 8 }, (_, index) => place({ place_id: index, display_name: `Jumbo ${index}` }));
        const fetchMock = respondInTurn([ local, [] ]);

        const results = await search("jumbo", { viewport: [ [ 23, 45 ], [ 25, 47 ] ] });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(results).toHaveLength(8);
    });

    it("asks once, from nowhere in particular, where the view says nothing usable", async () => {
        const fromNowhere = respondWith([]);
        await search("jumbo");
        expect(fromNowhere).toHaveBeenCalledOnce();
        expect(requestedUrl(fromNowhere).searchParams.get("viewbox")).toBeNull();

        // Panned across the antimeridian, where the view runs the other way round and no pair of
        // corners describes it.
        const wrapped = respondWith([]);
        await search("jumbo", { viewport: [ [ 170, 39.5 ], [ -170, 39.8 ] ] });
        expect(wrapped).toHaveBeenCalledOnce();
        expect(requestedUrl(wrapped).searchParams.get("viewbox")).toBeNull();
    });

    it("fetches the boundary of a place on its own, simplified, only when it is asked for", async () => {
        const fetchMock = respondWith([ place() ]);
        const [ berlin ] = await search("berlin");
        expect(fetchMock).toHaveBeenCalledOnce();

        const boundary: GeoJSON.Geometry = { type: "MultiPolygon", coordinates: [] };
        const lookup = respondWith([ { geojson: boundary } ]);
        const outlineFetch = berlin.outline?.();
        await vi.runAllTimersAsync();

        expect(await outlineFetch).toEqual(boundary);
        expect(requestedUrl(lookup).searchParams.get("osm_ids")).toBe("R62422");
    });

    it("simplifies a boundary by what the place itself measures", async () => {
        // A city is wider than the cap, and is drawn as coarsely as anything is.
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");
        const cityLookup = respondWith([ {} ]);
        berlin.outline?.();
        await vi.runAllTimersAsync();
        expect(requestedUrl(cityLookup).searchParams.get("polygon_threshold")).toBe("0.001000");

        // A building measures tens of metres across, where that cap would flatten it to a triangle.
        respondWith([ place({
            osm_type: "way",
            osm_id: 90,
            boundingbox: [ "52.5170000", "52.5172000", "13.3888000", "13.3891000" ]
        }) ]);
        const [ shop ] = await search("shop");
        const buildingLookup = respondWith([ {} ]);
        shop.outline?.();
        await vi.runAllTimersAsync();
        expect(requestedUrl(buildingLookup).searchParams.get("polygon_threshold")).toBe("0.000002");

        // A place Nominatim gave no readable extent for is drawn as coarsely as a country.
        respondWith([ place({ boundingbox: undefined }) ]);
        const [ unmeasured ] = await search("somewhere");
        const unmeasuredLookup = respondWith([ {} ]);
        unmeasured.outline?.();
        await vi.runAllTimersAsync();
        expect(requestedUrl(unmeasuredLookup).searchParams.get("polygon_threshold")).toBe("0.001000");
    });

    it("draws no boundary for a shape that is not one", async () => {
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");

        // A point is what the pin already says; there is nothing to ring.
        respondWith([ { geojson: { type: "Point", coordinates: [ 13.4, 52.5 ] } } ]);
        const outlineFetch = berlin.outline?.();
        await vi.runAllTimersAsync();

        expect(await outlineFetch).toBeNull();
    });

    it("asks for no language in particular where the app has settled on none", async () => {
        language = "";
        const fetchMock = respondWith([]);

        await search("berlin");

        expect(requestedUrl(fetchMock).searchParams.get("accept-language")).toBeNull();
    });

    it("names a town and a region by whichever kind of place fills that role", async () => {
        respondWith([
            // A village has no city, and a county stands in for a state where a country has none.
            place({ address: { village: "Rasinari", county: "Sibiu", country: "Romania", country_code: "RO" } })
        ]);

        const [ result ] = await search("rasinari");

        expect(result.address).toMatchObject({
            locality: "Rasinari",
            region: "Sibiu",
            country: "Romania",
            // Lowercased, a flag being looked up by it.
            countryCode: "ro"
        });
    });

    it("holds no address for a result Nominatim broke into no parts of one", async () => {
        // Distinct places: two that read the same are one answer, and only one survives.
        respondWith([
            place({ address: {} }),
            place({ osm_id: 63, display_name: "Elsewhere", address: undefined })
        ]);

        const results = await search("nowhere");

        expect(results.map((result) => result.address)).toEqual([ undefined, undefined ]);
    });

    it("falls back to Nominatim's numbering, and then to the position, to tell a place apart", async () => {
        respondWith([
            // No OSM object named at all, so its own numbering is all there is to go on.
            place({ osm_type: undefined, osm_id: undefined, place_id: 111, display_name: "One" }),
            // A kind of object without the id of one, which names nothing either.
            place({ osm_type: "node", osm_id: undefined, place_id: 222, display_name: "Two" }),
            // Not even that, and what is left is where it stands.
            place({
                osm_type: undefined, osm_id: undefined, place_id: undefined,
                display_name: "Three", lat: "1.5", lon: "2.5"
            })
        ]);

        const results = await search("anywhere");

        expect(results.map((result) => result.id)).toEqual([ "111", "222", "1.5,2.5" ]);
        // None of them can be asked for a boundary: that wants an OSM object to look up.
        expect(results.map((result) => result.outline)).toEqual([ undefined, undefined, undefined ]);
    });

    it("frames nothing for a place whose extent runs the other way round the world", async () => {
        // Reported west of east, which as a rectangle is the whole world the long way round.
        respondWith([ place({ boundingbox: [ "-18", "-16", "177", "-179" ] }) ]);

        const [ result ] = await search("fiji");

        expect(result.bounds).toBeUndefined();
    });

    it("reports a refused boundary lookup rather than drawing nothing quietly", async () => {
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");

        respondWith([], { ok: false, status: 429 });
        const refused = expect(berlin.outline?.()).rejects.toThrow("429");
        await vi.runAllTimersAsync();
        await refused;
    });

    it("holds searches to the one request a second the usage policy allows", async () => {
        const requestedAt: number[] = [];
        vi.stubGlobal("fetch", vi.fn(async () => {
            requestedAt.push(Date.now());
            return { ok: true, status: 200, statusText: "", json: async () => [] };
        }));

        const first = provider.search("berlin");
        const second = provider.search("paris");
        await vi.runAllTimersAsync();
        await Promise.all([ first, second ]);

        expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(1000);
    });

    it("moves the requests behind a boundary lookup up when it is given up on", async () => {
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");

        const requestedAt: number[] = [];
        vi.stubGlobal("fetch", vi.fn(async () => {
            requestedAt.push(Date.now());
            return { ok: true, status: 200, statusText: "", json: async () => [] };
        }));

        // A lookup between two searches, given up on before its slot comes up — which is what
        // stepping onto another result does.
        const first = provider.search("paris");
        const abandoned = new AbortController();
        const outline = berlin.outline?.(abandoned.signal);
        const second = provider.search("rome");
        abandoned.abort();

        await vi.runAllTimersAsync();
        await Promise.all([ first, second ]);

        expect(await outline).toBeNull();
        // The searches, a second apart: the lookup neither goes out nor is waited out.
        expect(requestedAt).toHaveLength(2);
        expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(1000);
        expect(requestedAt[1] - requestedAt[0]).toBeLessThan(2000);
    });

    it("gives up a boundary lookup already out without reporting it as a failure", async () => {
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");

        // Never answers of its own accord, so the lookup is still out when it is given up on.
        vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })));

        const request = new AbortController();
        const outline = berlin.outline?.(request.signal);
        await vi.runAllTimersAsync();
        request.abort();

        expect(await outline).toBeNull();
    });
});
