import {
    type ClassicEditor, DropdownView, Essentials, Image, ImageStyle, type ModelElement, Paragraph,
    Widget
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
            embed = writer.createElement("contentEmbed", { noteId: "n1", boxSize: "medium" });
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

    it("shows for content that has positions, unless the content hides it", () => {
        const dropdown = createDropdown();
        const isShown = () => !dropdown.element?.classList.contains("ck-hidden");
        expect(isShown()).toBe(false);

        insertEmbed();
        expect([ isShown(), dropdown.isEnabled ]).toEqual([ true, true ]);

        tools = createTools({ hiddenToolbarItems: [ CONTENT_EMBED_POSITION_DROPDOWN ] });
        editor.ui.update();
        expect(isShown()).toBe(false);

        tools = null;
        editor.ui.update();
        expect([ isShown(), dropdown.isEnabled ]).toEqual([ false, false ]);
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
