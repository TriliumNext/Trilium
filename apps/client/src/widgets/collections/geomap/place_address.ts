/**
 * A place's address broken into the parts worth showing, and how those parts are put back together.
 *
 * A geocoder answers with the whole address written out — house number, street, quarter, borough,
 * city, postcode, country — which is more than a row of a result list can hold and more than a reader
 * needs to tell two places apart. Held in parts, the address can be named by its street and placed by
 * its town without the postcode and the boroughs in between.
 *
 * The parts themselves are what any geocoder reports, under whatever keys it uses; mapping its keys
 * onto these is the provider's own work (see nominatim.ts).
 */

/** A place's address, in the parts a result is named and placed by. */
export interface PlaceAddress {
    /** The street and its number, in the order the country writes them (see {@link formatStreet}). */
    street?: string;
    /** The town the place stands in: a city, a town, a village, or the nearest thing to one. */
    locality?: string;
    /** The state, province or county around that town, which is what tells two towns of one name apart. */
    region?: string;
    /** The country's name, in the language the search was made in. */
    country?: string;
    /** The country's ISO 3166-1 alpha-2 code, lowercased — `de`, `ro`, `us`. */
    countryCode?: string;
}

/**
 * The street line of an address: a road and the number on it, or nothing where there is no road.
 *
 * Which side the number goes is a matter of where the place is rather than of what language the app
 * runs in — a Berlin address reads `Lankwitzer Straße 25` to every reader there is. Most of the world
 * writes the number after the street, so that is what a country not named below gets.
 */
export function formatStreet(houseNumber: string | undefined, road: string | undefined, countryCode?: string) {
    if (!road) {
        return undefined;
    }
    if (!houseNumber) {
        return road;
    }

    return NUMBER_BEFORE_STREET.has(countryCode ?? "")
        ? `${houseNumber} ${road}`
        : `${road} ${houseNumber}`;
}

/**
 * Where a place stands, said in as few parts as tell it from another of the same name.
 *
 * The street, the town, the region around it and the country — dropping the postcode and the quarters
 * and boroughs between them, which place nothing for a reader. A part that repeats what the place is
 * already called is dropped as well, so a city named `Berlin` is placed in `Deutschland` rather than
 * in `Berlin, Berlin, Deutschland`.
 *
 * The whole label, less the name at the front of it, for a provider that reports no parts at all.
 */
export function describePlace({ name, label, address }: { name: string; label: string; address?: PlaceAddress }) {
    if (!address) {
        const rest = label.startsWith(name) ? label.slice(name.length) : label;
        return rest.replace(/^[\s,]+/, "");
    }

    const parts: string[] = [];
    for (const part of [ address.street, address.locality, address.region, address.country ]) {
        if (part && part !== name && part !== parts[parts.length - 1]) {
            parts.push(part);
        }
    }

    return parts.join(", ");
}

/**
 * The countries that write the number before the street.
 *
 * Kept to the ones whose convention is not in doubt; a country left out reads the other way round,
 * which is what most of the world does and what a wrong guess should fall back on.
 */
const NUMBER_BEFORE_STREET = new Set([
    "au", "ca", "fr", "gb", "hk", "ie", "in", "my", "nz", "ph", "sg", "th", "us", "za"
]);
