import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import { allViewTypes } from "../widgets/collections/interface";
import { getPresentationThemes } from "../widgets/collections/presentation/themes";
import { MEDIA_PLAY_MODES } from "../widgets/type_widgets/file/media_play_mode";
import attributeService, { getBuiltinLabelSelectOptions, getBuiltinLabelValueType, isBuiltinAttribute, removeOwnedAttributesByNameOrType, setAttribute, setBooleanWithInheritance, setLabel, setRelation } from "./attributes";
import froca from "./froca";
import server from "./server.js";

// Spy on server methods to track calls
server.put = vi.fn(async () => ({})) as typeof server.put;
server.remove = vi.fn(async () => ({})) as typeof server.remove;

describe("Set boolean with inheritance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("doesn't call server if value matches directly", async () => {
        const noteWithLabel = buildNote({
            title: "New note",
            "#foo": ""
        });
        const noteWithoutLabel = buildNote({
            title: "New note"
        });

        await setBooleanWithInheritance(noteWithLabel, "foo", true);
        await setBooleanWithInheritance(noteWithoutLabel, "foo", false);
        expect(server.put).not.toHaveBeenCalled();
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("sets boolean normally without inheritance", async () => {
        const standaloneNote = buildNote({
            title: "New note"
        });

        await setBooleanWithInheritance(standaloneNote, "foo", true);
        expect(server.put).toHaveBeenCalledWith(`notes/${standaloneNote.noteId}/set-attribute`, {
            type: "label",
            name: "foo",
            value: "",
            isInheritable: false
        }, undefined);
    });

    it("removes boolean normally without inheritance", async () => {
        const standaloneNote = buildNote({
            title: "New note",
            "#foo": ""
        });

        const attributeId = standaloneNote.getLabel("foo")!.attributeId;
        await setBooleanWithInheritance(standaloneNote, "foo", false);
        expect(server.remove).toHaveBeenCalledWith(`notes/${standaloneNote.noteId}/attributes/${attributeId}`);
    });

    it("doesn't call server if value matches inherited", async () => {
        const parentNote = buildNote({
            title: "Parent note",
            "#foo(inheritable)": "",
            "children": [
                {
                    title: "Child note"
                }
            ]
        });
        const childNote = froca.getNoteFromCache(parentNote.children[0])!;
        expect(childNote.isLabelTruthy("foo")).toBe(true);
        await setBooleanWithInheritance(childNote, "foo", true);
        expect(server.put).not.toHaveBeenCalled();
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("overrides boolean with inheritance", async () => {
        const parentNote = buildNote({
            title: "Parent note",
            "#foo(inheritable)": "",
            "children": [
                {
                    title: "Child note"
                }
            ]
        });
        const childNote = froca.getNoteFromCache(parentNote.children[0])!;
        expect(childNote.isLabelTruthy("foo")).toBe(true);
        await setBooleanWithInheritance(childNote, "foo", false);
        expect(server.put).toHaveBeenCalledWith(`notes/${childNote.noteId}/set-attribute`, {
            type: "label",
            name: "foo",
            value: "false",
            isInheritable: false
        }, undefined);
    });

    it("overrides boolean with inherited false", async () => {
        const parentNote = buildNote({
            title: "Parent note",
            "#foo(inheritable)": "false",
            "children": [
                {
                    title: "Child note"
                }
            ]
        });
        const childNote = froca.getNoteFromCache(parentNote.children[0])!;
        expect(childNote.isLabelTruthy("foo")).toBe(false);
        await setBooleanWithInheritance(childNote, "foo", true);
        expect(server.put).toHaveBeenCalledWith(`notes/${childNote.noteId}/set-attribute`, {
            type: "label",
            name: "foo",
            value: "",
            isInheritable: false
        }, undefined);
    });

    it("deletes override boolean with inherited false with already existing value", async () => {
        const parentNote = buildNote({
            title: "Parent note",
            "#foo(inheritable)": "false",
            "children": [
                {
                    title: "Child note",
                    "#foo": "false",
                }
            ]
        });
        const childNote = froca.getNoteFromCache(parentNote.children[0])!;
        expect(childNote.isLabelTruthy("foo")).toBe(false);
        await setBooleanWithInheritance(childNote, "foo", true);
        expect(server.put).toBeCalledWith(`notes/${childNote.noteId}/set-attribute`, {
            type: "label",
            name: "foo",
            value: "",
            isInheritable: false
        }, undefined);
    });
});

describe("addLabel / setLabel / setRelation", () => {
    beforeEach(() => vi.clearAllMocks());

    it("addLabel PUTs to the attribute endpoint with defaults", async () => {
        const note = buildNote({ title: "N" });
        await attributeService.addLabel(note.noteId, "color");
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/attribute`, {
            type: "label",
            name: "color",
            value: "",
            isInheritable: false
        });
    });

    it("addLabel PUTs with explicit value and inheritance", async () => {
        const note = buildNote({ title: "N" });
        await attributeService.addLabel(note.noteId, "color", "red", true);
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/attribute`, {
            type: "label",
            name: "color",
            value: "red",
            isInheritable: true
        });
    });

    it("setLabel PUTs to set-attribute with componentId passthrough", async () => {
        const note = buildNote({ title: "N" });
        await setLabel(note.noteId, "color", "red", true, "comp-1");
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/set-attribute`, {
            type: "label",
            name: "color",
            value: "red",
            isInheritable: true
        }, "comp-1");
    });

    it("setRelation PUTs to set-attribute", async () => {
        const note = buildNote({ title: "N" });
        await setRelation(note.noteId, "template", "abc123", true);
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/set-attribute`, {
            type: "relation",
            name: "template",
            value: "abc123",
            isInheritable: true
        });
    });
});

describe("setLabelValues", () => {
    beforeEach(() => vi.clearAllMocks());

    /** A note holding the given values under one name, as several labels of it. */
    function noteHolding(...values: string[]) {
        const note = buildNote({ title: "N" });
        for (const [ index, value ] of values.entries()) {
            note.attributes.push(`attr-${index}`);
            froca.attributes[`attr-${index}`] = {
                attributeId: `attr-${index}`, noteId: note.noteId, type: "label",
                name: "tags", value, position: index, isInheritable: false
            } as never;
        }
        return note;
    }

    it("reuses the labels already there, so the set keeps its order and positions", async () => {
        const note = noteHolding("a", "b");

        await attributeService.setLabelValues(note, "tags", [ "a", "c" ]);

        // "a" is where it was, so only the label that changed is written.
        expect(server.put).toHaveBeenCalledTimes(1);
        expect(server.put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: "attr-1", type: "label", name: "tags", value: "c" },
            undefined
        );
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("creates what the set gained, having no label left to reuse for it", async () => {
        const note = noteHolding("a");

        await attributeService.setLabelValues(note, "tags", [ "a", "b" ], "comp-1");

        expect(server.put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "label", name: "tags", value: "b" },
            "comp-1"
        );
    });

    it("reuses returned state before the note cache reloads", async () => {
        const note = noteHolding("a");
        vi.mocked(server.put).mockResolvedValueOnce({ attributeId: "attr-new" });

        const current = await attributeService.setLabelValues(note, "tags", [ "a", "b" ]);
        vi.mocked(server.put).mockClear();
        await attributeService.setLabelValues(
            note,
            "tags",
            [ "a", "b", "c" ],
            undefined,
            current
        );

        expect(server.put).toHaveBeenCalledOnce();
        expect(server.put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "label", name: "tags", value: "c" },
            undefined
        );
    });

    it("removes the labels the set no longer fills, emptying included", async () => {
        const note = noteHolding("a", "b", "c");

        await attributeService.setLabelValues(note, "tags", [ "a" ]);

        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/attr-1`, undefined);
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/attr-2`, undefined);

        vi.clearAllMocks();
        await attributeService.setLabelValues(note, "tags", []);
        expect(server.remove).toHaveBeenCalledTimes(3);
    });
});

describe("setRelationValues", () => {
    beforeEach(() => vi.clearAllMocks());

    it("writes the targets as relations of the name, reused and trimmed as a label set is", async () => {
        const note = buildNote({ title: "N" });
        for (const [ index, value ] of [ "aaa", "bbb" ].entries()) {
            note.attributes.push(`rel-${index}`);
            froca.attributes[`rel-${index}`] = {
                attributeId: `rel-${index}`, noteId: note.noteId, type: "relation",
                name: "crew", value, position: index, isInheritable: false
            } as never;
        }

        await attributeService.setRelationValues(note, "crew", [ "aaa", "ccc" ], "comp-1");

        // Only the target that changed is written — as a relation, through the slot already there.
        expect(server.put).toHaveBeenCalledTimes(1);
        expect(server.put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: "rel-1", type: "relation", name: "crew", value: "ccc" },
            "comp-1"
        );

        vi.clearAllMocks();
        await attributeService.setRelationValues(note, "crew", [ "aaa" ], "comp-1");
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/rel-1`, "comp-1");
    });
});

describe("addSelectOption", () => {
    beforeEach(() => vi.clearAllMocks());

    /** The note carrying the definition, which is not the note the field is edited on. */
    function definitionOf(value: string) {
        const owner = buildNote({ title: "Owner", [`#label:status`]: value });
        const definitionAttr = owner.getAttributeDefinitions()
            .find((attr) => attr.name === "label:status");
        if (!definitionAttr) throw new Error("expected the definition to be built");
        return definitionAttr;
    }

    it("appends the option to the definition, writing it back to the note that owns it", async () => {
        const definitionAttr = definitionOf("promoted,single,select,options=Todo;Done");

        const newDefinition = await attributeService.addSelectOption(definitionAttr, "Blocked", "comp-1");

        expect(newDefinition.selectOptions).toEqual([ "Todo", "Done", "Blocked" ]);
        expect(server.put).toHaveBeenCalledWith(
            `notes/${definitionAttr.noteId}/attribute`,
            {
                attributeId: definitionAttr.attributeId,
                type: "label",
                name: "label:status",
                value: "promoted,single,select,options=Todo;Done;Blocked"
            },
            "comp-1"
        );
    });

    it("gives a definition with no options its first, and escapes what the format claims", async () => {
        await attributeService.addSelectOption(definitionOf("promoted,single,select"), "1,5 kg");
        expect(server.put).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ value: "promoted,single,select,options=1%2C5 kg" }),
            undefined
        );
    });

    it("leaves an option it already offers alone, without a write", async () => {
        const definitionAttr = definitionOf("promoted,single,select,options=Todo;Done");

        const unchanged = await attributeService.addSelectOption(definitionAttr, "Done");

        expect(unchanged.selectOptions).toEqual([ "Todo", "Done" ]);
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("removeAttributeById / removeOwnedAttributesByNameOrType", () => {
    beforeEach(() => vi.clearAllMocks());

    it("removeAttributeById issues a DELETE", async () => {
        const note = buildNote({ title: "N" });
        await attributeService.removeAttributeById(note.noteId, "attr-xyz");
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/attr-xyz`);
    });

    it("removeOwnedAttributesByNameOrType removes only matching owned attributes", async () => {
        const note = buildNote({
            title: "N",
            "#color": "red",
            "#size": "big",
            "~template": "tpl1"
        });
        const colorId = note.getOwnedLabel("color")!.attributeId;
        await removeOwnedAttributesByNameOrType(note, "label", "color");
        expect(server.remove).toHaveBeenCalledTimes(1);
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${colorId}`);
    });
});

describe("removeOwnedLabelByName / removeOwnedRelationByName", () => {
    beforeEach(() => vi.clearAllMocks());

    it("removeOwnedLabelByName removes an existing label and returns true", () => {
        const note = buildNote({ title: "N", "#color": "red" });
        const labelId = note.getOwnedLabel("color")!.attributeId;
        expect(attributeService.removeOwnedLabelByName(note, "color")).toBe(true);
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${labelId}`);
    });

    it("removeOwnedLabelByName returns false when label is absent", () => {
        const note = buildNote({ title: "N" });
        expect(attributeService.removeOwnedLabelByName(note, "missing")).toBe(false);
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("removeOwnedRelationByName removes an existing relation and returns true", () => {
        const note = buildNote({ title: "N", "~template": "tpl1" });
        const relId = note.getOwnedRelation("template")!.attributeId;
        expect(attributeService.removeOwnedRelationByName(note, "template")).toBe(true);
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${relId}`);
    });

    it("removeOwnedRelationByName returns false when relation is absent", () => {
        const note = buildNote({ title: "N" });
        expect(attributeService.removeOwnedRelationByName(note, "missing")).toBe(false);
        expect(server.remove).not.toHaveBeenCalled();
    });
});

describe("setAttribute", () => {
    beforeEach(() => vi.clearAllMocks());

    it("PUTs when a value is provided", async () => {
        const note = buildNote({ title: "N" });
        await setAttribute(note, "label", "color", "red", "comp-2");
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/set-attribute`, {
            type: "label",
            name: "color",
            value: "red"
        }, "comp-2");
        expect(server.remove).not.toHaveBeenCalled();
    });

    it("removes an existing attribute when value is null", async () => {
        const note = buildNote({ title: "N", "#color": "red" });
        const attrId = note.getAttribute("label", "color")!.attributeId;
        await setAttribute(note, "label", "color", null, "comp-3");
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${attrId}`, "comp-3");
        expect(server.put).not.toHaveBeenCalled();
    });

    it("does nothing when value is undefined and the attribute is absent", async () => {
        const note = buildNote({ title: "N" });
        await setAttribute(note, "label", "color", undefined);
        expect(server.remove).not.toHaveBeenCalled();
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("isAffecting", () => {
    it("returns false when there is no affected note or no attribute row", () => {
        const note = buildNote({ title: "N" });
        expect(attributeService.isAffecting({ attributeId: "x" } as any, null)).toBe(false);
        expect(attributeService.isAffecting(null as any, note)).toBe(false);
    });

    it("returns false when the attribute's owning note is not in froca", () => {
        const note = buildNote({ title: "N" });
        expect(attributeService.isAffecting({ attributeId: "x", noteId: "not-loaded" } as any, note)).toBe(false);
    });

    it("returns true when the attribute is directly owned by the affected note", () => {
        const note = buildNote({ title: "N" });
        expect(attributeService.isAffecting({ attributeId: "x", noteId: note.noteId } as any, note)).toBe(true);
    });

    it("returns true for an inheritable attribute owned by an ancestor", () => {
        const parent = buildNote({
            title: "Parent",
            children: [{ title: "Child" }]
        });
        const child = froca.getNoteFromCache(parent.children[0])!;
        expect(attributeService.isAffecting(
            { attributeId: "x", noteId: parent.noteId, isInheritable: true } as any,
            child
        )).toBe(true);
    });

    it("returns false for an inheritable attribute owned by an unrelated note", () => {
        const unrelated = buildNote({ title: "Unrelated" });
        const note = buildNote({ title: "N" });
        expect(attributeService.isAffecting(
            { attributeId: "x", noteId: unrelated.noteId, isInheritable: true } as any,
            note
        )).toBe(false);
    });

    it("returns false for a non-inheritable attribute owned by an unrelated note", () => {
        const unrelated = buildNote({ title: "Unrelated2" });
        const note = buildNote({ title: "N2" });
        expect(attributeService.isAffecting(
            { attributeId: "x", noteId: unrelated.noteId, isInheritable: false } as any,
            note
        )).toBe(false);
    });
});

describe("toggleDangerousAttribute", () => {
    beforeEach(() => vi.clearAllMocks());

    it("disables a label by prefixing it and removing the original", async () => {
        const note = buildNote({ title: "N", "#run": "frontendStartup" });
        const attrId = note.getOwnedLabel("run")!.attributeId;
        await attributeService.toggleDangerousAttribute(note, "label", "run", false);
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/set-attribute`, {
            type: "label",
            name: "disabled:run",
            value: "frontendStartup",
            isInheritable: false
        }, undefined);
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${attrId}`);
        // The renamed attribute must be PUT before the original is removed, to avoid a flicker
        // where there would momentarily be no active content attribute.
        const putMock = server.put as unknown as ReturnType<typeof vi.fn>;
        const removeMock = server.remove as unknown as ReturnType<typeof vi.fn>;
        expect(putMock.mock.invocationCallOrder[0]).toBeLessThan(removeMock.mock.invocationCallOrder[0]);
    });

    it("enables a disabled relation by stripping the prefix", async () => {
        const note = buildNote({ title: "N", "~disabled:runOnInstance": "tgt" });
        const attrId = note.getOwnedRelation("disabled:runOnInstance")!.attributeId;
        await attributeService.toggleDangerousAttribute(note, "relation", "runOnInstance", true);
        expect(server.put).toHaveBeenCalledWith(`notes/${note.noteId}/set-attribute`, {
            type: "relation",
            name: "runOnInstance",
            value: "tgt",
            isInheritable: false
        });
        expect(server.remove).toHaveBeenCalledWith(`notes/${note.noteId}/attributes/${attrId}`);
        // The renamed attribute must be PUT before the original is removed, to avoid a flicker
        // where there would momentarily be no active content attribute.
        const putMock = server.put as unknown as ReturnType<typeof vi.fn>;
        const removeMock = server.remove as unknown as ReturnType<typeof vi.fn>;
        expect(putMock.mock.invocationCallOrder[0]).toBeLessThan(removeMock.mock.invocationCallOrder[0]);
    });

    it("skips attributes whose name already matches the desired state", async () => {
        const note = buildNote({ title: "N", "#widget": "x" });
        await attributeService.toggleDangerousAttribute(note, "label", "widget", true);
        expect(server.put).not.toHaveBeenCalled();
        expect(server.remove).not.toHaveBeenCalled();
    });
});

describe("getNameWithoutDangerousPrefix", () => {
    it("strips the disabled: prefix when present and leaves plain names untouched", () => {
        expect(attributeService.getNameWithoutDangerousPrefix("disabled:run")).toBe("run");
        expect(attributeService.getNameWithoutDangerousPrefix("run")).toBe("run");
    });
});

describe("isBuiltinAttribute", () => {
    it("recognizes built-ins of each type and rejects user-invented names", () => {
        expect(isBuiltinAttribute("label", "archived")).toBe(true);
        expect(isBuiltinAttribute("relation", "template")).toBe(true);
        expect(isBuiltinAttribute("label", "myOwnLabel")).toBe(false);
        expect(isBuiltinAttribute("relation", "myOwnRelation")).toBe(false);
    });

    it("does not confuse the two types", () => {
        // `archived` is a label only, `renderNote` a relation only.
        expect(isBuiltinAttribute("relation", "archived")).toBe(false);
        expect(isBuiltinAttribute("label", "renderNote")).toBe(false);
        // `template` and `widget` exist as both, so both must be recognized.
        expect(isBuiltinAttribute("label", "template")).toBe(true);
        expect(isBuiltinAttribute("relation", "widget")).toBe(true);
    });

    it("recognizes the journal and calendar names, which the list long omitted", () => {
        expect(isBuiltinAttribute("label", "yearNote")).toBe(true);
        expect(isBuiltinAttribute("relation", "dateTemplate")).toBe(true);
        expect(isBuiltinAttribute("label", "calendar:view")).toBe(true);
        // An event reads its dates from these by default, so the names are Trilium's, not the user's.
        expect(isBuiltinAttribute("label", "startDate")).toBe(true);
        expect(isBuiltinAttribute("label", "calendar:startDate")).toBe(true);
    });

    it("recognizes the board's task-state names", () => {
        expect(isBuiltinAttribute("label", "board:groupBy")).toBe(true);
        expect(isBuiltinAttribute("label", "stateId")).toBe(true);
        expect(isBuiltinAttribute("label", "isCompleted")).toBe(true);
    });

    it("recognizes the names of the smaller subsystems", () => {
        expect(isBuiltinAttribute("label", "fastSearch")).toBe(true);
        expect(isBuiltinAttribute("label", "launcherType")).toBe(true);
        expect(isBuiltinAttribute("relation", "hoistedNote")).toBe(true);
        expect(isBuiltinAttribute("label", "shareOpenGraphURL")).toBe(true);
        expect(isBuiltinAttribute("label", "oneNotePageId")).toBe(true);
        expect(isBuiltinAttribute("label", "versioningLimit")).toBe(true);
        expect(isBuiltinAttribute("relation", "includeNoteLink")).toBe(true);
        // `shareOpenGraphImage` is read as either a label or a relation, so both must be recognized.
        expect(isBuiltinAttribute("label", "shareOpenGraphImage")).toBe(true);
        expect(isBuiltinAttribute("relation", "shareOpenGraphImage")).toBe(true);
    });

    it("recognizes the map names", () => {
        expect(isBuiltinAttribute("label", "geolocation")).toBe(true);
        expect(isBuiltinAttribute("label", "map:style")).toBe(true);
        expect(isBuiltinAttribute("label", "excludeFromNoteMap")).toBe(true);
    });

    it("reports the value type of a built-in label, and nothing for anything else", () => {
        expect(getBuiltinLabelValueType("color")).toBe("color");
        expect(getBuiltinLabelValueType("archived")).toBe("boolean");
        expect(getBuiltinLabelValueType("pageSize")).toBe("number");
        // Relations point at a note, so they carry no value type even under a shared name.
        expect(getBuiltinLabelValueType("template")).toBe("boolean");
        expect(getBuiltinLabelValueType("renderNote")).toBeUndefined();
        // Matched exactly, as the built-in lookup is.
        expect(getBuiltinLabelValueType("disabled:webViewSrc")).toBeUndefined();
        expect(getBuiltinLabelValueType("myOwnLabel")).toBeUndefined();
    });

    it("reports the choices of a built-in closed set, and nothing for anything else", () => {
        expect(getBuiltinLabelValueType("sortDirection")).toBe("select");
        expect(getBuiltinLabelSelectOptions("sortDirection")).toEqual([ "asc", "desc" ]);
        // A built-in label of any other type has no choices to offer, nor has a name Trilium
        // attaches no meaning to.
        expect(getBuiltinLabelSelectOptions("color")).toBeUndefined();
        expect(getBuiltinLabelSelectOptions("myOwnLabel")).toBeUndefined();
    });

    it("offers the same choices the widgets reading those labels act on", () => {
        // The lists live in two places by necessity — the vocabulary is shared, the widgets are the
        // client's — so drift between them is caught here rather than by an unexplained blank field.
        expect(getBuiltinLabelSelectOptions("viewType")).toEqual([ ...allViewTypes ]);
        // "Play once" is the absence of the label, so it is the one mode not offered as a value.
        expect(getBuiltinLabelSelectOptions("mediaNotesPlayMode"))
            .toEqual(MEDIA_PLAY_MODES.filter((mode) => mode !== "once"));
        // The stored value is the theme's id, not the name the collection properties show.
        expect(getBuiltinLabelSelectOptions("presentation:theme"))
            .toEqual(getPresentationThemes().map((theme) => theme.id));
    });

    it("matches exactly, so prefixed names are not built-ins", () => {
        // A definition describes a built-in without being one, and a disabled one is inert.
        expect(isBuiltinAttribute("label", "label:archived")).toBe(false);
        expect(isBuiltinAttribute("label", "disabled:run")).toBe(false);
        // Casing is part of the name; the server's own lookup is likewise name-sensitive.
        expect(isBuiltinAttribute("label", "Archived")).toBe(false);
    });
});
