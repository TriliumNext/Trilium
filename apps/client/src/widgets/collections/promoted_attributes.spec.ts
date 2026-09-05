import { describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import {
    type PromotedAttributeSetting, resolvePromotedAttributes, storedPromotedAttributes,
    visiblePromotedAttributeNames
} from "./promoted_attributes";

const mocks = vi.hoisted(() => ({ bulk: vi.fn(async () => {}) }));
vi.mock("../../services/bulk_action", () => ({ executeBulkActions: mocks.bulk }));

/** A definition as the collection note carries it, `label:dueDate` naming `dueDate`. */
function definition(name: string, {
    alias, noteId = "board1", value = "promoted,single,text", isPromoted = true,
    isInheritable = true
}: {
    alias?: string, noteId?: string, value?: string, isPromoted?: boolean, isInheritable?: boolean
} = {}) {
    return {
        name,
        value,
        noteId,
        isInheritable,
        getDefinition: () => ({ isPromoted, promotedAlias: alias })
    };
}

/** A collection note offering the given definitions. */
function collection(definitions: ReturnType<typeof definition>[], noteId = "board1") {
    return {
        noteId,
        getAttributeDefinitions: () => definitions
    } as unknown as FNote;
}

const DEFINED = [
    definition("label:dueDate", { alias: "Due" }),
    definition("label:requiresResearch"),
    definition("relation:owner")
];

describe("resolvePromotedAttributes", () => {
    it("reads what the note defines, naming each by its alias where it has one", () => {
        const resolved = resolvePromotedAttributes(collection(DEFINED), undefined);

        expect(resolved).toEqual([
            {
                name: "dueDate",
                definitionName: "label:dueDate",
                type: "label",
                title: "Due",
                hidden: false,
                definitionValue: "promoted,single,text",
                isOwned: true,
                isInheritable: true
            },
            expect.objectContaining({ name: "requiresResearch", title: "requiresResearch" }),
            expect.objectContaining({ name: "owner", type: "relation" })
        ]);
    });

    it("puts them in the order the settings give, and hides what they hide", () => {
        const settings: PromotedAttributeSetting[] = [
            { name: "owner" },
            { name: "requiresResearch", hidden: true }
        ];

        const resolved = resolvePromotedAttributes(collection(DEFINED), settings);

        // What the settings arrange leads, in their order; what they say nothing of follows.
        expect(resolved.map((attribute) => attribute.name))
            .toEqual([ "owner", "requiresResearch", "dueDate" ]);
        expect(resolved.map((attribute) => attribute.hidden)).toEqual([ false, true, false ]);
        expect(visiblePromotedAttributeNames(resolved)).toEqual([ "owner", "dueDate" ]);
    });

    /** An attribute nobody has arranged is one the reader has yet to see. */
    it("shows an attribute the settings have never named", () => {
        const resolved = resolvePromotedAttributes(
            collection(DEFINED), [ { name: "dueDate", hidden: true } ]);

        expect(visiblePromotedAttributeNames(resolved)).toEqual([ "requiresResearch", "owner" ]);
    });

    /** Writing the result back is what prunes the config. */
    it("leaves out what the settings name and the note no longer defines", () => {
        const settings: PromotedAttributeSetting[] = [
            { name: "gone", hidden: true },
            { name: "dueDate", hidden: true }
        ];

        const resolved = resolvePromotedAttributes(
            collection([ definition("label:dueDate") ]), settings);

        expect(storedPromotedAttributes(resolved)).toEqual([ { name: "dueDate", hidden: true } ]);
    });

    it("stores a shown attribute as its name alone", () => {
        const resolved = resolvePromotedAttributes(collection(DEFINED), undefined);

        expect(storedPromotedAttributes(resolved))
            .toEqual([ { name: "dueDate" }, { name: "requiresResearch" }, { name: "owner" } ]);
    });

    it("names an attribute once, whichever of the two settings arranged it", () => {
        const resolved = resolvePromotedAttributes(
            collection(DEFINED), [ { name: "owner" }, { name: "owner", hidden: true } ]);

        expect(resolved.filter((attribute) => attribute.name === "owner").length).toBe(1);
        expect(resolved[0].hidden).toBe(false);
    });

    /** A collection whose definitions are its template's or an ancestor's still offers them. */
    it("marks a definition the collection does not carry itself", () => {
        const inherited = definition("label:dueDate", { noteId: "template1" });

        const [ resolved ] = resolvePromotedAttributes(collection([ inherited ]), undefined);

        expect(resolved.isOwned).toBe(false);
    });

    it("answers with nothing for a note that defines none, and for no note at all", () => {
        expect(resolvePromotedAttributes(collection([]), [ { name: "dueDate" } ])).toEqual([]);
        expect(resolvePromotedAttributes(undefined, undefined)).toEqual([]);
    });

    /** A definition names its kind before the colon; anything else is not one to draw. */
    it("passes over a definition of a kind it cannot draw", () => {
        const resolved = resolvePromotedAttributes(
            collection([ definition("dueDate"), definition("child:label:x") ]), undefined);

        expect(resolved).toEqual([]);
    });

    /**
     * An item draws every attribute it has a definition for, promoted or not, and a collection
     * carrying `#hidePromotedAttributes` reports no promoted ones at all: reading the promoted
     * subset would leave both out of the reader's hands.
     */
    it("lists a definition that is not promoted", () => {
        const resolved = resolvePromotedAttributes(collection([
            definition("label:dueDate", { alias: "Due" }),
            definition("label:internal", { isPromoted: false, value: "single,text" })
        ]), undefined);

        expect(resolved.map((attribute) => attribute.name)).toEqual([ "dueDate", "internal" ]);
    });

    /** A definition that does not pass down describes the collection alone, never its items. */
    it("leaves out a definition that is not inheritable", () => {
        const resolved = resolvePromotedAttributes(collection([
            definition("label:dueDate"),
            definition("label:boardSetting", { isInheritable: false })
        ]), undefined);

        expect(resolved.map((attribute) => attribute.name)).toEqual([ "dueDate" ]);
    });

    /** What the collection draws itself is not the reader's to arrange. */
    it("leaves out what the caller names as its own", () => {
        const resolved = resolvePromotedAttributes(
            collection(DEFINED), [ { name: "owner" } ], [ "owner" ]);

        expect(resolved.map((attribute) => attribute.name))
            .toEqual([ "dueDate", "requiresResearch" ]);
    });

    /** Two notes in the chain can define the same attribute; the nearer one is what applies. */
    it("keeps the first of two definitions of one name", () => {
        const resolved = resolvePromotedAttributes(collection([
            definition("label:dueDate", { alias: "Due" }),
            definition("label:dueDate", { alias: "Deadline", noteId: "template1" })
        ]), undefined);

        expect(resolved.map((attribute) => attribute.title)).toEqual([ "Due" ]);
    });
});
