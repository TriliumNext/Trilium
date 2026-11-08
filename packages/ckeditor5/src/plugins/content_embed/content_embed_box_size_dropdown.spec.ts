import { INLINE_BOX_SIZES } from "@triliumnext/commons";
import {
    ButtonView, type ClassicEditor, DropdownView, Essentials, ListItemView, ListSeparatorView,
    type ModelElement, Paragraph, Widget
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getListRows } from "../../../test/dropdown-kit.js";
import { createTestEditor } from "../../../test/editor-kit.js";
import ContentEmbedBoxSizeDropdown, {
    CONTENT_EMBED_BOX_SIZE_DROPDOWN
} from "./content_embed_box_size_dropdown.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME, DEFAULT_BOX_SIZE_COMMAND_NAME, type EmbedContentInfo
} from "./content_embed.js";

describe("ContentEmbedBoxSizeDropdown", () => {
    let editor: ClassicEditor;
    let tools: ContentEmbedToolProvider | null;
    let contentInfo: EmbedContentInfo | null;

    beforeEach(async () => {
        tools = null;
        contentInfo = { defaultBoxSize: "resizable", hasCompactContent: false };
        editor = await createTestEditor([
            Essentials, Paragraph, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown
        ], {
            contentEmbed: { getTools: () => tools, getEmbedContentInfo: () => contentInfo }
        });
    });

    function createDropdown() {
        const dropdown = editor.ui.componentFactory.create(CONTENT_EMBED_BOX_SIZE_DROPDOWN);
        if (!(dropdown instanceof DropdownView)) {
            throw new Error("Expected the box size dropdown.");
        }
        dropdown.render();
        return dropdown;
    }

    function insertEmbed(attributes: Record<string, unknown>): ModelElement {
        let embed: ModelElement | null = null;
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("The editor has no root.");
            }
            embed = writer.createElement("contentEmbed", attributes);
            writer.insert(embed, root, 0);
            writer.setSelection(embed, "on");
        });
        if (!embed) {
            throw new Error("Expected an embed.");
        }
        editor.ui.update();
        return embed;
    }

    /** The row `label`, which `getListRows` leaves out once the list hides it. */
    function getRow(dropdown: DropdownView, label: string) {
        dropdown.isOpen = true;
        const button = [ ...dropdown.listView?.items ?? [] ]
            .map((item) => (item instanceof ListItemView ? item.children.first : null))
            .find((view): view is ButtonView => view instanceof ButtonView && view.label === label);
        if (!button) {
            throw new Error(`Expected the row "${label}".`);
        }
        return button;
    }

    it("names the box size of the selected embed, and the size in the tooltip of an icon", () => {
        const dropdown = createDropdown();
        expect(dropdown.buttonView).toMatchObject({ label: "Box size", tooltip: true });
        expect(dropdown.isEnabled).toBe(false);

        insertEmbed({ noteId: "n1", boxSize: "compact" });
        expect(dropdown.isEnabled).toBe(true);
        expect(dropdown.buttonView).toMatchObject({ label: "Compact", withText: true });

        const icon = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"></svg>";
        tools = { boxSizeIcon: icon, getTools: () => [], execute: () => {}, subscribe: () => () => {} };
        editor.ui.update();
        expect(dropdown.buttonView)
            .toMatchObject({ icon, label: "Box size: Compact", withText: false });
    });

    it("lists the sizes the selected embed can take, the current one on, and Default last", () => {
        const dropdown = createDropdown();
        insertEmbed({ noteId: "n1", boxSize: "full" });
        expect(getListRows(dropdown))
            .toStrictEqual([ "Compact", "Resizable", "Full ✓", "Expandable", "Default" ]);
        const items = [ ...dropdown.listView?.items ?? [] ];
        expect(items.at(-2)).toBeInstanceOf(ListSeparatorView);
        expect(getRow(dropdown, "Default").role).toBe("menuitem");
        expect(getRow(dropdown, "Full").role).toBe("menuitemradio");

        // A source embed has no title for Compact or Expandable to show.
        insertEmbed({ language: "mermaid", source: "graph TD", boxSize: "resizable" });
        const rows = [ ...dropdown.listView?.items ?? [] ]
            .map((item) => (item instanceof ListItemView ? item.children.first : null))
            .filter((view): view is ButtonView => view instanceof ButtonView);
        expect(rows.filter((row) => row.isVisible).map((row) => row.label))
            .toEqual([ "Resizable", "Full", "Default" ]);
        expect(INLINE_BOX_SIZES).toEqual([ "resizable", "full" ]);
    });

    it("sets the size picked and focuses the editor, and Default puts the box back", () => {
        const dropdown = createDropdown();
        const embed = insertEmbed({ noteId: "n1", boxSize: "resizable", customHeight: "12em" });
        const focus = vi.spyOn(editor.editing.view, "focus");
        const execute = vi.spyOn(editor, "execute");

        getRow(dropdown, "Full").fire("execute");
        expect(execute).toHaveBeenCalledWith(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(embed.getAttribute("boxSize")).toBe("full");
        expect(embed.hasAttribute("customHeight")).toBe(false);
        expect(focus).toHaveBeenCalled();

        expect(getRow(dropdown, "Default").isEnabled).toBe(true);
        getRow(dropdown, "Default").fire("execute");
        expect(execute).toHaveBeenCalledWith(DEFAULT_BOX_SIZE_COMMAND_NAME);
        expect(embed.getAttribute("boxSize")).toBe("resizable");
        expect(getRow(dropdown, "Default").isEnabled).toBe(false);

        // The host has not loaded the note, so its default is unknown.
        contentInfo = null;
        editor.ui.update();
        expect(getRow(dropdown, "Default").isEnabled).toBe(false);
    });

    it("hides for content whose tools hide it, and shows a raw size the model holds", () => {
        const dropdown = createDropdown();
        insertEmbed({ noteId: "n1", boxSize: "huge" });
        expect(dropdown.buttonView.label).toBe("huge");

        tools = {
            hiddenToolbarItems: [ CONTENT_EMBED_BOX_SIZE_DROPDOWN ],
            getTools: () => [], execute: () => {}, subscribe: () => () => {}
        };
        editor.ui.update();
        expect(dropdown.element?.classList.contains("ck-hidden")).toBe(true);
    });
});
