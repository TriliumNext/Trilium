import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../options.js", () => ({
    default: {
        getOptionOrNull: vi.fn()
    }
}));

vi.mock("../log.js", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn()
    }
}));

import optionService from "../options.js";
import {
    clearSearchProviderCache,
    getConfiguredSearchProviders,
    getFirstSearchProvider,
    getSearchProvider,
    hasConfiguredSearchProviders
} from "./index.js";

const getOption = vi.mocked(optionService.getOptionOrNull);

describe("search_providers registry", () => {
    beforeEach(() => {
        clearSearchProviderCache();
        getOption.mockReset();
    });
    afterEach(() => {
        getOption.mockReset();
    });

    it("returns [] and reports no providers when option is empty", () => {
        getOption.mockReturnValue(null);
        expect(getConfiguredSearchProviders()).toEqual([]);
        expect(hasConfiguredSearchProviders()).toBe(false);
        expect(getFirstSearchProvider()).toBeNull();
    });

    it("returns [] gracefully on malformed JSON", () => {
        getOption.mockReturnValue("not json{");
        expect(getConfiguredSearchProviders()).toEqual([]);
        expect(getFirstSearchProvider()).toBeNull();
    });

    it("parses a configured Exa provider and instantiates it", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "exa_1", name: "Exa", provider: "exa", apiKey: "k" }
        ]));

        const first = getFirstSearchProvider();
        expect(first).not.toBeNull();
        expect(first?.name).toBe("Exa");
    });

    it("returns the requested provider when looked up by id", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "tav_1", name: "Tavily", provider: "tavily", apiKey: "tk" },
            { id: "exa_1", name: "Exa", provider: "exa", apiKey: "ek" }
        ]));

        const byId = getSearchProvider("exa_1");
        expect(byId?.name).toBe("Exa");

        const first = getSearchProvider();
        expect(first?.name).toBe("Tavily");
    });

    it("returns null when the configured provider type is unknown", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "mystery_1", name: "Mystery", provider: "mystery", apiKey: "k" }
        ]));

        expect(getFirstSearchProvider()).toBeNull();
    });

    it("caches instantiated providers across calls", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "exa_1", name: "Exa", provider: "exa", apiKey: "k" }
        ]));

        const a = getFirstSearchProvider();
        const b = getFirstSearchProvider();
        expect(a).toBe(b);
    });

    it("clearSearchProviderCache forces re-instantiation", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "exa_1", name: "Exa", provider: "exa", apiKey: "k" }
        ]));

        const a = getFirstSearchProvider();
        clearSearchProviderCache();
        const b = getFirstSearchProvider();
        expect(a).not.toBe(b);
    });

    it("returns null rather than throwing when a provider fails to instantiate (missing key)", () => {
        getOption.mockReturnValue(JSON.stringify([
            { id: "exa_bad", name: "Bad Exa", provider: "exa", apiKey: "" }
        ]));

        expect(getFirstSearchProvider()).toBeNull();
    });
});
