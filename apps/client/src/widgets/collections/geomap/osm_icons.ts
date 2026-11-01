/**
 * The icon a place found by searching wears, taken from how OpenStreetMap classifies it.
 *
 * The tables here speak OSM's vocabulary, which is what geocoders built on OSM data report — see
 * nominatim.ts, the only caller. A geocoder classifying places its own way, by Maki icon name or by
 * a list of Google place types, maps that vocabulary itself and fills in `GeoSearchResult.icon`.
 *
 * OSM describes a place with a key and a value — `shop`=`supermarket`, `natural`=`volcano` — which a
 * geocoder passes on as a category and a type. Every administrative area from a hamlet to a country
 * shares one pair, `boundary`=`administrative`, so what tells those apart is the address type the
 * geocoder works out alongside it.
 *
 * A pair the tables below do not name is still drawn by its category, a shop as a shop; what not even
 * that claims is left without an icon, for the caller to fall back on DEFAULT_PLACE_ICON.
 */

/** How a geocoder classifies a place, in the terms OpenStreetMap uses. */
export interface OsmClassification {
    /** The OSM key: `shop`, `amenity`, `natural`, `boundary`. */
    category?: string;
    /** The OSM value: `supermarket`, `restaurant`, `volcano`, `administrative`. */
    type?: string;
    /**
     * What kind of address the place is: `city`, `country`, `road`, `shop`. Worked out by the
     * geocoder rather than tagged in OSM, so one that reports no such thing leaves it out.
     */
    addressType?: string;
}

/**
 * The boxicons class for a place, from the most specific of its classifications that is known, or
 * nothing where none of them says what kind of place it is.
 *
 * The address type is read before the bare category so that a city is drawn as a city rather than as
 * the boundary it is filed under.
 */
export function placeIcon({ category, type, addressType }: OsmClassification): string | undefined {
    const icon = BY_CATEGORY_AND_TYPE[`${category}/${type}`]
        ?? BY_ADDRESS_TYPE[addressType ?? ""]
        ?? BY_CATEGORY[category ?? ""];

    return icon ? `bx ${icon}` : undefined;
}

/** What a place is, where its own kind is worth drawing: `<key>/<value>`, as OSM tags it. */
const BY_CATEGORY_AND_TYPE: Record<string, string> = {
    "shop/supermarket": "bx-cart",
    "shop/convenience": "bx-basket",
    "shop/bakery": "bx-cake",
    "shop/mall": "bx-shopping-bag",
    "shop/department_store": "bx-shopping-bag",

    "amenity/restaurant": "bx-restaurant",
    "amenity/fast_food": "bx-bowl-hot",
    "amenity/cafe": "bx-coffee",
    "amenity/bar": "bx-beer",
    "amenity/pub": "bx-beer",
    "amenity/biergarten": "bx-beer",
    "amenity/bank": "bx-money",
    "amenity/atm": "bx-credit-card",
    "amenity/pharmacy": "bx-plus-medical",
    "amenity/hospital": "bx-clinic",
    "amenity/clinic": "bx-clinic",
    "amenity/doctors": "bx-clinic",
    "amenity/school": "bx-book",
    "amenity/kindergarten": "bx-book",
    "amenity/college": "bx-book",
    "amenity/university": "bx-book",
    "amenity/library": "bx-library",
    "amenity/police": "bx-shield",
    "amenity/fire_station": "bx-first-aid",
    "amenity/post_office": "bx-envelope",
    "amenity/fuel": "bx-gas-pump",
    "amenity/parking": "bxs-parking",
    "amenity/place_of_worship": "bx-church",
    "amenity/cinema": "bx-movie",
    "amenity/theatre": "bx-movie",
    "amenity/bus_station": "bx-bus",

    "tourism/hotel": "bx-hotel",
    "tourism/motel": "bx-hotel",
    "tourism/hostel": "bx-hotel",
    "tourism/guest_house": "bx-hotel",
    "tourism/apartment": "bx-hotel",
    "tourism/museum": "bx-library",
    "tourism/gallery": "bx-palette",
    "tourism/artwork": "bx-palette",
    "tourism/camp_site": "bx-leaf",

    "leisure/park": "bx-leaf",
    "leisure/garden": "bx-leaf",
    "leisure/nature_reserve": "bx-leaf",
    "leisure/pitch": "bx-football",
    "leisure/stadium": "bx-football",
    "leisure/sports_centre": "bx-football",
    "leisure/swimming_pool": "bx-swim",
    "leisure/fitness_centre": "bx-dumbbell",

    "natural/peak": "bx-landscape",
    "natural/volcano": "bx-landscape",
    "natural/water": "bx-water",
    "natural/bay": "bx-water",
    "natural/spring": "bx-water",
    "natural/wood": "bx-leaf",
    "natural/tree": "bx-leaf",
    "natural/beach": "bx-sun",

    "railway/station": "bx-train",
    "railway/halt": "bx-train",
    "railway/tram_stop": "bx-train",
    "railway/subway_entrance": "bx-train",

    "highway/bus_stop": "bx-bus",
    "highway/footway": "bx-walk",
    "highway/path": "bx-walk",
    "highway/pedestrian": "bx-walk",
    "highway/cycleway": "bx-cycling",

    "aeroway/aerodrome": "bx-paper-plane",
    "aeroway/terminal": "bx-paper-plane"
};

/** How big a place is, for the areas OSM files under one category and type. */
const BY_ADDRESS_TYPE: Record<string, string> = {
    "continent": "bx-world",
    "country": "bx-flag",
    "state": "bx-map-alt",
    "province": "bx-map-alt",
    "region": "bx-map-alt",
    "county": "bx-map-alt",
    "district": "bx-map-alt",
    "municipality": "bx-map-alt",
    "island": "bx-landscape",
    "islet": "bx-landscape",
    "city": "bx-buildings",
    "town": "bx-buildings",
    "village": "bx-home-alt",
    "hamlet": "bx-home-alt",
    "isolated_dwelling": "bx-home-alt",
    "borough": "bx-building-house",
    "city_district": "bx-building-house",
    "suburb": "bx-building-house",
    "neighbourhood": "bx-building-house",
    "quarter": "bx-building-house",
    "road": "bx-directions",
    "house": "bx-home",
    "building": "bx-home",
    "residential": "bx-home",
    "postcode": "bx-envelope"
};

/** What a place broadly is, for a kind too rare to name above. */
const BY_CATEGORY: Record<string, string> = {
    "shop": "bx-store",
    "amenity": "bx-building",
    "tourism": "bx-camera",
    "leisure": "bx-football",
    "natural": "bx-leaf",
    "waterway": "bx-water",
    "highway": "bx-directions",
    "railway": "bx-train",
    "aeroway": "bx-paper-plane",
    "building": "bx-building",
    "historic": "bx-library",
    "office": "bx-briefcase",
    "craft": "bx-wrench",
    "man_made": "bx-wrench",
    "healthcare": "bx-plus-medical",
    "military": "bx-shield",
    "emergency": "bx-first-aid",
    "landuse": "bx-map-alt",
    "boundary": "bx-map-alt"
};
