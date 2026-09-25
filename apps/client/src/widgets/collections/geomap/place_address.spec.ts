/** An address held in parts: how a street is written, and how few parts place a result. */
import { describe, expect, it } from "vitest";

import { describePlace, formatStreet } from "./place_address";

describe("Place addresses", () => {
    it("writes the number on the side of the street the country writes it", () => {
        expect(formatStreet("25", "Lankwitzer Straße", "de")).toBe("Lankwitzer Straße 25");
        expect(formatStreet("28", "Strada Memorandumului", "ro")).toBe("Strada Memorandumului 28");
        expect(formatStreet("1600", "Pennsylvania Avenue", "us")).toBe("1600 Pennsylvania Avenue");
        expect(formatStreet("10", "Downing Street", "gb")).toBe("10 Downing Street");

        // A country not named reads the way most of the world writes an address.
        expect(formatStreet("7", "Šeříková", "cz")).toBe("Šeříková 7");
        expect(formatStreet("7", "Šeříková", undefined)).toBe("Šeříková 7");
    });

    it("has nothing to write without a road, and writes the road alone without a number", () => {
        expect(formatStreet("25", undefined, "de")).toBeUndefined();
        expect(formatStreet(undefined, "Lankwitzer Straße", "de")).toBe("Lankwitzer Straße");
    });

    it("places a result by its street and its town, leaving out what places nothing", () => {
        // The postcode and the boroughs between are never among the parts.
        expect(describePlace({
            name: "REWE",
            label: "REWE, 19-24, Lankwitzer Straße, Lichterfelde, Steglitz-Zehlendorf, Berlin, 12209, Deutschland",
            address: {
                street: "Lankwitzer Straße 19-24", locality: "Berlin", region: "Berlin",
                country: "Deutschland", countryCode: "de"
            }
        })).toBe("Lankwitzer Straße 19-24, Berlin, Deutschland");
    });

    it("does not place a city inside itself", () => {
        expect(describePlace({
            name: "Berlin",
            label: "Berlin, Deutschland",
            address: { locality: "Berlin", region: "Berlin", country: "Deutschland", countryCode: "de" }
        })).toBe("Deutschland");

        // A country is placed by nothing: it is the last part there is, and it is its own name.
        expect(describePlace({
            name: "Deutschland", label: "Deutschland",
            address: { country: "Deutschland", countryCode: "de" }
        })).toBe("");
    });

    it("falls back on the label where a provider breaks an address into no parts", () => {
        expect(describePlace({ name: "Tokyo", label: "Tokyo, Ōta, Japan" })).toBe("Ōta, Japan");
        expect(describePlace({ name: "Nowhere", label: "Somewhere else" })).toBe("Somewhere else");
    });
});
