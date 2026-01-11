import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import { setBooleanWithInheritance } from "./attributes";
import froca from "./froca";
import server from "./server.js";

// Spy on server methods to track calls
// @ts-expect-error the generic typing is causing issues here
server.put = vi.fn(async <T> (url: string, data?: T) => ({} as T));
// @ts-expect-error the generic typing is causing issues here
server.remove = vi.fn(async <T> (url: string) => ({} as T));

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
        });
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
        });
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
        });
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
        });
    });
});
