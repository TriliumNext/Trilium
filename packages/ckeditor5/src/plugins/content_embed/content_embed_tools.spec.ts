import {
    ClassicEditor, DropdownView, Essentials, LinkEditing, Paragraph, Widget,
    _setModelData as setModelData
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import ReferenceLink from "../referencelink.js";
import ContentEmbed from "./content_embed.js";
import ContentEmbedBoxSizeDropdown from "./content_embed_box_size_dropdown.js";
import ContentEmbedTools, {
    CONTENT_EMBED_TOOLS, ContentEmbedToolsView
} from "./content_embed_tools.js";

const ICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"></svg>";
const SELECTION: Tool = {
    id: "selection", label: "Selection", text: "1", isOn: true, group: "tools"
};
const RECTANGLE: Tool = {
    id: "rectangle", label: "Rectangle", text: "2", isOn: false, group: "tools"
};
const UNDO: Tool = { id: "undo", label: "Undo", icon: ICON, isEnabled: false, group: "history" };

interface Tool {
    id: string;
    label: string;
    text?: string;
    icon?: string;
    isOn?: boolean;
    isEnabled?: boolean;
    group?: string;
    children?: Tool[];
    class?: string;
}

const MORE_TOOLS: Tool = {
    id: "more",
    label: "More tools",
    icon: ICON,
    isOn: false,
    group: "more",
    children: [
        { id: "eraser", label: "Eraser", icon: ICON, isOn: false },
        { id: "laser", label: "Laser pointer", isOn: true }
    ]
};

describe("ContentEmbedTools", () => {
    let editor: ClassicEditor;
    let provider: ReturnType<typeof createProvider>;
    let getContentEmbedTools: ReturnType<typeof vi.fn>;
    let view: ContentEmbedToolsView | undefined;

    beforeEach(async () => {
        provider = createProvider([ SELECTION, RECTANGLE ]);
        getContentEmbedTools = vi.fn(() => provider);
        installGlobMock({
            getComponentByEl: () => ({ loadEmbeddedNote: vi.fn(), getContentEmbedTools })
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Widget, LinkEditing, ReferenceLink, ContentEmbed,
            ContentEmbedBoxSizeDropdown, ContentEmbedTools
        ]);
    });

    afterEach(() => {
        view?.element?.remove();
        view = undefined;
    });

    function createView() {
        const created = editor.ui.componentFactory.create(CONTENT_EMBED_TOOLS);
        if (!(created instanceof ContentEmbedToolsView)) {
            throw new Error("Expected the tools view.");
        }
        created.render();
        view = created;
        return created;
    }

    function selectEmbed() {
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("The editor has no root.");
            }
            const embed = writer.createElement("contentEmbed", { noteId: "n1", boxSize: "medium" });
            writer.insert(embed, root, 0);
            writer.setSelection(embed, "on");
        });
        editor.ui.update();
    }

    function getButtonStates(tools: ContentEmbedToolsView) {
        return getButtons(tools).map((button) => [
            button.label, button.withText, button.icon, button.tooltip, button.ariaLabel,
            button.isToggleable, button.isOn, button.isEnabled
        ]);
    }

    /** The button of each tool: its own, or the one that opens its menu. */
    function getButtons(tools: ContentEmbedToolsView) {
        return tools.views.map((item) => item instanceof DropdownView ? item.buttonView : item);
    }

    /** The labels of the buttons, and `|` for each separator, in order. */
    function getItems(tools: ContentEmbedToolsView) {
        return [ ...tools.element?.children ?? [] ].map((item) =>
            item.classList.contains("ck-toolbar__separator") ? "|" : item.textContent);
    }

    it("shows the tools of the selected embed's content, and hides them elsewhere", () => {
        const tools = createView();
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        editor.ui.update();
        expect(getContentEmbedTools).not.toHaveBeenCalled();
        expect(tools.element?.classList.contains("ck-hidden")).toBe(true);

        selectEmbed();
        editor.ui.update();
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        expect(getContentEmbedTools).toHaveBeenLastCalledWith(embed);
        expect(provider.subscribe).toHaveBeenCalledTimes(1);
        expect(tools.element?.classList.contains("ck-hidden")).toBe(false);
        expect(getButtonStates(tools)).toEqual([
            [ "1", true, undefined, "Selection", "Selection", true, true, true ],
            [ "2", true, undefined, "Rectangle", "Rectangle", true, false, true ]
        ]);

        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        editor.ui.update();
        expect(provider.unsubscribe).toHaveBeenCalledTimes(1);
        expect(tools.isVisible).toBe(false);
    });

    it("shows a command with an icon, and separates the groups of tools", () => {
        const tools = createView();
        selectEmbed();

        provider.change([ SELECTION, RECTANGLE, UNDO ]);
        expect(getButtonStates(tools)[2])
            .toEqual([ "Undo", false, ICON, "Undo", "Undo", false, false, false ]);
        expect(getItems(tools)).toEqual([ "1", "2", "|", "Undo" ]);

        provider.change([ { id: "a", label: "A", text: "A" }, { id: "b", label: "B", text: "B" } ]);
        expect(getItems(tools)).toEqual([ "A", "B" ]);

        provider.change([ SELECTION, RECTANGLE, { ...UNDO, isEnabled: true, class: "undo" } ]);
        expect(getButtons(tools)[2]?.isEnabled).toBe(true);
        expect(getButtons(tools)[2]?.element?.classList.contains("undo")).toBe(true);
    });

    it("shows the children of a tool in a menu, without taking the focus", () => {
        const tools = createView();
        selectEmbed();
        provider.change([ RECTANGLE, MORE_TOOLS ]);
        const menu = tools.views[1];
        if (!(menu instanceof DropdownView)) {
            throw new Error("Expected a menu.");
        }
        expect(getItems(tools)).toEqual([ "2", "|", "More tools" ]);
        expect([ menu.buttonView.label, menu.buttonView.withText, menu.buttonView.icon ])
            .toEqual([ "More tools", false, ICON ]);

        menu.isOpen = true;
        const getMenuItems = () => [
            ...menu.panelView.element?.querySelectorAll(".ck-button") ?? []
        ].map((item) => `${item.textContent}:${item.classList.contains("ck-on")}`);
        expect(getMenuItems()).toEqual([ "Eraser:false", "Laser pointer:true" ]);
        expect([ ...menu.panelView.element?.querySelectorAll(".ck-button") ?? [] ]
            .map((item) => !!item.querySelector(".ck-button__icon"))).toEqual([ true, false ]);
        expect(menu.buttonView.class).toBeUndefined();

        const children = [
            { id: "eraser", label: "Eraser", isOn: true },
            { id: "laser", label: "Laser pointer" }
        ];
        provider.change([ RECTANGLE, { ...MORE_TOOLS, isOn: true, children, class: "more" } ]);
        expect(tools.views[1]).toBe(menu);
        expect(getMenuItems()).toEqual([ "Eraser:true", "Laser pointer:false" ]);
        expect(menu.buttonView.class).toBe("more ck-on");

        for (const element of [ menu.buttonView.element, menu.panelView.element ]) {
            const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
            element?.dispatchEvent(mousedown);
            expect(mousedown.defaultPrevented).toBe(true);
        }
        menu.panelView.element?.querySelector<HTMLElement>(".ck-button")?.click();
        expect(provider.execute).toHaveBeenCalledWith("eraser");
    });

    it("shows no tools for content without any, or for a host that offers none", () => {
        const tools = createView();
        getContentEmbedTools.mockReturnValue(null);
        selectEmbed();
        expect(tools.isVisible).toBe(false);

        installGlobMock({ getComponentByEl: () => ({ loadEmbeddedNote: vi.fn() }) });
        selectEmbed();
        expect(tools.isVisible).toBe(false);

        installGlobMock({ getComponentByEl: () => undefined });
        editor.ui.update();
        expect(tools.isVisible).toBe(false);
    });

    it("runs a tool without taking the focus", () => {
        const tools = createView();
        selectEmbed();
        const rectangle = getButtons(tools)[1];
        const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        rectangle?.element?.dispatchEvent(mousedown);
        rectangle?.fire("execute");

        expect(mousedown.defaultPrevented).toBe(true);
        expect(provider.execute).toHaveBeenCalledWith("rectangle");
    });

    it("updates the buttons in place, and places the toolbar again for a new set", () => {
        const tools = createView();
        selectEmbed();
        const update = vi.spyOn(editor.ui, "update");
        const first = getButtons(tools)[0];

        provider.change([ { ...SELECTION, isOn: false }, { ...RECTANGLE, isOn: true } ]);
        expect(getButtons(tools).map((button) => button.isOn)).toEqual([ false, true ]);
        expect(getButtons(tools)[0]).toBe(first);
        expect(update).not.toHaveBeenCalled();

        provider.change([ RECTANGLE ]);
        expect(getButtonStates(tools))
            .toEqual([ [ "2", true, undefined, "Rectangle", "Rectangle", true, false, true ] ]);
        expect(update).toHaveBeenCalledTimes(1);

        provider.change([]);
        expect(tools.isVisible).toBe(false);
    });

    it("hides the items of the embed toolbar that the content leaves to the embed menu", () => {
        const names = [
            "contentEmbedBoxSizeDropdown", "toggleContentEmbedTitle", "convertEmbedToLink",
            "toggleContentEmbedCaption"
        ];
        const items = names.map((name) => {
            const item = editor.ui.componentFactory.create(name);
            item.render();
            return item;
        });
        const getShown = () => items.map((item) => !item.element?.classList.contains("ck-hidden"));
        selectEmbed();
        expect(getShown()).toEqual([ true, true, true, true ]);

        provider = createProvider([ SELECTION ], names.slice(0, 3));
        editor.ui.update();
        expect(getShown()).toEqual([ false, false, false, true ]);
        const embed = editor.editing.view.getDomRoot()?.querySelector("figure.include-note");
        expect(embed && editor.plugins.get(ContentEmbed).getEmbedStateAt(embed)).toMatchObject({
            boxSize: "medium", isTitleToggleable: true, isConvertibleToLink: true
        });

        provider = createProvider([ SELECTION ]);
        editor.ui.update();
        expect(getShown()).toEqual([ true, true, true, true ]);
    });

    it("reads the tools again when the editor updates, as they can follow the embed", () => {
        const tools = createView();
        const embedProvider = {
            tools: [ SELECTION ],
            getTools() {
                return this.tools;
            },
            execute: vi.fn(),
            subscribe: () => () => {}
        };
        getContentEmbedTools.mockReturnValue(embedProvider);
        selectEmbed();
        expect(getItems(tools)).toEqual([ "1" ]);

        embedProvider.tools = [ SELECTION, RECTANGLE ];
        expect(getItems(tools)).toEqual([ "1" ]);
        editor.ui.update();
        expect(getItems(tools)).toEqual([ "1", "2" ]);
    });

    it("focuses its first button, and stops following the provider once destroyed", () => {
        const tools = createView();
        selectEmbed();
        if (tools.element) {
            document.body.append(tools.element);
        }

        tools.focus();
        expect(document.activeElement).toBe(getButtons(tools)[0]?.element);

        tools.destroy();
        expect(provider.unsubscribe).toHaveBeenCalledTimes(1);
    });
});

/** A provider whose tools the spec changes. */
function createProvider(initialTools: Tool[], hiddenToolbarItems?: string[]) {
    let tools = initialTools;
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();

    return {
        unsubscribe,
        hiddenToolbarItems,
        getTools: () => tools,
        execute: vi.fn(),
        subscribe: vi.fn((callback: () => void) => {
            listener = callback;
            return unsubscribe;
        }),
        change(next: Tool[]) {
            tools = next;
            listener?.();
        }
    };
}
