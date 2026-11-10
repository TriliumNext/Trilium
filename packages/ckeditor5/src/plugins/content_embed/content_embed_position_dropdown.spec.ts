import {
    type ClassicEditor, DropdownView, Essentials, Image, ImageStyle, ListItemGroupView,
    type ModelElement, Paragraph, Widget
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getListRow, getListRows, pickListRow } from "../../../test/dropdown-kit.js";
import { createTestEditor } from "../../../test/editor-kit.js";
import { POSITION_COMMAND_NAME } from "./content_embed.js";
import ContentEmbedPositionDropdown, {
    CONTENT_EMBED_POSITION_DROPDOWN
} from "./content_embed_position_dropdown.js";

describe("ContentEmbedPositionDropdown", () => {
    let editor: ClassicEditor;
    let tools: ContentEmbedToolProvider | null;

    beforeEach(async () => {
        tools = createTools();
        editor = await createTestEditor([
            Essentials, Paragraph, Widget, Image, ImageStyle, ContentEmbedPositionDropdown
        ], {
            contentEmbed: { getTools: () => tools }
        });
    });

    function createDropdown() {
        const dropdown = editor.ui.componentFactory.create(CONTENT_EMBED_POSITION_DROPDOWN);
        if (!(dropdown instanceof DropdownView)) {
            throw new Error("Expected the position dropdown.");
        }
        dropdown.render();
        return dropdown;
    }

    function insertEmbed(): ModelElement {
        let embed: ModelElement | null = null;
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("The editor has no root.");
            }
            embed = writer.createElement("contentEmbed", { noteId: "n1", boxSize: "resizable" });
            writer.insert(embed, root, 0);
            writer.setSelection(embed, "on");
        });
        if (!embed) {
            throw new Error("Expected an embed.");
        }
        return embed;
    }

    it("lists the positions under the way text runs around the embed, the current one on", () => {
        const dropdown = createDropdown();
        insertEmbed();

        expect(dropdown.buttonView).toMatchObject({ label: "Box position", tooltip: true });
        expect(getListRows(dropdown)).toStrictEqual([
            "# Break text", "Align left", "Align center ✓", "Align right",
            "# Wrap text", "Align left", "Align right"
        ]);
    });

    it("shows the icons of the image positions", () => {
        const dropdown = createDropdown();
        insertEmbed();
        const styles = editor.plugins.get("ImageStyleEditing").normalizedStyles ?? [];
        const getStyleIcon = (name: string) => styles.find((style) => style.name === name)?.icon;

        expect([
            getListRow(dropdown, "Break text", "Align left").icon,
            getListRow(dropdown, "Break text", "Align center").icon,
            getListRow(dropdown, "Break text", "Align right").icon,
            getListRow(dropdown, "Wrap text", "Align left").icon,
            getListRow(dropdown, "Wrap text", "Align right").icon
        ]).toEqual([
            getStyleIcon("alignBlockLeft"), getStyleIcon("alignCenter"),
            getStyleIcon("alignBlockRight"), getStyleIcon("alignLeft"), getStyleIcon("alignRight")
        ]);
        expect(dropdown.buttonView.icon).toBe(getStyleIcon("alignCenter"));
    });

    it("sets the position picked, shows it on its button and focuses the editor", () => {
        const dropdown = createDropdown();
        const embed = insertEmbed();
        const focus = vi.spyOn(editor.editing.view, "focus");

        pickListRow(dropdown, "Wrap text", "Align right");
        expect(embed.getAttribute("position")).toBe("wrap-right");
        expect(focus).toHaveBeenCalled();
        expect(dropdown.buttonView.icon)
            .toBe(getListRow(dropdown, "Wrap text", "Align right").icon);
        expect(editor.commands.get(POSITION_COMMAND_NAME)?.value).toBe("wrap-right");
    });

    it("offers an Expandable embed the positions that break the text, and Compact none", () => {
        const dropdown = createDropdown();
        const embed = insertEmbed();
        const isShown = () => !dropdown.element?.classList.contains("ck-hidden");
        const groups = () => [ ...dropdown.listView?.items ?? [] ]
            .filter((item) => item instanceof ListItemGroupView)
            .map((group) => [ group.label, group.isVisible ]);

        editor.model.change((writer) => writer.setAttribute("boxSize", "expandable", embed));
        editor.ui.update();
        expect([ isShown(), dropdown.isEnabled ]).toEqual([ true, true ]);
        expect(getListRow(dropdown, "Break text", "Align right").isVisible).toBe(true);
        expect(getListRow(dropdown, "Wrap text", "Align right").isVisible).toBe(false);
        expect(groups()).toEqual([ [ "Break text", true ], [ "Wrap text", false ] ]);

        editor.model.change((writer) => writer.setAttribute("boxSize", "compact", embed));
        editor.ui.update();
        expect([ isShown(), dropdown.isEnabled ]).toEqual([ false, false ]);

        editor.model.change((writer) => writer.setAttribute("boxSize", "resizable", embed));
        editor.ui.update();
        expect(groups()).toEqual([ [ "Break text", true ], [ "Wrap text", true ] ]);
    });

    it("shows for content whose tools opt in to positions, unless they hide it", () => {
        const dropdown = createDropdown();
        const isShown = () => !dropdown.element?.classList.contains("ck-hidden");
        expect(isShown()).toBe(false);

        const embed = insertEmbed();
        expect([ isShown(), dropdown.isEnabled ]).toEqual([ true, true ]);

        tools = createTools({ hiddenToolbarItems: [ CONTENT_EMBED_POSITION_DROPDOWN ] });
        editor.ui.update();
        expect(isShown()).toBe(false);

        tools = createTools({
            hiddenToolbarItemsWhileEditable: [ CONTENT_EMBED_POSITION_DROPDOWN ]
        });
        editor.ui.update();
        expect(isShown()).toBe(true);
        editor.model.change((writer) => writer.setAttribute("editable", true, embed));
        expect(isShown()).toBe(false);
        editor.model.change((writer) => writer.removeAttribute("editable", embed));

        // An included note sets its position from its menu only.
        for (const other of [ createTools({ hasPositions: false }), null ]) {
            tools = other;
            editor.ui.update();
            expect([ isShown(), dropdown.isEnabled ]).toEqual([ false, true ]);
        }
    });
});

function createTools(options: Partial<ContentEmbedToolProvider> = {}): ContentEmbedToolProvider {
    return {
        hasPositions: true,
        getTools: () => [],
        execute: () => {},
        subscribe: () => () => {},
        ...options
    };
}
