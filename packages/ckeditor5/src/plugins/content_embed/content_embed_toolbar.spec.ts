import { ClassicEditor, Essentials, Paragraph, Plugin, toWidget, Widget, WidgetToolbarRepository, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import LinkEmbed from "../link_embed/link_embed.js";
import ContentEmbed, {
    CONVERT_EMBED_TO_LINK_COMMAND,
    CONTENT_EMBED_MENU,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_EDITABLE_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import ContentEmbedBoxSizeDropdown from "./content_embed_box_size_dropdown.js";
import ContentEmbedToolbar from "./content_embed_toolbar.js";
import ContentEmbedTools, { CONTENT_EMBED_TOOLS } from "./content_embed_tools.js";

// ---------------------------------------------------------------------------
// Minimal inline plugin that registers a widget without a class attribute.
// ---------------------------------------------------------------------------

class SectionNoClassWidget extends Plugin {
    static get requires() {
        return [Widget] as const;
    }

    init() {
        const editor = this.editor;
        const schema = editor.model.schema;

        schema.register("sectionNoClass", {
            isObject: true,
            allowWhere: "$block"
        });

        editor.conversion.for("upcast").elementToElement({
            model: "sectionNoClass",
            view: { name: "section", classes: "section-no-class-widget" }
        });

        editor.conversion.for("dataDowncast").elementToElement({
            model: "sectionNoClass",
            view: (_modelEl, { writer }) =>
                writer.createContainerElement("section", {})
        });

        editor.conversion.for("editingDowncast").elementToElement({
            model: "sectionNoClass",
            view: (_modelEl, { writer }) => {
                const section = writer.createContainerElement("section", {});
                return toWidget(section, writer, { label: "section no class widget" });
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelatedElementFn(ed: ClassicEditor): (selection: unknown) => unknown {
    const repository = ed.plugins.get(WidgetToolbarRepository) as unknown as {
        _toolbarDefinitions: Map<string, {
            getRelatedElement: (selection: unknown) => unknown;
        }>;
    };
    const def = repository._toolbarDefinitions.get("contentEmbed");
    if (!def) {
        throw new Error("ContentEmbed toolbar definition not found in WidgetToolbarRepository.");
    }
    return def.getRelatedElement;
}

/** A selection on nothing, standing in for the view selection. */
const EMPTY_SELECTION = { getSelectedElement: () => null, getFirstPosition: () => null };

// ---------------------------------------------------------------------------
// Suite 1: basic plugin registration (ContentEmbed only, no LinkEmbed)
// ---------------------------------------------------------------------------

describe("ContentEmbedToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadEmbeddedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown, ContentEmbedToolbar]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(ContentEmbedToolbar)).toBeInstanceOf(ContentEmbedToolbar);
    });

    it("declares the required plugins including WidgetToolbarRepository, ContentEmbed, and ContentEmbedBoxSizeDropdown", () => {
        const requires = ContentEmbedToolbar.requires;
        expect(requires).toContain(WidgetToolbarRepository);
        expect(requires).toContain(ContentEmbed);
        expect(requires).toContain(ContentEmbedBoxSizeDropdown);
        expect(requires).toContain(ContentEmbedTools);
    });

    it("offers the Editable toggle, the content's tools, then the embed's own items", () => {
        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, { itemsConfig: string[] }>;
        };

        expect(repository._toolbarDefinitions.get("contentEmbed")?.itemsConfig).toEqual([
            TOGGLE_EDITABLE_COMMAND_NAME,
            CONTENT_EMBED_TOOLS,
            "contentEmbedBoxSizeDropdown",
            TOGGLE_TITLE_COMMAND_NAME,
            TOGGLE_CAPTION_COMMAND_NAME,
            CONVERT_EMBED_TO_LINK_COMMAND,
            CONTENT_EMBED_MENU
        ]);
    });

    describe("getRelatedElement", () => {
        it("returns the include-note widget element when an contentEmbed model element is selected", () => {
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    throw new Error("No root");
                }
                const embedEl = writer.createElement("contentEmbed", {
                    noteId: "test-note",
                    boxSize: "small"
                });
                writer.insert(embedEl, root, 0);
                writer.setSelection(embedEl, "on");
            });

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).not.toBeNull();
        });

        it("stays on the embed while its caption is edited", () => {
            editor.setData("<figure class=\"include-note\" data-note-id=\"n1\""
                + " data-box-size=\"medium\"><figcaption>Caption</figcaption></figure>");
            editor.model.change((writer) => {
                const embed = editor.model.document.getRoot()?.getChild(0);
                const caption = embed?.is("element") ? embed.getChild(0) : null;
                if (!caption?.is("element", "caption")) {
                    throw new Error("Expected a caption.");
                }
                writer.setSelection(caption, 2);
            });

            const result = getRelatedElementFn(editor)(editor.editing.view.document.selection);

            expect(result).toBe(editor.editing.view.document.getRoot()?.getChild(0));
        });

        it("returns null when selection is inside a plain paragraph (not an include-note widget)", () => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).toBeNull();
        });

        it("returns null when the selection is on nothing", () => {
            expect(getRelatedElementFn(editor)(EMPTY_SELECTION)).toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// Suite 2: a widget without a class attribute
// ---------------------------------------------------------------------------

describe("isContentEmbedWidget — widget without a class attribute", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadEmbeddedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown, ContentEmbedToolbar, SectionNoClassWidget]);
    });

    it("returns null for a selected widget that has no class attribute", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const noClassEl = writer.createElement("sectionNoClass");
            writer.insert(noClassEl, root, 0);
            writer.setSelection(noClassEl, "on");
        });

        const fn = getRelatedElementFn(editor);
        const viewSelection = editor.editing.view.document.selection;
        expect(fn(viewSelection)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Suite 3: real widgets that are not embeds
// ---------------------------------------------------------------------------

describe("isContentEmbedWidget — real non-include-note widgets", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadEmbeddedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({
                loadEmbeddedNote,
                renderLinkEmbed: vi.fn(),
                renderLinkMention: vi.fn(),
                fetchLinkMetadata: async () => ({
                    url: "https://example.com",
                    embedType: "opengraph",
                    title: "Example",
                    description: "",
                    favicon: "",
                    siteName: "",
                    image: ""
                }),
                detectEmbedType: () => "opengraph"
            })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown, ContentEmbedToolbar, LinkEmbed]);
    });

    it("returns null when the selected element is not a widget", () => {
        // isWidget() checks for a custom property that this lookalike lacks.
        const fakeNonWidget = {
            is: (type: string) => type === "element",
            hasClass: (className: string) => className === "include-note",
            getCustomProperty: (_key: unknown) => undefined
        };

        const result = getRelatedElementFn(editor)({
            ...EMPTY_SELECTION,
            getSelectedElement: () => fakeNonWidget
        });
        expect(result).toBeNull();
    });

    it("returns null for a selected span.link-mention widget", () => {
        editor.setData('<p><span class="link-mention" data-url="https://example.com">example</span></p>');

        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const para = root.getChild(0);
            if (!para || !para.is("element")) {
                throw new Error("No paragraph");
            }
            const mention = para.getChild(0);
            if (!mention || !mention.is("element")) {
                throw new Error("No mention element");
            }
            writer.setSelection(mention, "on");
        });

        const fn = getRelatedElementFn(editor);
        const viewSelection = editor.editing.view.document.selection;
        expect(fn(viewSelection)).toBeNull();
    });

    it("returns null for a selected section.link-embed widget", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );

        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                throw new Error("No embed element");
            }
            writer.setSelection(embed, "on");
        });

        const fn = getRelatedElementFn(editor);
        const viewSelection = editor.editing.view.document.selection;
        expect(fn(viewSelection)).toBeNull();
    });

    it("returns the include-note element when a real include-note widget is selected (full happy path)", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const embedEl = writer.createElement("contentEmbed", {
                noteId: "abc",
                boxSize: "full"
            });
            writer.insert(embedEl, root, 0);
            writer.setSelection(embedEl, "on");
        });

        const fn = getRelatedElementFn(editor);
        const viewSelection = editor.editing.view.document.selection;
        expect(fn(viewSelection)).not.toBeNull();
    });
});
