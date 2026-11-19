import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getNamespaces, requestCatalogues, takeCatalogue } from "./catalogue_requests";

describe("catalogue requests", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        window.glob.assetPath = "assets/v1";
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify({ url })));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads the app and entry catalogues for the app, and only entry before it", () => {
        expect(getNamespaces("app")).toEqual([ "translation", "entry" ]);
        expect(getNamespaces("entry")).toEqual([ "entry" ]);
    });

    it("hands over the requests it started, once each, and fetches what it did not start", async () => {
        requestCatalogues("de", "app");
        expect(fetchMock.mock.calls.map(([ url ]) => url)).toEqual([
            "assets/v1/translations/de/translation.json",
            "assets/v1/translations/de/entry.json"
        ]);

        expect(await takeCatalogue("de", "translation")).toEqual({ url: "assets/v1/translations/de/translation.json" });
        expect(await takeCatalogue("de", "entry")).toEqual({ url: "assets/v1/translations/de/entry.json" });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // A language picked later, as the setup wizard does, is fetched when asked for.
        expect(await takeCatalogue("fr", "entry")).toEqual({ url: "assets/v1/translations/fr/entry.json" });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("reads the English catalogues for English RTL, which has none of its own", async () => {
        requestCatalogues("en_rtl", "entry");
        expect(await takeCatalogue("en_rtl", "entry")).toEqual({ url: "assets/v1/translations/en/entry.json" });
        expect(await takeCatalogue("en_rtl", "translation")).toEqual({ url: "assets/v1/translations/en/translation.json" });
    });

    it("reports a catalogue the server does not have, and only to whoever takes it", async () => {
        fetchMock.mockImplementation(async () => new Response("missing", { status: 404, statusText: "Not Found" }));
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);

        try {
            requestCatalogues("xx", "entry");
            await new Promise((resolve) => setTimeout(resolve));
            expect(unhandled).not.toHaveBeenCalled();

            await expect(takeCatalogue("xx", "entry")).rejects.toThrow(/xx\/entry.json.*404/);
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });
});
