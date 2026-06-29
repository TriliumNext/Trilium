import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    Mention,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import MentionCustomization from "./mention_customization.js";
import ReferenceLink from "./referencelink.js";

describe("MentionCustomization", () => {
    let editor: ClassicEditor;
    let createNoteForReferenceLink: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        createNoteForReferenceLink = vi.fn(async () => "createdNotePath");
        installGlobMock({
            getComponentByEl: () => ({
                createNoteForReferenceLink,
                loadReferenceLinkTitle: vi.fn(async () => {})
            }),
            getReferenceLinkTitle: vi.fn(async () => "Some title"),
            getReferenceLinkTitleSync: () => "Some title"
        });

        editor = await createTestEditor([
            Essentials,
            Paragraph,
            Mention,
            ReferenceLink,
            MentionCustomization
        ]);
    });

    it("loads the plugin, requires Mention and overrides the mention command", () => {
        expect(editor.plugins.get(MentionCustomization)).toBeInstanceOf(MentionCustomization);
        expect(MentionCustomization.pluginName).toBe("MentionCustomization");
        expect(MentionCustomization.requires).toContain(Mention);
        expect(editor.commands.get("mention")).toBeDefined();
    });

    it("inserts the raw text when the mention id starts with '#' (attribute autocomplete)", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("mention", { mention: { id: "#myLabel" }, marker: "#" });

        expect(getModelData(editor.model)).toContain("foo#myLabel");
    });

    it("inserts the raw text when the mention id starts with '~' (relation autocomplete)", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("mention", { mention: { id: "~myRelation" }, marker: "~" });

        expect(getModelData(editor.model)).toContain("foo~myRelation");
    });

    it("inserts a reference link directly when a note mention is selected", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("mention", {
            mention: { id: "@Some note", notePath: "noteAbc" },
            marker: "@"
        });

        // The referenceLink command inserts the reference element only after
        // glob.getReferenceLinkTitle resolves.
        await Promise.resolve();
        await Promise.resolve();

        expect(getModelData(editor.model)).toContain("<reference");
        expect(getModelData(editor.model)).toContain("noteAbc");
    });

    it("creates a note then inserts the reference link for a create-note mention", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("mention", {
            mention: { id: "@Brand new note", action: "create-note", noteTitle: "Brand new note" },
            marker: "@"
        });

        expect(createNoteForReferenceLink).toHaveBeenCalledWith("Brand new note");

        // Wait for the createNoteForReferenceLink promise (and the chained
        // getReferenceLinkTitle promise from the referenceLink command) to resolve.
        await Promise.resolve();
        await Promise.resolve();

        expect(getModelData(editor.model)).toContain("<reference");
        expect(getModelData(editor.model)).toContain("createdNotePath");
    });

    it("uses the provided range instead of the current selection when inserting a reference", async () => {
        setModelData(editor.model, "<paragraph>[]foobar</paragraph>");

        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("No root");
        }
        const paragraph = root.getChild(0);
        if (!paragraph || !paragraph.is("element")) {
            throw new Error("No paragraph");
        }

        const range = editor.model.createRange(
            editor.model.createPositionAt(paragraph, 0),
            editor.model.createPositionAt(paragraph, 3)
        );

        editor.execute("mention", {
            mention: { id: "@Some note", notePath: "noteWithRange" },
            marker: "@",
            range
        });

        // The referenceLink command inserts the reference element only after
        // glob.getReferenceLinkTitle resolves.
        await Promise.resolve();
        await Promise.resolve();

        const data = getModelData(editor.model);
        expect(data).toContain("<reference");
        expect(data).toContain("noteWithRange");
        // The first three characters ("foo") were replaced by the range insertion.
        expect(data).toContain("bar");
    });
});
