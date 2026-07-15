import { ClassicEditor, Essentials, Paragraph, WidgetToolbarRepository, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import LinkEmbedToolbar from "./link_embed_toolbar.js";
import LinkEmbed, { CHANGE_LINK_DISPLAY_COMMAND, LINK_DISPLAY_MODES } from "./linkembed.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DropdownView = {
    isEnabled: boolean;
    isOpen: boolean;
    buttonView: { label: string | undefined; withText: boolean; tooltip: boolean };
    panelView: {
        children: {
            get(idx: number): ListView;
        };
    };
    bind(prop: string): { to(target: unknown, prop: string, fn?: (v: unknown) => unknown): void };
    fire(event: string, data?: unknown): void;
};

type ListView = {
    items: {
        length: number;
        get(idx: number): ListItemView;
    };
};

type ListItemView = {
    children: {
        get(idx: number): ListButtonView;
    };
};

type ListButtonView = {
    _displayMode?: string;
    isOn?: boolean;
    isVisible?: boolean;
    label?: string;
    fire(evt: string): void;
};

function openDropdown(dropdown: DropdownView): ListView {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) {
        throw new Error("Dropdown panel did not render a list view after opening.");
    }
    return listView;
}

function getToolbarDef(editor: ClassicEditor): {
    itemsConfig?: string[];
    balloonClassName?: string;
    getRelatedElement(selection: unknown): unknown;
} | undefined {
    const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
        _toolbarDefinitions: Map<string, {
            itemsConfig?: string[];
            balloonClassName?: string;
            getRelatedElement(selection: unknown): unknown;
        }>;
    };
    return repository._toolbarDefinitions.get("linkEmbed");
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("LinkEmbedToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        installGlobMock({
            getComponentByEl: () => ({
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

        editor = await createTestEditor([Essentials, Paragraph, LinkEmbed, LinkEmbedToolbar]);
    });

    // -----------------------------------------------------------------------
    // Plugin registration
    // -----------------------------------------------------------------------

    it("loads the plugin", () => {
        expect(editor.plugins.get(LinkEmbedToolbar)).toBeInstanceOf(LinkEmbedToolbar);
    });

    it("declares WidgetToolbarRepository as a required plugin", () => {
        const requires = LinkEmbedToolbar.requires;
        expect(requires).toContain(WidgetToolbarRepository);
    });

    it("declares LinkEmbed as a required plugin", () => {
        const requires = LinkEmbedToolbar.requires;
        expect(requires).toContain(LinkEmbed);
    });

    it("registers the linkEmbed toolbar in WidgetToolbarRepository", () => {
        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, unknown>;
        };
        expect(repository._toolbarDefinitions.has("linkEmbed")).toBe(true);
    });

    it("registered toolbar contains the linkEmbedDisplayDropdown item", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        expect(def?.itemsConfig).toContain("linkEmbedDisplayDropdown");
    });

    it("registered toolbar has the correct balloonClassName", () => {
        const def = getToolbarDef(editor);
        expect(def?.balloonClassName).toBe("ck-toolbar-container link-embed-toolbar");
    });

    // -----------------------------------------------------------------------
    // getRelatedElement — linkEmbed widget (section.link-embed)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns the element when a linkEmbed widget is selected", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );

        // Select the widget element in the model.
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });

        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        const viewSelection = editor.editing.view.document.selection;
        const result = def.getRelatedElement(viewSelection);
        expect(result).not.toBeNull();
    });

    it("getRelatedElement returns null when selection is in a plain paragraph", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        const viewSelection = editor.editing.view.document.selection;
        const result = def.getRelatedElement(viewSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // getRelatedElement — linkMention widget (span.link-mention)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns the element when a linkMention widget is selected", () => {
        editor.setData(
            '<p><span class="link-mention" data-url="https://example.com">example</span></p>'
        );

        // Select the inline widget element in the model.
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const para = root.getChild(0);
            if (!para || !para.is("element")) {
                return;
            }
            const mention = para.getChild(0);
            if (!mention || !mention.is("element")) {
                return;
            }
            writer.setSelection(mention, "on");
        });

        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        const viewSelection = editor.editing.view.document.selection;
        const result = def.getRelatedElement(viewSelection);
        expect(result).not.toBeNull();
    });

    // -----------------------------------------------------------------------
    // getRelatedElement — no element selected (null path)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns null when getSelectedElement returns null", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        // Provide a stub selection whose getSelectedElement returns null.
        const fakeSelection = { getSelectedElement: () => null };
        const result = def.getRelatedElement(fakeSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // isLinkEmbedWidget — non-widget element (line 45: return false)
    // isWidget checks: node.is('element') && !!node.getCustomProperty('widget')
    // -----------------------------------------------------------------------

    it("getRelatedElement returns null when the selected element is not a widget", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        // Fake a ViewElement that passes is('element') but has no 'widget' custom property,
        // so isWidget() returns false → isLinkEmbedWidget line 45 is reached.
        const fakeNonWidget = {
            getCustomProperty: (_key: string) => undefined,
            is: (type: string, _name?: string) => type === "element",
            getAttribute: () => null
        };
        const fakeSelection = { getSelectedElement: () => fakeNonWidget };
        const result = def.getRelatedElement(fakeSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // isLinkEmbedWidget — widget that is neither section nor span (line 57: return false)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns null when the selected widget is a div (not section or span)", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        // Fake a widget (has 'widget' custom property) but element name is "div" — neither
        // "section" nor "span" — so isLinkEmbedWidget reaches the final return false (line 57).
        const fakeDivWidget = {
            getCustomProperty: (key: string) => (key === "widget" ? true : undefined),
            is: (type: string, name?: string) => {
                // isWidget first checks is('element') with no name arg.
                if (type === "element" && name === undefined) return true;
                // Then isLinkEmbedWidget checks is('element', 'section') and is('element', 'span').
                return false; // "div" matches neither
            },
            getAttribute: () => null
        };
        const fakeSelection = { getSelectedElement: () => fakeDivWidget };
        const result = def.getRelatedElement(fakeSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // isLinkEmbedWidget — section widget without class attribute (branch line 50)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns null for a section widget that has no class attribute", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        // A widget <section> with getAttribute('class') returning null —
        // "" is used via the || "" fallback, and "".includes("link-embed") is false.
        const fakeSectionWidget = {
            getCustomProperty: (key: string) => (key === "widget" ? true : undefined),
            is: (type: string, name?: string) => {
                if (type === "element" && name === undefined) return true;
                if (type === "element" && name === "section") return true;
                return false;
            },
            getAttribute: (_attr: string) => null
        };
        const fakeSelection = { getSelectedElement: () => fakeSectionWidget };
        const result = def.getRelatedElement(fakeSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // isLinkEmbedWidget — span widget without class attribute (branch lines 53-54)
    // -----------------------------------------------------------------------

    it("getRelatedElement returns null for a span widget that has no class attribute", () => {
        const def = getToolbarDef(editor);
        expect(def).toBeDefined();
        if (!def) {
            return;
        }
        // A widget <span> with getAttribute('class') returning null —
        // "" is used via the || "" fallback, and "".includes("link-mention") is false.
        const fakeSpanWidget = {
            getCustomProperty: (key: string) => (key === "widget" ? true : undefined),
            is: (type: string, name?: string) => {
                if (type === "element" && name === undefined) return true;
                if (type === "element" && name === "section") return false;
                if (type === "element" && name === "span") return true;
                return false;
            },
            getAttribute: (_attr: string) => null
        };
        const fakeSelection = { getSelectedElement: () => fakeSpanWidget };
        const result = def.getRelatedElement(fakeSelection);
        expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // LinkEmbedDisplayDropdown component factory
    // -----------------------------------------------------------------------

    it("registers the linkEmbedDisplayDropdown component in the factory", () => {
        expect(editor.ui.componentFactory.has("linkEmbedDisplayDropdown")).toBe(true);
    });

    it("dropdown buttonView has withText and tooltip set", () => {
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        expect(dropdown.buttonView.withText).toBe(true);
        expect(dropdown.buttonView.tooltip).toBe(true);
    });

    it("dropdown is disabled when there is no linkEmbed/linkMention widget selected", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        expect(dropdown.isEnabled).toBe(false);
    });

    it("dropdown is enabled when a linkEmbed widget is selected", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        expect(dropdown.isEnabled).toBe(true);
    });

    it("button label shows 'Display' when command value is null (no widget selected)", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        expect(dropdown.buttonView.label).toBe("Display");
    });

    it("button label shows the mode label when a linkEmbed widget with opengraph embedType is selected", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        // embedType "opengraph" maps to mode "card"
        const cardMode = LINK_DISPLAY_MODES.find(m => m.value === "card");
        expect(dropdown.buttonView.label).toBe(cardMode?.label);
    });

    // -----------------------------------------------------------------------
    // Dropdown list items
    // -----------------------------------------------------------------------

    it("dropdown panel contains one list item per LINK_DISPLAY_MODES entry", () => {
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);
        expect(listView.items.length).toBe(LINK_DISPLAY_MODES.length);
    });

    it("each list item has the correct _displayMode", () => {
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        for (let i = 0; i < LINK_DISPLAY_MODES.length; i++) {
            const item = listView.items.get(i);
            const button = item.children.get(0);
            expect(button._displayMode).toBe(LINK_DISPLAY_MODES[i].value);
        }
    });

    it("each list item has the correct label", () => {
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        for (let i = 0; i < LINK_DISPLAY_MODES.length; i++) {
            const item = listView.items.get(i);
            const button = item.children.get(0);
            expect(button.label).toBe(LINK_DISPLAY_MODES[i].label);
        }
    });

    it("list item isOn is true for the matching mode when a card linkEmbed is selected", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });

        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as { value: string | null };
        // embedType "opengraph" → mode "card"
        expect(command.value).toBe("card");

        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // Find the "card" item and verify it is on.
        let cardButton: ListButtonView | null = null;
        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button._displayMode === "card") {
                cardButton = button;
                break;
            }
        }
        expect(cardButton).not.toBeNull();
        expect(cardButton?.isOn).toBe(true);
    });

    it("list items for non-active modes have isOn false", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });

        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button._displayMode !== "card") {
                expect(button.isOn).toBe(false);
            }
        }
    });

    it("embed list item is not visible when embedAvailable is false", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as unknown as { embedAvailable: boolean };
        expect(command.embedAvailable).toBe(false);

        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        let embedButton: ListButtonView | null = null;
        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button._displayMode === "embed") {
                embedButton = button;
                break;
            }
        }
        expect(embedButton).not.toBeNull();
        expect(embedButton?.isVisible).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Dropdown execute event
    // -----------------------------------------------------------------------

    it("fires the changeLinkDisplay command with the selected display mode on execute", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });

        const spy = vi.spyOn(editor, "execute");
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // Find the "inline" button and fire execute.
        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button._displayMode === "inline") {
                button.fire("execute");
                break;
            }
        }

        expect(spy).toHaveBeenCalledWith(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" });
    });

    it("focuses the editing view after dropdown execute", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://example.com" data-embed-type="opengraph"></section>'
        );
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const embed = root.getChild(0);
            if (!embed || !embed.is("element")) {
                return;
            }
            writer.setSelection(embed, "on");
        });

        const focusSpy = vi.spyOn(editor.editing.view, "focus");
        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        const firstButton = listView.items.get(0).children.get(0);
        firstButton.fire("execute");

        expect(focusSpy).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Button label fallback for unknown mode value
    // -----------------------------------------------------------------------

    it("button label falls back to the raw value when the mode is not in LINK_DISPLAY_MODES", () => {
        // Exercise the `mode?.label ?? value` fallback on line 85.
        // Create the dropdown first (which wires up the binding), then set the
        // command's observable value to a string not present in LINK_DISPLAY_MODES.
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as {
            set(prop: string, value: unknown): void;
            value: string | null;
        };

        const dropdown = editor.ui.componentFactory.create("linkEmbedDisplayDropdown") as unknown as DropdownView;

        // Force an unknown value directly on the observable — bypasses the normal
        // refresh() flow, so LINK_DISPLAY_MODES.find() returns undefined and the
        // binding must fall back to returning the raw value string.
        command.set("value", "custom-unknown-mode");

        // The binding transform receives "custom-unknown-mode"; mode will be
        // undefined, so `mode?.label ?? value` returns "custom-unknown-mode".
        expect(dropdown.buttonView.label).toBe("custom-unknown-mode");
    });

    // -----------------------------------------------------------------------
    // The balloon's other items: open-link, copy-URL and unlink
    // -----------------------------------------------------------------------

    describe("link, copy and unlink buttons", () => {
        const URL = "https://example.com/page";
        let copy: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            copy = vi.fn();
            // The copy button reaches the host through these two config entries, which the editor
            // config type does not declare (the host sets them the same way, via a cast).
            const hostConfig = {
                clipboard: { copy },
                translate: (key: string) => `translated:${key}`
            } as unknown as Parameters<typeof createTestEditor>[1];

            editor = await createTestEditor([Essentials, Paragraph, LinkEmbed, LinkEmbedToolbar], hostConfig);
        });

        function selectLinkMention() {
            setModelData(editor.model, `<paragraph>[<linkMention url="${URL}" title="T"></linkMention>]</paragraph>`);
        }

        function createButton(name: string) {
            return editor.ui.componentFactory.create(name) as unknown as ToolbarButton;
        }

        it("linkEmbedLink is an <a target=_blank> bound to the selected widget's URL", () => {
            const button = createButton("linkEmbedLink");
            button.render();

            // Nothing selected: the command exposes no URL, so the button is inert.
            expect(button.isEnabled).toBe(false);
            expect(button.label).toBeUndefined();
            expect(button.href).toBeUndefined();

            selectLinkMention();

            expect(button.isEnabled).toBe(true);
            expect(button.label).toBe(URL);
            expect(button.href).toBe(URL);

            // Rendered as a real anchor so a click opens the page in a new tab, reusing
            // CKEditor's own link-toolbar styling.
            expect(button.element?.tagName).toBe("A");
            expect(button.element?.getAttribute("href")).toBe(URL);
            expect(button.element?.getAttribute("target")).toBe("_blank");
            expect(button.element?.getAttribute("rel")).toBe("noopener noreferrer");
            expect(button.element?.classList.contains("ck-link-toolbar__preview")).toBe(true);
        });

        it("linkEmbedCopyUrl copies the selected widget's URL through the host clipboard", () => {
            const button = createButton("linkEmbedCopyUrl");
            expect(button.label).toBe("translated:link.copy_url");

            // With nothing selected there is no URL, so nothing is copied.
            button.fire("execute");
            expect(copy).not.toHaveBeenCalled();

            selectLinkMention();
            button.fire("execute");
            expect(copy).toHaveBeenCalledWith(URL);
        });

        it("linkEmbedUnlink is enabled only for a selected widget and unlinks it", () => {
            const button = createButton("linkEmbedUnlink");
            expect(button.isEnabled).toBe(false);

            selectLinkMention();
            expect(button.isEnabled).toBe(true);

            button.fire("execute");

            // The widget is gone, leaving the bare URL as plain text.
            expect(editor.getData()).toBe(`<p>${URL}</p>`);
        });
    });
});

type ToolbarButton = {
    isEnabled: boolean;
    label?: string;
    href?: string;
    element?: HTMLElement | null;
    render(): void;
    fire(evt: string): void;
};
