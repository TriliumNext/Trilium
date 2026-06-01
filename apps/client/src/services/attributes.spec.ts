import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import attributeService, { removeOwnedAttributesByNameOrType, setAttribute, setBooleanWithInheritance, setLabel, setRelation } from "./attributes";
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
