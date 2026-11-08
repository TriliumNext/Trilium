import { afterEach, describe, expect, it, vi } from "vitest";

// Only the titles of the notes relations point at are read, and only to make the links readable.
const titles: Record<string, string> = { abc123: "Some note", evil: "Tom & <Jerry>" };
vi.mock("./froca", () => ({
    default: {
        getNoteFromCache: (noteId: string) => titles[noteId] ? { title: titles[noteId] } : undefined
    }
}));

import attribute_parser, { Attribute } from "./attribute_parser";
import {
    copyAttributesToClipboard,
    getHeldAttributes,
    getPreprocessedData,
    mergePastedAttributes,
    readAttributes,
    serializeAttributes,
    serializeAttributesAsHtml,
    writeAttributes
} from "./attribute_clipboard";

describe("serializeAttributes", () => {
    it("writes the attributes as the line the attributes editor spells them out in", () => {
        expect(serializeAttributes([
            label("author", "Elian"),
            label("archived"),
            { ...label("tag", "to read"), isInheritable: true },
            relation("parent", "abc123")
        ])).toBe("#author=Elian #archived #tag(inheritable)=\"to read\" ~parent=#root/abc123");
    });

    it("leaves out a relation with no target, which there is nothing to write down for", () => {
        expect(serializeAttributes([ relation("parent", ""), label("kept", "yes") ])).toBe("#kept=yes");
    });

    it("round-trips through the parser, values needing quotes and all", () => {
        const attributes = [
            label("author", "Elian"),
            label("quote", 'he said "hi"'),
            label("bare"),
            { ...label("inherited", "yes"), isInheritable: true },
            relation("parent", "abc123")
        ];

        expect(attribute_parser.lexAndParse(serializeAttributes(attributes))).toMatchObject([
            { type: "label", name: "author", value: "Elian", isInheritable: false },
            { type: "label", name: "quote", value: 'he said "hi"', isInheritable: false },
            { type: "label", name: "bare", isInheritable: false },
            { type: "label", name: "inherited", value: "yes", isInheritable: true },
            { type: "relation", name: "parent", value: "abc123", isInheritable: false }
        ]);
    });

    it("keeps backslashes, which the parser reads as escapes inside quotes as well", () => {
        const values = [ "C:\\notes", "ends with\\", "\"a\" 'b' `c` \\d" ];

        expect(attribute_parser.lexAndParse(serializeAttributes(values.map((value) => label("path", value))))
            .map((attribute) => attribute.value)).toEqual(values);
    });
});

describe("serializeAttributesAsHtml", () => {
    it("writes the relations as the reference links the editor holds, the title standing for the path", () => {
        expect(serializeAttributesAsHtml([ label("author", "Elian"), relation("parent", "abc123") ]))
            .toBe('#author=Elian ~parent=<a href="#root/abc123" class="reference-link">Some note</a>');
    });

    it("names an unknown target by its id, there being no title to show for it", () => {
        expect(serializeAttributesAsHtml([ relation("parent", "unknown") ]))
            .toContain(">unknown</a>");
    });

    it("leaves a title that looks like markup a title", () => {
        expect(serializeAttributesAsHtml([ relation("parent", "evil") ]))
            .toContain(">Tom &amp; &lt;Jerry&gt;</a>");
    });

    it("reads back as the text it stands for", () => {
        const html = serializeAttributesAsHtml([ label("author", "Elian"), relation("parent", "abc123") ]);

        expect(getPreprocessedData(html)).toBe("#author=Elian ~parent=#root/abc123");
    });

    it("leaves out a relation with no target, as the text does", () => {
        expect(serializeAttributesAsHtml([ relation("parent", ""), label("kept", "yes") ])).toBe("#kept=yes");
    });
});

describe("copyAttributesToClipboard", () => {
    const copied = [ label("author", "Elian") ];

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(document, "execCommand");
        writeAttributes(null, []);
    });

    it("writes the text through the clipboard API where there is one", async () => {
        const writeText = vi.fn(async (_text: string) => {});
        vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
        const execCommand = stubExecCommand(() => true);

        await copyAttributesToClipboard(copied);

        expect(writeText).toHaveBeenCalledWith("#author=Elian");
        expect(execCommand).not.toHaveBeenCalled();
        expect(getHeldAttributes()).toEqual(copied);
    });

    it("falls back to the copy command when the API refuses, giving the focus back afterwards", async () => {
        const writeText = vi.fn(async (_text: string) => {
            throw new Error("Not allowed");
        });
        vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
        const button = document.createElement("button");
        document.body.append(button);
        button.focus();

        let selectedText: string | undefined;
        const execCommand = stubExecCommand(() => {
            selectedText = document.querySelector("textarea")?.value;
            return true;
        });

        try {
            await copyAttributesToClipboard(copied);

            expect(execCommand).toHaveBeenCalledWith("copy");
            expect(selectedText).toBe("#author=Elian");
            expect(document.querySelector("textarea")).toBeNull();
            expect(document.activeElement).toBe(button);
        } finally {
            button.remove();
        }
    });

    it("still holds the attributes where neither way reaches the system clipboard", async () => {
        vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
        vi.spyOn(document, "activeElement", "get").mockReturnValue(null);
        stubExecCommand(() => {
            throw new Error("Not supported");
        });

        await copyAttributesToClipboard(copied);

        expect(document.querySelector("textarea")).toBeNull();
        expect(getHeldAttributes()).toEqual(copied);
    });

    /** happy-dom has no `document.execCommand`, so each test defines its own. */
    function stubExecCommand(implementation: (command: string) => boolean) {
        const execCommand = vi.fn(implementation);
        Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
        return execCommand;
    }
});

describe("readAttributes", () => {
    it("prefers the HTML flavour, which is the one a relation's target survives in", () => {
        const attributes = readAttributes(clipboard({
            "text/html": '~parent=<a class="reference-link" href="#root/abc123">Some note</a>',
            // What a copy out of the editor leaves as plain text: the title, which names no note.
            "text/plain": "~parent=Some note"
        }));

        expect(attributes).toMatchObject([ { type: "relation", name: "parent", value: "abc123" } ]);
    });

    it("falls back to the plain text where there is no HTML, and reads an empty clipboard as nothing", () => {
        expect(readAttributes(clipboard({ "text/plain": "#author=Elian" })))
            .toMatchObject([ { type: "label", name: "author", value: "Elian" } ]);

        expect(readAttributes(clipboard({ "text/plain": "   " }))).toEqual([]);
        expect(readAttributes(null)).toEqual([]);
    });

    it("throws what the parser makes of text that is not attributes", () => {
        expect(() => readAttributes(clipboard({ "text/plain": "just some prose" })))
            .toThrow(/Invalid attribute/);
    });
});

describe("writeAttributes", () => {
    it("puts both flavours on the clipboard", () => {
        const setData = vi.fn();
        writeAttributes({ setData } as unknown as DataTransfer, [ relation("parent", "abc123") ]);

        expect(setData).toHaveBeenCalledWith("text/plain", "~parent=#root/abc123");
        expect(setData).toHaveBeenCalledWith("text/html", expect.stringContaining("reference-link"));
    });

    it("holds on to what it wrote, which is what a menu pastes", () => {
        const copied = [ label("author", "Elian") ];
        writeAttributes(null, copied);

        expect(getHeldAttributes()).toEqual(copied);
        // A copy of the list and of each attribute, so that editing the rows it was taken from does
        // not edit the clipboard.
        expect(getHeldAttributes()).not.toBe(copied);
        copied[0].value = "Someone else";
        expect(getHeldAttributes()[0].value).toBe("Elian");

        writeAttributes(null, []);
        expect(getHeldAttributes()).toEqual([]);
    });
});

describe("mergePastedAttributes", () => {
    const single = () => false;

    it("adds what the note does not carry, and never carries an id across", () => {
        const { attributes, added, replaced } = mergePastedAttributes(
            [ label("existing", "kept") ],
            [ { ...label("author", "Elian"), attributeId: "fromElsewhere", noteId: "otherNote" } ],
            single
        );

        expect(attributes).toEqual([
            label("existing", "kept"),
            { type: "label", name: "author", value: "Elian", isInheritable: false }
        ]);
        expect(attributes[1].attributeId).toBeUndefined();
        expect(attributes[1].noteId).toBeUndefined();
        expect([ added, replaced ]).toEqual([ 1, 0 ]);
    });

    it("replaces a single-valued name in place, the attribute staying the one it was", () => {
        const existing: Attribute = { ...label("author", "Someone"), attributeId: "own" };
        const { attributes, added, replaced } = mergePastedAttributes(
            [ existing ],
            [ { ...label("author", "Elian"), isInheritable: true } ],
            single
        );

        expect(attributes).toHaveLength(1);
        // Kept: this is the same attribute given another value, not a new one put beside it.
        expect(attributes[0]).toMatchObject({ attributeId: "own", value: "Elian", isInheritable: true });
        expect([ added, replaced ]).toEqual([ 0, 1 ]);
    });

    it("puts another entry into a name that holds a set, but not one it already holds", () => {
        const multi = (attribute: Attribute) => attribute.name === "tag";
        const { attributes, added } = mergePastedAttributes(
            [ label("tag", "book") ],
            [ label("tag", "read"), label("tag", "book") ],
            multi
        );

        expect(attributes.map((attribute) => attribute.value)).toEqual([ "book", "read" ]);
        expect(added).toBe(1);
    });

    it("reads whether a name holds a set from a definition pasted alongside it, over the note's own", () => {
        const { attributes } = mergePastedAttributes(
            [ label("tag", "book") ],
            [ label("label:tag", "promoted,multi"), label("tag", "read"), label("status", "draft") ],
            single
        );
        expect(attributes.filter((attribute) => attribute.name === "tag").map((attribute) => attribute.value))
            .toEqual([ "book", "read" ]);

        // A pasted single-valued definition replaces what the note defined as a set.
        const { attributes: replaced } = mergePastedAttributes(
            [ label("tag", "book") ],
            [ label("tag", "read"), label("label:tag", "promoted,single") ],
            () => true
        );
        expect(replaced.filter((attribute) => attribute.name === "tag").map((attribute) => attribute.value))
            .toEqual([ "read" ]);
    });

    it("reads an attribute the parser left without a value or inheritability as empty and not inherited", () => {
        const { attributes, added } = mergePastedAttributes(
            [ { type: "label", name: "tag" } ],
            [ { type: "label", name: "label:tag" }, { type: "label", name: "tag" }, { type: "label", name: "flag" } ],
            () => true
        );

        // `label:tag` with no value defines a single value, so the bare `tag` replaces the note's own.
        expect(attributes).toEqual([
            { type: "label", name: "tag", value: "", isInheritable: false },
            { type: "label", name: "label:tag", value: "", isInheritable: false },
            { type: "label", name: "flag", value: "", isInheritable: false }
        ]);
        expect(added).toBe(2);

        // Pasted into a set that already holds the empty value, it is not added a second time.
        expect(mergePastedAttributes([ { type: "label", name: "flag" } ], [ { type: "label", name: "flag" } ], () => true).added)
            .toBe(0);
    });

    it("tells a label from a relation of the same name", () => {
        const { attributes } = mergePastedAttributes([ label("owner", "me") ], [ relation("owner", "abc123") ], single);

        expect(attributes).toHaveLength(2);
    });

    it("leaves the list it was given alone", () => {
        const existing = [ label("author", "Someone") ];
        mergePastedAttributes(existing, [ label("author", "Elian"), label("other", "x") ], single);

        expect(existing).toEqual([ label("author", "Someone") ]);
    });
});

describe("getPreprocessedData", () => {
    it("reduces a reference link back to the note path it stands for, and resolves the entities around it", () => {
        expect(getPreprocessedData(
            "<p>#author=Elian&nbsp;~parent=<a class=\"reference-link\" href=\"#root/abc123\">Some note</a>&nbsp;</p>"
        )).toBe("#author=Elian ~parent=#root/abc123 ");

        // A link to anywhere else is not a note path, so it is left to the text extraction below it.
        expect(getPreprocessedData("<a href=\"https://example.com\">Example</a>")).toBe("Example");
        expect(getPreprocessedData("#a&amp;b")).toBe("#a&b");
    });

    it("parses pasted HTML outside the live document, so its markup never loads or runs", () => {
        // An element owned by `document` loads its resources even while detached, which runs an
        // `onerror` handler from a page the user copied from.
        const createElement = vi.spyOn(document, "createElement");
        try {
            const attributes = readAttributes(clipboard({
                "text/html": '#author=Elian<img src="x" onerror="alert(1)">'
            }));

            expect(attributes).toMatchObject([ { type: "label", name: "author", value: "Elian" } ]);
            expect(createElement).not.toHaveBeenCalled();
        } finally {
            createElement.mockRestore();
        }
    });
});

function label(name: string, value?: string): Attribute {
    return { type: "label", name, value: value ?? "", isInheritable: false };
}

function relation(name: string, value: string): Attribute {
    return { type: "relation", name, value, isInheritable: false };
}

/** A clipboard holding the given flavours and nothing else, as an event hands one over. */
function clipboard(flavours: Record<string, string>) {
    return { getData: (type: string) => flavours[type] ?? "" } as unknown as DataTransfer;
}
