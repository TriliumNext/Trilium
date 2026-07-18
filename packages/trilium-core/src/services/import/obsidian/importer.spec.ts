import { describe, expect, it } from "vitest";

import { mapObsidianFrontmatter } from "./importer.js";

describe("mapObsidianFrontmatter", () => {
    it("emits typed value labels and a per-property promoted definition, typed from types.json", () => {
        const types = new Map([
            ["Date", "date"],
            ["Date Time", "datetime"],
            ["Number", "number"],
            ["Checkbox prop", "checkbox"]
        ]);
        const labels = mapObsidianFrontmatter(
            { "Date": "2026-06-27", "Date Time": "2026-06-27T15:10:00", "Number": 5, "Checkbox prop": true, "first": "First value" },
            types
        );

        expect(labels).toEqual([
            { name: "date", value: "2026-06-27" },
            { name: "label:date", value: "promoted,single,date,alias=Date" },
            { name: "dateTime", value: "2026-06-27T15:10" },
            { name: "label:dateTime", value: "promoted,single,datetime,alias=Date Time" },
            { name: "number", value: "5" },
            { name: "label:number", value: "promoted,single,number,alias=Number" },
            { name: "checkboxProp", value: "true" },
            { name: "label:checkboxProp", value: "promoted,single,boolean,alias=Checkbox prop" },
            { name: "first", value: "First value" },
            { name: "label:first", value: "promoted,single,text,alias=first" }
        ]);
    });

    it("treats a list (or a multitext property) as a multi-valued promoted attribute", () => {
        expect(mapObsidianFrontmatter({ List: ["a", "b"] }, new Map([["List", "multitext"]]))).toEqual([
            { name: "list", value: "a" },
            { name: "list", value: "b" },
            { name: "label:list", value: "promoted,multi,text,alias=List" }
        ]);
    });

    it("defaults an unknown property type to text", () => {
        expect(mapObsidianFrontmatter({ foo: "bar" }, new Map())).toEqual([
            { name: "foo", value: "bar" },
            { name: "label:foo", value: "promoted,single,text,alias=foo" }
        ]);
    });

    it("emits only the definition for an empty property (the promoted field shows blank)", () => {
        expect(mapObsidianFrontmatter({ first: null }, new Map())).toEqual([
            { name: "label:first", value: "promoted,single,text,alias=first" }
        ]);
    });

    it("maps each tag to its own label and each alias to an #alias label, with no definitions", () => {
        expect(mapObsidianFrontmatter({ tags: ["Book", "Reading List"], aliases: ["Alias one", "Alias two"] }, new Map())).toEqual([
            { name: "book", value: "" },
            { name: "readingList", value: "" },
            { name: "alias", value: "Alias one" },
            { name: "alias", value: "Alias two" }
        ]);
    });

    it("drops cssclasses, publish and permalink", () => {
        expect(mapObsidianFrontmatter({ cssclasses: ["class1"], publish: true, permalink: "/x" }, new Map())).toEqual([]);
    });
});
