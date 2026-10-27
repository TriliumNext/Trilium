import {
    _setModelData as setModelData,
    ButtonView, type ClassicEditor, DropdownView, Essentials, Image, ImageStyle, ListItemGroupView, ListItemView,
    type ListView, Paragraph, type View
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ImagePosition from "./image_position.js";

const STYLES = ["inline", "alignBlockLeft", "alignCenter", "alignBlockRight", "alignLeft", "alignRight", "side"];
const BLOCK_IMAGE = "[<imageBlock src=\"a.png\"></imageBlock>]<paragraph>b</paragraph>";

describe("ImagePosition", () => {
    async function createEditor(styles = STYLES) {
        const editor = await createTestEditor([Essentials, Paragraph, Image, ImageStyle, ImagePosition], {
            toolbar: ["imagePosition"],
            image: { styles: { options: styles } }
        });
        return { editor, dropdown: getDropdown(editor) };
    }

    it("lists the positions under the way text runs around the image, the current one on", async () => {
        const { editor, dropdown } = await createEditor();
        setModelData(editor.model, BLOCK_IMAGE.replace("<imageBlock", "<imageBlock imageStyle=\"alignRight\""));

        expect(dropdown.buttonView).toMatchObject({ label: "Image position", tooltip: true });
        expect(rows(dropdown)).toStrictEqual([
            "In line",
            "# Break text", "Align left", "Align center", "Align right",
            "# Wrap text", "Align left", "Align right ✓"
        ]);
        expect(dropdown.buttonView.icon).toBe(styleIcon(editor, "alignRight"));
    });

    it("sets the position picked, and shows it on its button", async () => {
        const { editor, dropdown } = await createEditor();
        setModelData(editor.model, BLOCK_IMAGE);

        pick(dropdown, "Wrap text", "Align left");
        expect(editor.getData()).toContain("image-style-align-left");
        expect(dropdown.buttonView.icon).toBe(styleIcon(editor, "alignLeft"));

        pick(dropdown, "Break text", "Align right");
        expect(editor.getData()).toContain("image-style-block-align-right");
    });

    it("leaves out the positions the editor has no style for, and is off without an image", async () => {
        const { editor, dropdown } = await createEditor(["inline", "alignCenter", "alignLeft"]);
        setModelData(editor.model, BLOCK_IMAGE);
        expect(rows(dropdown)).toStrictEqual(["In line", "# Break text", "Align center", "# Wrap text", "Align left"]);

        setModelData(editor.model, "<paragraph>b[]</paragraph>");
        expect(dropdown.isEnabled).toBe(false);
    });

    it("leaves out a group with no style, and shows the first style while none of them is set", async () => {
        const { editor, dropdown } = await createEditor(["alignLeft", "alignRight"]);
        setModelData(editor.model, BLOCK_IMAGE);
        expect(rows(dropdown)).toStrictEqual(["# Wrap text", "Align left", "Align right"]);
        expect(dropdown.buttonView.icon).toBe(styleIcon(editor, "alignLeft"));
    });
});

function getDropdown(editor: ClassicEditor) {
    const item = editor.ui.view.toolbar.items.first;
    if (!(item instanceof DropdownView)) throw new Error("expected the image position dropdown");
    return item;
}

function styleIcon(editor: ClassicEditor, name: string) {
    return editor.plugins.get("ImageStyleEditing").normalizedStyles?.find((style) => style.name === name)?.icon;
}

/** The rows of the dropdown's list: a heading as `# label`, a row that is on with a check. */
function rows(dropdown: DropdownView) {
    dropdown.isOpen = true;
    dropdown.isOpen = false;
    const text = (items: Iterable<View>): string[] => [ ...items ].flatMap((item) => {
        if (item instanceof ListItemGroupView) return [ `# ${item.label}`, ...text(item.items) ];
        const button = item instanceof ListItemView ? item.children.first : null;
        return button instanceof ButtonView ? [ button.isOn ? `${button.label} ✓` : button.label ?? "" ] : [];
    });
    return text((dropdown.listView as ListView).items);
}

function pick(dropdown: DropdownView, heading: string, label: string) {
    dropdown.isOpen = true;
    const group = [ ...(dropdown.listView as ListView).items ]
        .find((item): item is ListItemGroupView => item instanceof ListItemGroupView && item.label === heading);
    const button = [ ...group?.items ?? [] ]
        .map((item) => (item instanceof ListItemView ? item.children.first : null))
        .find((view): view is ButtonView => view instanceof ButtonView && view.label === label);
    if (!button) throw new Error(`expected "${label}" under "${heading}"`);
    button.fire("execute");
}
