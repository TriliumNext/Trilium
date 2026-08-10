import {
    type ClassicEditor,
    Collection,
    type DropdownView,
    Essentials,
    _getModelData as getModelData,
    type ListItemView,
    type ListView,
    type MenuBarMenuListView,
    type MenuBarMenuView,
    Paragraph,
    type SearchTextView,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumSnippets from "./snippets.js";
import type { SnippetDefinition } from "./snippetsconfig.js";
import SnippetListItemButtonView from "./snippetlistitembuttonview.js";
import SnippetListView from "./snippetlistview.js";
import SnippetsEditing from "./snippetsediting.js";
import SnippetsUI from "./snippetsui.js";

const DEF_FULL: SnippetDefinition = {
    title: "Greeting",
    data: "<p>Hello</p>",
    description: "A friendly hello",
    iconClass: "tn-icon bx bx-note",
    iconColorClass: "use-note-color color-abc123 with-hue"
};

const DEF_MINIMAL: SnippetDefinition = {
    title: "Signature",
    data: () => "<p>Bye</p>"
};

async function createEditor(definitions: SnippetDefinition[] = [DEF_FULL, DEF_MINIMAL]): Promise<ClassicEditor> {
    const editor = await createTestEditor(
        [Essentials, Paragraph, TriliumSnippets],
        { toolbar: [], snippets: { definitions } }
    );
    setModelData(editor.model, "<paragraph>[]</paragraph>");
    return editor;
}

describe("SnippetsEditing", () => {
    it("registers itself, the command, and seeds the collection from config", async () => {
        const editor = await createEditor();
        const editing = editor.plugins.get(SnippetsEditing);

        expect(SnippetsEditing.pluginName).toBe("SnippetsEditing");
        expect(editor.commands.get("insertTemplate")).toBeTruthy();
        expect([...editing.definitions].map((d) => d.title)).toEqual(["Greeting", "Signature"]);
    });

    it("starts with an empty collection when the snippets config is absent entirely", async () => {
        // No `snippets` key at all, so `config.get("snippets.definitions")` is undefined and the
        // `?? []` fallback kicks in (distinct from configuring an empty array).
        const editor = await createTestEditor([Essentials, Paragraph, TriliumSnippets], { toolbar: [] });
        expect(editor.plugins.get(SnippetsEditing).definitions.length).toBe(0);
    });

    it("replaces the whole collection on setDefinitions", async () => {
        const editor = await createEditor();
        const editing = editor.plugins.get(SnippetsEditing);

        editing.setDefinitions([DEF_MINIMAL]);
        expect([...editing.definitions].map((d) => d.title)).toEqual(["Signature"]);
    });
});

describe("insertTemplate command", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createEditor();
    });

    it("inserts a string payload as HTML at the selection", () => {
        editor.execute("insertTemplate", "<p>Hello</p>");
        expect(getModelData(editor.model, { withoutSelection: true })).toContain("<paragraph>Hello</paragraph>");
    });

    it("evaluates a callback payload and inserts its result", () => {
        editor.execute("insertTemplate", () => "<p>Bye</p>");
        expect(getModelData(editor.model, { withoutSelection: true })).toContain("<paragraph>Bye</paragraph>");
    });

    it("is a no-op when the payload does not resolve to a string", () => {
        const before = getModelData(editor.model, { withoutSelection: true });
        editor.execute("insertTemplate", (() => undefined) as never);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(before);
    });
});

describe("TriliumSnippets", () => {
    it("is the glue plugin over editing + UI, and pushes live updates", async () => {
        const editor = await createEditor();

        expect(TriliumSnippets.pluginName).toBe("TriliumSnippets");
        expect(editor.plugins.get(SnippetsEditing)).toBeInstanceOf(SnippetsEditing);
        expect(editor.plugins.get(SnippetsUI)).toBeInstanceOf(SnippetsUI);

        editor.plugins.get(TriliumSnippets).updateDefinitions([DEF_FULL]);
        expect([...editor.plugins.get(SnippetsEditing).definitions].map((d) => d.title)).toEqual(["Greeting"]);
    });
});

describe("SnippetsUI — insertTemplate dropdown", () => {
    let editor: ClassicEditor;
    let dropdown: DropdownView;
    let searchView: SearchTextView;

    beforeEach(async () => {
        editor = await createEditor();
        dropdown = editor.ui.componentFactory.create("insertTemplate") as DropdownView;
        dropdown.render();
        document.body.appendChild(dropdown.element as HTMLElement);
        dropdown.isOpen = true;
        searchView = dropdown.panelView.children.get(0) as SearchTextView;
    });

    it("labels the toggle and binds it to the command", () => {
        // The message id itself, no dictionary configured: the plugin says "text snippet" rather
        // than the "template" wording of the premium plugin it replaces.
        expect(dropdown.buttonView.label).toBe("Insert text snippet");
        expect(dropdown.buttonView.icon).toContain("<svg");

        const command = editor.commands.get("insertTemplate");
        command?.forceDisabled("spec");
        expect(dropdown.isEnabled).toBe(false);
        command?.clearForceDisabled("spec");
        expect(dropdown.isEnabled).toBe(true);
    });

    it("announces the result count for a non-empty query, and stays quiet for an empty one", () => {
        const announce = vi.spyOn(editor.ui.ariaLiveAnnouncer, "announce");

        searchView.search("Greeting");
        expect(announce).toHaveBeenCalled();

        announce.mockClear();
        searchView.search("");
        expect(announce).not.toHaveBeenCalled();
    });

    it("shows the not-found message when a query matches nothing", () => {
        searchView.search("zzzznomatch");
        expect((searchView.element as HTMLElement).textContent).toContain("No text snippets were found matching");
    });

    it("inserts the snippet when a row is chosen", () => {
        const execute = vi.spyOn(editor, "execute");
        const list = searchView.filteredView as unknown as ListView;
        const row = (list.items.get(0) as ListItemView).children.get(0);
        row?.fire("execute");

        expect(execute).toHaveBeenCalledWith("insertTemplate", DEF_FULL.data);
    });

    it("resets the search when the dropdown closes", () => {
        const reset = vi.spyOn(searchView, "reset");
        dropdown.isOpen = false;
        expect(reset).toHaveBeenCalled();
    });
});

describe("SnippetsUI — menu-bar entry", () => {
    let editor: ClassicEditor;
    let menu: MenuBarMenuView;

    function menuButtons(): unknown[] {
        const list = menu.panelView.children.get(0) as MenuBarMenuListView;
        return [...list.items];
    }

    beforeEach(async () => {
        editor = await createEditor();
        menu = editor.ui.componentFactory.create("menuBar:insertTemplate") as MenuBarMenuView;
    });

    it("lists one entry per snippet and inserts on execute", () => {
        expect(menu.buttonView.label).toBe("Text snippet");
        expect(menuButtons()).toHaveLength(2);

        const execute = vi.spyOn(editor, "execute");
        const firstItem = menuButtons()[0] as ListItemView;
        firstItem.children.get(0)?.fire("execute");
        expect(execute).toHaveBeenCalledWith("insertTemplate", DEF_FULL.data);
    });

    it("rebuilds live and shows an empty state when the snippet set becomes empty", () => {
        editor.plugins.get(SnippetsEditing).setDefinitions([]);

        const items = menuButtons();
        expect(items).toHaveLength(1);
        const emptyButton = (items[0] as ListItemView).children.get(0) as { label?: string; isEnabled?: boolean };
        expect(emptyButton.label).toBe("No text snippets available.");
        expect(emptyButton.isEnabled).toBe(false);
    });

    it("destroys the previous menu items on rebuild, so live updates don't leak views", () => {
        const staleItem = menuButtons()[0] as ListItemView;
        const destroy = vi.spyOn(staleItem, "destroy");

        editor.plugins.get(SnippetsEditing).setDefinitions([DEF_FULL]);
        expect(destroy).toHaveBeenCalled();
    });
});

describe("SnippetListView", () => {
    let editor: ClassicEditor;
    let collection: Collection<SnippetDefinition>;
    let insert: ReturnType<typeof vi.fn>;
    let list: SnippetListView;

    beforeEach(async () => {
        editor = await createEditor([]);
        collection = new Collection<SnippetDefinition>();
        collection.addMany([DEF_FULL, DEF_MINIMAL]);
        insert = vi.fn();
        list = new SnippetListView(editor.locale, collection, insert as unknown as (definition: SnippetDefinition) => void);
        list.render();
        document.body.appendChild(list.element as HTMLElement);
    });

    it("renders one row per definition and inserts the definition on row execute", () => {
        expect(list.items.length).toBe(2);

        (list.items.get(0) as ListItemView).children.get(0)?.fire("execute");
        expect(insert).toHaveBeenCalledWith(DEF_FULL);
    });

    // The real SearchTextView always hands `filter()` a global regexp; HighlightedTextView requires
    // one, so the tests mirror that.
    it("filters by query, hiding non-matches and counting the rest", () => {
        const result = list.filter(/greeting/gi);

        expect(result).toEqual({ resultsCount: 1, totalItemsCount: 2 });
        expect((list.items.get(0) as ListItemView).isVisible).toBe(true);
        expect((list.items.get(1) as ListItemView).isVisible).toBe(false);
    });

    it("shows every row again when the filter is cleared", () => {
        list.filter(/greeting/gi);
        const result = list.filter(null);

        expect(result).toEqual({ resultsCount: 2, totalItemsCount: 2 });
        expect((list.items.get(1) as ListItemView).isVisible).toBe(true);
    });

    it("focuses the first visible row, and does nothing when everything is filtered out", () => {
        list.filter(/signature/gi);
        const focusSecond = vi.spyOn((list.items.get(1) as ListItemView).children.get(0) as { focus: () => void }, "focus");
        list.focus();
        expect(focusSecond).toHaveBeenCalled();

        list.filter(/nothing-matches/gi);
        expect(() => list.focus()).not.toThrow();
    });

    it("rebuilds in place when the underlying collection changes", () => {
        collection.remove(DEF_MINIMAL);
        expect(list.items.length).toBe(1);
    });

    it("destroys the previous rows on rebuild, so live updates don't leak views", () => {
        const staleRow = list.items.get(0) as ListItemView;
        const destroy = vi.spyOn(staleRow, "destroy");

        collection.remove(DEF_MINIMAL); // any change triggers a full rebuild
        expect(destroy).toHaveBeenCalled();
    });
});

describe("SnippetListItemButtonView", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createEditor([]);
    });

    function render(definition: SnippetDefinition): SnippetListItemButtonView {
        const button = new SnippetListItemButtonView(editor.locale, definition);
        button.render();
        document.body.appendChild(button.element as HTMLElement);
        return button;
    }

    it("renders the note icon (with its classes), title and description", () => {
        const button = render(DEF_FULL);
        const el = button.element as HTMLElement;

        const icon = el.querySelector(".ck-template-icon");
        expect(icon?.classList.contains("bx-note")).toBe(true);
        expect(icon?.classList.contains("use-note-color")).toBe(true);
        expect(el.querySelector(".ck-button__label")?.textContent).toBe("Greeting");
        expect(el.querySelector(".ck-template-form__description")?.textContent).toBe("A friendly hello");
    });

    it("omits the description element and colour classes for a minimal snippet", () => {
        const button = render(DEF_MINIMAL);
        const el = button.element as HTMLElement;

        expect(el.querySelector(".ck-template-form__description")).toBeNull();
        expect(el.querySelector(".ck-template-icon")?.classList.contains("use-note-color")).toBe(false);
    });

    it("matches on title, on description, and reports no match otherwise", () => {
        const button = new SnippetListItemButtonView(editor.locale, DEF_FULL);

        expect(button.isMatching(/greet/gi)).toEqual({ title: true, description: false });
        expect(button.isMatching(/friendly/gi)).toEqual({ title: false, description: true });
        expect(button.isMatching(/zzz/gi)).toBeNull();
    });

    it("treats a description-less snippet as title-only for matching", () => {
        const button = new SnippetListItemButtonView(editor.locale, DEF_MINIMAL);
        expect(button.isMatching(/signature/gi)).toEqual({ title: true, description: false });
    });

    it("highlights safely before render and delegates once rendered, with or without a description", () => {
        // Before render the text views don't exist yet, so it must no-op rather than throw.
        const before = new SnippetListItemButtonView(editor.locale, DEF_FULL);
        expect(() => before.highlightText(/greet/gi)).not.toThrow();

        expect(() => render(DEF_FULL).highlightText(/greet/gi)).not.toThrow();
        expect(() => render(DEF_MINIMAL).highlightText(/sign/gi)).not.toThrow();
    });

    it("destroys cleanly", () => {
        expect(() => render(DEF_FULL).destroy()).not.toThrow();
    });
});
