import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    MentionEditing,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TriliumMentionUI from "./mention/trilium_mention_ui.js";
import type { MentionHostedList, MentionHostedListState } from "./mention/types.js";
import MentionCustomization from "./mention_customization.js";
import ReferenceLink from "./referencelink.js";

describe("MentionCustomization", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials,
            Paragraph,
            MentionEditing,
            TriliumMentionUI,
            ReferenceLink,
            MentionCustomization
        ], {
            referenceLink: {
                getTitle: vi.fn(async () => "Some title"),
                getTitleSync: () => "Some title"
            }
        });
    });

    it("loads the plugin, requires the mention editing/UI pair and overrides the mention command", () => {
        expect(editor.plugins.get(MentionCustomization)).toBeInstanceOf(MentionCustomization);
        expect(MentionCustomization.pluginName).toBe("MentionCustomization");
        expect(MentionCustomization.requires).toContain(MentionEditing);
        expect(MentionCustomization.requires).toContain(TriliumMentionUI);
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
        // referenceLink.getTitle resolves.
        await Promise.resolve();
        await Promise.resolve();

        expect(getModelData(editor.model)).toContain("<reference");
        expect(getModelData(editor.model)).toContain("noteAbc");
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
        // referenceLink.getTitle resolves.
        await Promise.resolve();
        await Promise.resolve();

        const data = getModelData(editor.model);
        expect(data).toContain("<reference");
        expect(data).toContain("noteWithRange");
        // The first three characters ("foo") were replaced by the range insertion.
        expect(data).toContain("bar");
    });

    it("lets a list follow up on the link to a note, which its next mention replaces", async () => {
        const shown: { state: MentionHostedListState | null } = { state: null };
        const list: MentionHostedList = {
            show: (state) => { shown.state = state; },
            hide: () => { shown.state = null; },
            handleKeyDown: () => false,
            element: document.createElement("div")
        };
        const hosted = await createTestEditor([
            Essentials, Paragraph, MentionEditing, TriliumMentionUI, ReferenceLink,
            MentionCustomization
        ], {
            referenceLink: { getTitle: async () => "Some title", getTitleSync: () => "Some title" },
            mention: {
                feeds: [],
                hostedFeeds: [ { marker: "@", allowSpaces: true, list: () => list } ]
            }
        });
        const { model } = hosted;
        const type = (text: string) => model.change((writer) => {
            const caret = model.document.selection.getFirstPosition();
            model.insertContent(writer.createText(text), caret);
        });
        const linkTo = (href: string) =>
            `see <reference href="${href}" storedTitle="Some title"></reference>`;
        /** The paragraph's content, and whether the editing view marks each link in it. */
        const content = () => {
            const links = hosted.editing.view.getDomRoot()?.querySelectorAll("a.reference-link");
            return {
                model: getModelData(model, { withoutSelection: true })
                    .replace(/^<paragraph>|<\/paragraph>$/g, ""),
                marked: [ ...links ?? [] ]
                    .map((link) => link.classList.contains("ck-mention-follow-up"))
            };
        };
        // The `referenceLink` command inserts the link once the title of its note is loaded.
        const titleLoaded = () => new Promise((resolve) => setTimeout(resolve));
        setModelData(model, "<paragraph>see []</paragraph>");

        type("@al");
        shown.state?.commitAndFollowUp({ id: "@noteAbc", notePath: "noteAbc" });
        expect(content()).toEqual({ model: "see ", marked: [] });
        expect(shown.state?.followUpOf).toBe(null);
        await titleLoaded();
        expect(content()).toEqual({ model: linkTo("#noteAbc"), marked: [ true ] });
        expect(shown.state).toMatchObject({ query: "", followUpOf: { notePath: "noteAbc" } });

        type("in");
        expect(shown.state?.query).toBe("in");
        shown.state?.commit({ id: "@noteAbc?block=b1", notePath: "noteAbc?block=b1" });
        expect(shown.state).toBe(null);
        await titleLoaded();
        expect(content()).toEqual({ model: linkTo("#noteAbc?block=b1"), marked: [ false ] });
    });
});
