import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { decodeBase64 } from "../../utils/binary.js";
import { dumpObjectSpace } from "./one_debug.js";
import { type ObjectSpace, type OneObject, parseOneSection, type Property, type PropertyValue, PT } from "./one_parser.js";

const dir = dirname(fileURLToPath(import.meta.url));

describe("dumpObjectSpace", () => {
    it("emits every object and property keyed by raw id, naming only what the parser knows", () => {
        // RichEditTextUnicode (a property the importer reads) next to an id that isn't in the PROP table —
        // the unnamed one is the case that matters: that's where a future feature's data would live.
        const dump = dumpObjectSpace(space({
            "OBJ:1": object(0x0006000e, [
                prop(PROP_ID_RICH_TEXT, PT.LengthPrefixedData, { data: utf16("hello") }),
                prop(0x00001234, PT.FourBytes, { num: 42 })
            ]),
            "OBJ:2": object(0x00ffffff, [])
        }));

        expect(dump.spaceId).toBe("SPACE:1");
        expect(dump.objects.map((o) => o.id)).toEqual(["OBJ:1", "OBJ:2"]);

        const [known, unknown] = dump.objects;
        expect(known).toMatchObject({ jcid: "0x0006000e", name: "RichTextNode" });
        // An unrecognised jcid is still dumped, just without a name.
        expect(unknown).toMatchObject({ jcid: "0x00ffffff" });
        expect(unknown.name).toBeUndefined();

        expect(known.props[0]).toMatchObject({ id: "0x1c001c22", name: "RichEditTextUnicode", type: "LengthPrefixedData" });
        expect(known.props[1]).toMatchObject({ id: "0x14001234", type: "FourBytes", num: 42 });
        expect(known.props[1].name).toBeUndefined();
    });

    it("resolves reference properties in declaration order, including inside nested property sets", () => {
        // The object's id array is flat: each reference property consumes the next N entries, and a nested
        // property set's references are drawn from the same array — so a mis-threaded cursor would
        // mis-attribute every reference after the first.
        const dump = dumpObjectSpace(space({
            "OBJ:1": object(
                0x0006000c,
                [
                    prop(PROP_ID_ELEMENT_CHILDREN, PT.ArrayOfObjectIDs, { refCount: 2 }),
                    prop(0x00000010, PT.PropertySet, { props: { props: [prop(0x00000011, PT.ObjectID, { refCount: 1 })] } }),
                    prop(0x00000012, PT.ObjectID, { refCount: 1 }),
                    prop(0x00000013, PT.ArrayOfObjectSpaceIDs, { refCount: 2 }),
                    prop(0x00000014, PT.ArrayOfContextIDs, { refCount: 3 })
                ],
                ["A:1", "B:1", "C:1", "D:1"],
                ["S:1", "S:2"]
            )
        }));

        const [children, nested, single, spaces, contexts] = dump.objects[0].props;
        expect(children).toMatchObject({ name: "ElementChildNodes", refs: ["A:1", "B:1"] });
        expect(nested.props?.[0].refs).toEqual(["C:1"]);
        expect(single.refs).toEqual(["D:1"]);
        expect(spaces.spaceRefs).toEqual(["S:1", "S:2"]);
        // Context ids aren't retained by the parser, so only their count can be reported.
        expect(contexts).toMatchObject({ contextRefs: 3 });
        expect(contexts.refs).toBeUndefined();
    });

    it("keeps binary payloads whole, previewing them in both text encodings the format uses", () => {
        const formatting = new Uint8Array([0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]);
        const latin1 = new Uint8Array([0x54, 0x65, 0x73, 0x74]); // "Test", how TextExtendedAscii stores it
        const dump = dumpObjectSpace(space({
            "OBJ:1": object(0x0006000e, [
                prop(PROP_ID_RICH_TEXT, PT.LengthPrefixedData, { data: utf16("some text") }),
                prop(PROP_ID_ASCII_TEXT, PT.LengthPrefixedData, { data: latin1 }),
                prop(0x00002222, PT.LengthPrefixedData, { data: formatting })
            ])
        }));

        const [unicodeRun, asciiRun, binary] = dump.objects[0].props;
        expect(unicodeRun.data).toMatchObject({ length: 18, utf16: "some text" });
        // The same bytes read plausibly as UTF-16 ("Test" becomes a CJK pair), so both decodings are offered
        // rather than one guess — otherwise every latin-1 run would show up as convincing gibberish.
        expect(asciiRun.data).toMatchObject({ length: 4, latin1: "Test", utf16: "敔瑳" });
        // base64 is the authoritative copy: it round-trips to the exact bytes, including for non-text.
        expect(Uint8Array.from(decodeBase64(unicodeRun.data?.base64 ?? ""))).toEqual(utf16("some text"));
        expect(binary.data).toMatchObject({ length: 8 });
        expect(binary.data?.utf16).toBeUndefined();
        expect(binary.data?.latin1).toBeUndefined();
        expect(Uint8Array.from(decodeBase64(binary.data?.base64 ?? ""))).toEqual(formatting);
    });

    it("summarizes embedded file data by size rather than re-encoding the bytes", () => {
        const fileObject: OneObject = {
            ...object(0x00080039, []),
            fileData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            fileExt: ".png"
        };
        const dump = dumpObjectSpace(space({ "OBJ:1": fileObject }));

        expect(dump.objects[0].fileData).toEqual({ length: 4, ext: ".png" });
        expect(JSON.stringify(dump)).not.toContain("iVBOR"); // the bytes themselves stay out of the dump
    });

    it("indexes the space by jcid, most frequent first, and reports its roots", () => {
        const dump = dumpObjectSpace(
            space(
                {
                    "OBJ:1": object(0x0006000e, []),
                    "OBJ:2": object(0x0006000e, []),
                    "OBJ:3": object(0x00060011, [])
                },
                { 1: "OBJ:1" }
            )
        );

        expect(dump.jcids).toEqual([
            { jcid: "0x0006000e", name: "RichTextNode", count: 2 },
            { jcid: "0x00060011", name: "ImageNode", count: 1 }
        ]);
        expect(dump.roots).toEqual({ 1: "OBJ:1" });
    });

    it("dumps a real page's object space, including nodes the importer doesn't read", () => {
        const bytes = new Uint8Array(fs.readFileSync(join(dir, "fixtures", "onenote_desktop.one")));
        const section = parseOneSection(bytes, { retainObjectSpaces: true });
        const pageSpace = section.pages[0].space;

        expect(pageSpace).toBeTruthy();
        const dump = pageSpace ? dumpObjectSpace(pageSpace) : undefined;
        expect(dump?.objects.length).toBeGreaterThan(0);
        // The page's text is reachable through the dump...
        const texts = dump?.objects.flatMap((o) => o.props).flatMap((p) => [p.data?.utf16, p.data?.latin1]);
        expect(texts).toContain("This notebook should have three pages.");
        // ...and so are properties the PROP table doesn't name yet — the whole point of dumping by id.
        expect(dump?.objects.some((o) => o.props.some((p) => p.name === undefined))).toBe(true);
        // The dump must survive the round-trip it exists for: being saved as a JSON attachment.
        expect(() => JSON.stringify(dump)).not.toThrow();
    });

    it("is not built unless the parse retained object spaces", () => {
        const bytes = new Uint8Array(fs.readFileSync(join(dir, "fixtures", "onenote_desktop.one")));

        expect(parseOneSection(bytes).pages.every((page) => page.space === undefined)).toBe(true);
    });
});

/** Low-26-bit forms of the full PROP constants, which is how parsed properties carry their id. */
const PROP_ID_RICH_TEXT = 0x1c001c22 & 0x03ffffff;
const PROP_ID_ASCII_TEXT = 0x1c003498 & 0x03ffffff;
const PROP_ID_ELEMENT_CHILDREN = 0x24001c20 & 0x03ffffff;

function prop(id: number, type: number, value: Omit<Partial<PropertyValue>, "type"> = {}, bool = false): Property {
    return { id, type, bool, value: { type, ...value } };
}

function object(jcid: number, props: Property[], objectIds: string[] = [], objectSpaceIds: string[] = []): OneObject {
    return { jcid, propSet: { objectIds, objectSpaceIds, set: { props } } };
}

function space(objects: Record<string, OneObject>, roots: Record<number, string> = {}): ObjectSpace {
    return {
        id: "SPACE:1",
        objects: new Map(Object.entries(objects)),
        roots: new Map(Object.entries(roots).map(([role, id]) => [Number(role), id]))
    };
}

function utf16(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length * 2);
    for (const [index, character] of [...text].entries()) {
        const code = character.charCodeAt(0);
        bytes[index * 2] = code & 0xff;
        bytes[index * 2 + 1] = code >>> 8;
    }
    return bytes;
}
