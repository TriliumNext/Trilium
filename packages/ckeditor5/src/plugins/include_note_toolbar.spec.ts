import { ClassicEditor, Essentials, Paragraph, Plugin, toWidget, Widget, WidgetToolbarRepository, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import IncludeNote from "./includenote.js";
import IncludeNoteBoxSizeDropdown from "./include_note_box_size_dropdown.js";
import IncludeNoteToolbar from "./include_note_toolbar.js";
import LinkEmbed from "./linkembed.js";

// ---------------------------------------------------------------------------
// Minimal inline plugin that registers a section widget WITHOUT a class
// attribute, allowing us to exercise the `|| ""` branch in isIncludeNoteWidget.
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
                // Intentionally no class attribute — exercises the `|| ""` branch.
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
    const def = repository._toolbarDefinitions.get("includeNote");
    if (!def) {
        throw new Error("IncludeNote toolbar definition not found in WidgetToolbarRepository.");
    }
    return def.getRelatedElement;
}

// ---------------------------------------------------------------------------
// Suite 1: basic plugin registration (IncludeNote only, no LinkEmbed)
// ---------------------------------------------------------------------------

describe("IncludeNoteToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadIncludedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote, IncludeNoteBoxSizeDropdown, IncludeNoteToolbar]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(IncludeNoteToolbar)).toBeInstanceOf(IncludeNoteToolbar);
    });

    it("declares the required plugins including WidgetToolbarRepository, IncludeNote, and IncludeNoteBoxSizeDropdown", () => {
        const requires = IncludeNoteToolbar.requires;
        expect(requires).toContain(WidgetToolbarRepository);
        expect(requires).toContain(IncludeNote);
        expect(requires).toContain(IncludeNoteBoxSizeDropdown);
    });

    it("registers the includeNote toolbar in WidgetToolbarRepository", () => {
        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, unknown>;
        };
        expect(repository._toolbarDefinitions.has("includeNote")).toBe(true);
    });

    describe("getRelatedElement", () => {
        it("returns the include-note widget element when an includeNote model element is selected", () => {
            editor.model.change((writer) => {
                const root = editor.model.document.getRoot();
                if (!root) {
                    throw new Error("No root");
                }
                const includeNoteEl = writer.createElement("includeNote", {
                    noteId: "test-note",
                    boxSize: "small"
                });
                writer.insert(includeNoteEl, root, 0);
                writer.setSelection(includeNoteEl, "on");
            });

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).not.toBeNull();
        });

        it("returns null when selection is inside a plain paragraph (not an include-note widget)", () => {
            setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

            const fn = getRelatedElementFn(editor);
            const viewSelection = editor.editing.view.document.selection;
            const result = fn(viewSelection);
            expect(result).toBeNull();
        });

        it("returns null when getSelectedElement returns null", () => {
            const fn = getRelatedElementFn(editor);
            const fakeSelection = { getSelectedElement: () => null };
            const result = fn(fakeSelection);
            expect(result).toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// Suite 2: || "" fallback branch (line 43) — widget section with no class attr
// ---------------------------------------------------------------------------

describe("isIncludeNoteWidget — section widget without a class attribute (|| '' branch)", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadIncludedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote, IncludeNoteBoxSizeDropdown, IncludeNoteToolbar, SectionNoClassWidget]);
    });

    it("returns null for a section widget that has no class attribute (exercises the || '' fallback at line 43)", () => {
        // The SectionNoClassWidget editing downcast creates a real CKEditor widget (toWidget)
        // wrapping a <section> element with NO class attribute.  When that widget is selected:
        //   isWidget(element)          → true  (real widget marker)
        //   element.is("element","section") → true
        //   element.getAttribute("class")   → null/undefined  →  || ""  → ""
        //   "".includes("include-note")     → false  →  return false
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
        const result = fn(viewSelection);
        // No "include-note" class → must return null.
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Suite 3: isIncludeNoteWidget branches — uses LinkEmbed to get real widgets
// that pass isWidget() but are NOT include-note sections.
// ---------------------------------------------------------------------------

describe("isIncludeNoteWidget — real non-include-note widgets (branch coverage)", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        const loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({
                loadIncludedNote,
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

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote, IncludeNoteBoxSizeDropdown, IncludeNoteToolbar, LinkEmbed]);
    });

    it("returns null when getSelectedElement returns a non-widget element (covers the !isWidget branch at line 35-36)", () => {
        // To hit `return false` at line 36 in isIncludeNoteWidget we need a non-null
        // selected element for which isWidget() returns false.  A plain JS object
        // that looks like a ViewElement but lacks the CKEditor widget marker is sufficient.
        const fn = getRelatedElementFn(editor);

        // Fake element: is("element","section") would be true, getAttribute returns
        // "include-note", but isWidget() checks for an internal custom property symbol
        // that is absent here → isWidget returns false → isIncludeNoteWidget returns false.
        const fakeNonWidget = {
            is: (type: string, name: string) => type === "element" && name === "section",
            getAttribute: (attr: string) => attr === "class" ? "include-note" : null,
            getCustomProperty: (_key: unknown) => undefined
        };

        const result = fn({ getSelectedElement: () => fakeNonWidget });
        expect(result).toBeNull();
    });

    it("returns null for a span.link-mention widget (isWidget=true but element is not a section — covers line 39-40)", () => {
        // span.link-mention is a real CKEditor inline widget wrapping a <span>.
        // isWidget() returns true for it, but element.is("element", "section") is false →
        // isIncludeNoteWidget returns false at line 40.
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
        const result = fn(viewSelection);
        // span.link-mention passes isWidget() but is not a section → returns null.
        expect(result).toBeNull();
    });

    it("returns null for a section.link-embed widget (isWidget=true, is section, but class lacks 'include-note' — covers line 43-44)", () => {
        // section.link-embed is a real CKEditor block widget wrapping a <section>.
        // isWidget() returns true, element.is("element", "section") is true, but the class
        // attribute is "link-embed" which does NOT include "include-note" →
        // isIncludeNoteWidget returns false at line 44.
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
        const result = fn(viewSelection);
        // section.link-embed passes isWidget() and is a section, but the class
        // does not contain "include-note" → returns null.
        expect(result).toBeNull();
    });

    it("returns the include-note element when a real include-note widget is selected (full happy path)", () => {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("No root");
            }
            const includeNoteEl = writer.createElement("includeNote", {
                noteId: "abc",
                boxSize: "full"
            });
            writer.insert(includeNoteEl, root, 0);
            writer.setSelection(includeNoteEl, "on");
        });

        const fn = getRelatedElementFn(editor);
        const viewSelection = editor.editing.view.document.selection;
        const result = fn(viewSelection);
        expect(result).not.toBeNull();
    });
});
