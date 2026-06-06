import { describe, expect, it } from "vitest";

import type FAttribute from "../entities/fattribute.js";
import noteAttributeCache from "./note_attribute_cache.js";

describe("noteAttributeCache", () => {
    it("starts with an attributes map and clears it on invalidate", () => {
        // The constructor initializes `attributes` to a plain object.
        expect(noteAttributeCache.attributes).toBeTypeOf("object");

        // Seed a cached entry, then ensure invalidate() resets the map to empty.
        const fakeAttribute = { name: "color" } as unknown as FAttribute;
        noteAttributeCache.attributes["someNote"] = [fakeAttribute];
        expect(noteAttributeCache.attributes["someNote"]).toEqual([fakeAttribute]);

        noteAttributeCache.invalidate();

        expect(noteAttributeCache.attributes).toEqual({});
        expect(noteAttributeCache.attributes["someNote"]).toBeUndefined();
    });
});
