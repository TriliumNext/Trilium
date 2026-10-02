import { beforeEach, describe, expect, it } from "vitest";

import { fakeRequestProvider } from "../../test/request_provider.js";
import { initRequest } from "../request.js";
import { encodeUtf8 } from "../utils/binary.js";
import { readSearchResults, searchPackages } from "./npm_registry.js";

/** The registry's answer for the next fetch, and the URLs it was asked for. */
let answer: { body: string; status?: number };
let requested: string[];

beforeEach(() => {
    answer = { body: JSON.stringify({ objects: [] }) };
    requested = [];

    initRequest(fakeRequestProvider({
        fetchResource: async (url) => {
            requested.push(url);
            const status = answer.status ?? 200;
            return {
                status,
                ok: status >= 200 && status < 300,
                contentType: "application/json",
                bytes: encodeUtf8(answer.body)
            };
        }
    }));
});

describe("searchPackages", () => {
    it("asks the registry for a page of matches", async () => {
        answer = {
            body: JSON.stringify({
                objects: [
                    { package: { name: "cheerio", version: "1.2.0", description: "Parses HTML" } },
                    { package: { name: "gulp-cheerio", version: "1.0.0" } }
                ]
            })
        };

        const results = await searchPackages("  cheerio  ");

        expect(requested).toEqual(["https://registry.npmjs.org/-/v1/search?text=cheerio&size=10"]);
        expect(results).toEqual([
            { name: "cheerio", version: "1.2.0", description: "Parses HTML" },
            { name: "gulp-cheerio", version: "1.0.0" }
        ]);
    });

    it("escapes the query and honours a private registry", async () => {
        await searchPackages("@scope/pkg is nice", { origin: "https://registry.example/" });

        expect(requested).toEqual([
            "https://registry.example/-/v1/search?text=%40scope%2Fpkg%20is%20nice&size=10"
        ]);
    });

    it("refuses an empty query without asking anything", async () => {
        await expect(searchPackages("   ")).rejects.toThrow(/something to search for/);
        expect(requested).toEqual([]);
    });

    it("reports a registry that answers with an error", async () => {
        answer = { body: "nope", status: 503 };
        await expect(searchPackages("cheerio")).rejects.toThrow(/HTTP 503/);
    });
});

describe("readSearchResults", () => {
    it("keeps only entries naming a package and a version", () => {
        const body = JSON.stringify({
            objects: [
                { package: { name: "ok", version: "1.0.0" } },
                { package: { name: "no-version" } },
                { package: { version: "1.0.0" } },
                { package: { name: "bad-types", version: 3 } },
                { notAPackage: true },
                null
            ]
        });

        expect(readSearchResults(body)).toEqual([{ name: "ok", version: "1.0.0" }]);
    });

    it("refuses an answer that is not a search result", () => {
        for (const body of ["not json", "[]", "{}", JSON.stringify({ objects: "cheerio" })]) {
            expect(() => readSearchResults(body), body).toThrow(/not a search result/);
        }
    });
});
